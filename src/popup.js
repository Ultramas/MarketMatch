const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const brandInput = document.getElementById('brand');
const distanceScopeInput = document.getElementById('distanceScope');
const userStateInput = document.getElementById('userState');
const freeShippingOnlyInput = document.getElementById('freeShippingOnly');
const brandRequiredInput = document.getElementById('brandRequired');
const sellerStandingBoostInput = document.getElementById('sellerStandingBoost');
const consentCard = document.getElementById('consentCard');
const resultsNode = document.getElementById('results');
const resultsSummaryNode = document.getElementById('resultsSummary');
const historySummaryNode = document.getElementById('historySummary');
const statusPillsNode = document.getElementById('statusPills');
const sourceListingSummaryNode = document.getElementById('sourceListingSummary');
const apiStatusNode = document.getElementById('apiStatus');

let currentSettings = {};
let currentSourceListing = null;

const FILTER_DEFAULTS = {
  distanceScope: 'any',
  sameLocationValue: '',
  brandRequired: false,
  brand: '',
  freeShippingOnly: false,
  minPositiveRatings: 5,
  maxNegativeRatioDivisor: 5,
  sellerStandingBoost: true,
  userState: '',
  defaultTaxRate: 0,
};

document.getElementById('captureListing').addEventListener('click', captureCurrentListing);
document.getElementById('searchEbayMatches').addEventListener('click', searchEbayMatches);
document.getElementById('applyFilters').addEventListener('click', applyFilters);
document.getElementById('resetSession').addEventListener('click', resetSession);
document.getElementById('allowCookies').addEventListener('click', () => saveConsent(true));
document.getElementById('declineCookies').addEventListener('click', () => saveConsent(false));

bootstrap();

async function bootstrap() {
  const { draft, filters, consent, history, results, sourceListing, settings } = await chrome.storage.local.get([
    'draft',
    'filters',
    'consent',
    'history',
    'results',
    'sourceListing',
    'settings',
  ]);

  currentSettings = settings || {};
  currentSourceListing = sourceListing || null;
  restoreDraft(draft);
  restoreFilters(filters, settings);
  updateConsentUI(consent);
  renderStatusPills(filters, consent, settings);
  renderHistorySummary(history || []);
  renderResultsSummary(results || []);
  renderSourceListingSummary(sourceListing);
  renderApiStatus(settings);

  if (history?.length) {
    render({ recentHistory: history.slice(0, 5) });
  }
}

async function captureCurrentListing() {
  const tab = await getActiveTab();
  if (detectPlatformFromUrl(tab?.url) !== 'facebook') {
    render({ error: 'Open a Facebook Marketplace listing page first.' });
    return;
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_LISTING' });
  } catch {
    render({ error: 'Could not reach the Facebook page script. Refresh the tab and try again.' });
    return;
  }

  if (!response?.title || !response?.description) {
    render({ error: 'Facebook capture did not find both title and description. Selector tuning is still needed for some page layouts.' });
    return;
  }

  titleInput.value = response.title;
  descriptionInput.value = response.description;

  await chrome.storage.local.set({ sourceListing: response, results: [] });
  currentSourceListing = response;
  renderSourceListingSummary(response);
  renderResultsSummary([]);
  await persistDraft();
  await maybeSaveHistory({
    type: 'view',
    platform: 'facebook',
    title: response.title,
    query: buildDraftQuery(),
    url: response.url || tab.url || '',
  });
  renderStatusPills(await getSavedFilters(), await getSavedConsent(), currentSettings);
  render(response);
}

async function searchEbayMatches() {
  const query = buildDraftQuery();
  if (!titleInput.value.trim() || !descriptionInput.value.trim()) {
    render({ error: 'Title and description are both required before searching eBay.' });
    return;
  }

  await persistDraft();
  await chrome.storage.local.set({ results: [] });
  renderResultsSummary([]);

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: 'SEARCH_EBAY_LISTINGS',
      payload: {
        query,
        sourcePlatform: 'facebook',
      },
    });
  } catch {
    render({ error: 'The background search failed before eBay returned results. Check your token and reload the extension.' });
    return;
  }

  if (!response?.ok) {
    render(response || { error: 'eBay search failed.' });
    return;
  }

  const matches = Array.isArray(response.matches) ? response.matches : [];
  await chrome.storage.local.set({ results: matches });
  renderResultsSummary(matches);
  await maybeSaveHistory({
    type: 'search',
    platform: 'ebay',
    title: titleInput.value.trim(),
    query,
    url: response.requestMeta?.href || '',
  });
  render({
    ok: true,
    query: response.query,
    totalMatches: matches.length,
    requestMeta: response.requestMeta,
  });
}

async function applyFilters() {
  const saved = await getSavedFilters();
  const { settings } = await chrome.storage.local.get(['settings']);
  currentSettings = settings || {};

  const filters = {
    ...FILTER_DEFAULTS,
    ...(settings ? {
      minPositiveRatings: settings.minPositiveRatings ?? FILTER_DEFAULTS.minPositiveRatings,
      maxNegativeRatioDivisor: settings.maxNegativeRatioDivisor ?? FILTER_DEFAULTS.maxNegativeRatioDivisor,
      defaultTaxRate: settings.defaultTaxRate ?? FILTER_DEFAULTS.defaultTaxRate,
      userState: settings.defaultState ?? FILTER_DEFAULTS.userState,
    } : {}),
    ...saved,
    distanceScope: distanceScopeInput.value,
    brandRequired: brandRequiredInput.checked,
    brand: brandInput.value.trim(),
    freeShippingOnly: freeShippingOnlyInput.checked,
    sellerStandingBoost: sellerStandingBoostInput.checked,
    userState: userStateInput.value.trim() || settings?.defaultState || '',
  };

  await chrome.storage.local.set({ filters });
  await persistDraft();
  renderStatusPills(filters, await getSavedConsent(), settings);
  render({ message: 'Saved Facebook-to-eBay comparison filters.' });
}

async function resetSession() {
  const createEmptySessionState = globalThis.MarketMatchLib?.createEmptySessionState;
  const emptyState = typeof createEmptySessionState === 'function'
    ? createEmptySessionState()
    : { draft: { brand: '', title: '', description: '' }, sourceListing: null, results: [] };

  await chrome.storage.local.set({
    draft: emptyState.draft,
    sourceListing: emptyState.sourceListing,
    results: emptyState.results,
  });

  currentSourceListing = null;
  restoreDraft(emptyState.draft);
  renderSourceListingSummary(null);
  renderResultsSummary([]);
  render({ message: 'Cleared Facebook source listing and eBay matches.' });
}

async function saveConsent(allowed) {
  const consent = {
    cookiesPrompted: true,
    cookiesAllowed: allowed,
    historyAllowed: allowed,
    couponLookupAllowed: false,
  };

  await chrome.storage.local.set({ consent });
  updateConsentUI(consent);
  renderStatusPills(await getSavedFilters(), consent, currentSettings);
  render({ consent });
}

function updateConsentUI(consent = {}) {
  consentCard.style.display = Boolean(consent?.cookiesPrompted) ? 'none' : 'grid';
}

async function maybeSaveHistory(entry) {
  const response = await chrome.runtime.sendMessage({ type: 'SAVE_HISTORY', entry });
  renderHistorySummary(response?.history || []);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render(value) {
  resultsNode.textContent = JSON.stringify(value, null, 2);
}

function renderApiStatus(settings = {}) {
  apiStatusNode.textContent = settings?.ebayApplicationToken
    ? `eBay token configured for ${settings.ebayMarketplaceId || 'EBAY_US'}${settings.endUserZip ? ` · ZIP ${settings.endUserZip}` : ''}`
    : 'No eBay token configured yet. Add one in Options before searching.';
}

function renderResultsSummary(results = []) {
  if (!results.length) {
    resultsSummaryNode.innerHTML = `<div class="miniItem"><strong>No eBay matches yet</strong><div class="miniMeta">Capture a Facebook listing, then search eBay matches from the popup.</div></div>`;
    return;
  }

  const rankedResults = filterAndRankResultsForDisplay(results);
  if (!rankedResults.length) {
    resultsSummaryNode.innerHTML = `<div class="miniItem"><strong>No matches passed the current filters</strong><div class="miniMeta">Relax shipping, brand, seller, or location filters and try again.</div></div>`;
    return;
  }

  resultsSummaryNode.innerHTML = rankedResults.slice(0, 5).map((result) => {
    const flags = buildFlags(result);
    const searchUrl = buildEbaySearchUrl(result.title || '');
    return `
      <div class="matchCard">
        <div class="matchHeader">
          <div>
            <strong>${escapeHtml(result.title || 'Untitled eBay match')}</strong>
            <div class="miniMeta">${escapeHtml(result.matchReason || result.condition || 'eBay Browse API match')}</div>
          </div>
          <div class="priceBlock">
            <div class="miniMeta">Landed</div>
            <strong>$${Number(result.totalCost || 0).toFixed(2)}</strong>
          </div>
        </div>
        <div class="miniMeta">Confidence ${Number(result.matchConfidence || 0).toFixed(0)}${result.matchedTokens?.length ? ` · ${escapeHtml(result.matchedTokens.join(', '))}` : ''}</div>
        <div class="metricGrid">
          <div class="metric">
            <div class="metricLabel">Price</div>
            <div class="metricValue">$${Number(result.listedPrice || 0).toFixed(2)}</div>
          </div>
          <div class="metric">
            <div class="metricLabel">Shipping</div>
            <div class="metricValue">${escapeHtml(formatCurrencyOrUnknown(result.shipping))}</div>
          </div>
          <div class="metric">
            <div class="metricLabel">Confidence</div>
            <div class="metricValue">${Number(result.matchConfidence || 0).toFixed(0)}</div>
          </div>
        </div>
        <div class="miniMeta">Item $${Number(result.listedPrice || 0).toFixed(2)} · Shipping ${formatCurrencyOrUnknown(result.shipping)} · Tax $${Number(result.taxes || 0).toFixed(2)}</div>
        <div class="miniMeta">Seller ${escapeHtml(result.sellerName || 'unknown')} ${result.sellerStanding ? `· ${escapeHtml(result.sellerStanding)}` : ''}</div>
        <div class="miniMeta">${escapeHtml(result.locationText || 'Location unavailable')}${Array.isArray(result.buyingOptions) && result.buyingOptions.length ? ` · ${escapeHtml(result.buyingOptions.join(', '))}` : ''}</div>
        ${flags.length ? `<div class="flagRow">${flags.map((flag) => `<span class="flag">${escapeHtml(flag)}</span>`).join('')}</div>` : ''}
        <div class="actionRow">
          <a class="actionLink" href="${escapeHtml(result.url || searchUrl)}" target="_blank" rel="noreferrer">Open Listing</a>
          <a class="actionLink secondary" href="${escapeHtml(searchUrl)}" target="_blank" rel="noreferrer">Open Search</a>
        </div>
      </div>
    `;
  }).join('');
}

function renderHistorySummary(history = []) {
  if (!history.length) {
    historySummaryNode.innerHTML = `<div class="miniItem"><strong>No history yet</strong><div class="miniMeta">Searches and captured Facebook listings appear here after consent.</div></div>`;
    return;
  }

  historySummaryNode.innerHTML = history.slice(0, 4).map((entry) => `
    <div class="miniItem">
      <strong>${escapeHtml(formatHistoryEntry(entry))}</strong>
      <div class="miniMeta">${escapeHtml(entry.platform || 'unknown')} · ${escapeHtml(entry.type || 'event')}</div>
    </div>
  `).join('');
}

function renderSourceListingSummary(sourceListing) {
  if (!sourceListing) {
    sourceListingSummaryNode.innerHTML = `<div class="miniItem"><strong>No Facebook source listing captured</strong><div class="miniMeta">Open a Facebook Marketplace listing and capture it, or type title/description manually.</div></div>`;
    return;
  }

  sourceListingSummaryNode.innerHTML = `
    <div class="miniItem">
      <strong>${escapeHtml(sourceListing.title || 'Untitled source listing')}</strong>
      <div class="miniMeta">${escapeHtml(sourceListing.condition || 'condition unknown')} · ${sourceListing.listedPrice != null ? `$${Number(sourceListing.listedPrice).toFixed(2)}` : 'price unavailable'}</div>
      <div class="miniMeta">${escapeHtml(sourceListing.locationText || 'location unavailable')}${sourceListing.bestOfferDetected ? ' · offer language detected' : ''}${sourceListing.placeholderPriceFlag ? ' · placeholder price flagged' : ''}</div>
    </div>
  `;
}

function renderStatusPills(filters = {}, consent = {}, settings = {}) {
  const pills = [
    'Facebook Source',
    'eBay API',
    settings?.ebayApplicationToken ? 'Token Ready' : 'Token Missing',
    consent?.historyAllowed ? 'History Enabled' : 'History Off',
    filters?.freeShippingOnly ? 'Free Ship Only' : 'Any Shipping',
    filters?.sellerStandingBoost !== false ? 'Seller Boost On' : 'Seller Boost Off',
  ];

  statusPillsNode.innerHTML = pills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join('');
}

async function persistDraft() {
  await chrome.storage.local.set({
    draft: {
      brand: brandInput.value.trim(),
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim(),
    },
  });
}

function restoreDraft(draft = {}) {
  brandInput.value = draft?.brand || '';
  titleInput.value = draft?.title || '';
  descriptionInput.value = draft?.description || '';
}

function restoreFilters(filters = {}, settings = {}) {
  const merged = {
    ...FILTER_DEFAULTS,
    ...(settings ? {
      minPositiveRatings: settings.minPositiveRatings ?? FILTER_DEFAULTS.minPositiveRatings,
      maxNegativeRatioDivisor: settings.maxNegativeRatioDivisor ?? FILTER_DEFAULTS.maxNegativeRatioDivisor,
      defaultTaxRate: settings.defaultTaxRate ?? FILTER_DEFAULTS.defaultTaxRate,
      userState: settings.defaultState ?? FILTER_DEFAULTS.userState,
    } : {}),
    ...(filters || {}),
  };

  distanceScopeInput.value = merged.distanceScope;
  userStateInput.value = merged.userState;
  freeShippingOnlyInput.checked = Boolean(merged.freeShippingOnly);
  brandRequiredInput.checked = Boolean(merged.brandRequired);
  sellerStandingBoostInput.checked = merged.sellerStandingBoost !== false;
}

function buildDraftQuery() {
  const normalizeSearchInput = globalThis.MarketMatchLib?.normalizeSearchInput;
  if (typeof normalizeSearchInput === 'function') {
    return normalizeSearchInput({
      brand: brandInput.value.trim(),
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim(),
    }).query;
  }

  return [brandInput.value.trim(), titleInput.value.trim(), descriptionInput.value.trim()]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rankResultsForDisplay(results) {
  const rankResults = globalThis.MarketMatchLib?.rankResults;
  if (typeof rankResults !== 'function') return results;

  return rankResults(results, {
    sellerStandingBoost: sellerStandingBoostInput.checked,
    defaultTaxRate: Number(currentSettings.defaultTaxRate ?? FILTER_DEFAULTS.defaultTaxRate ?? 0),
    sourceListing: readCurrentSourceListing(),
  });
}

function filterAndRankResultsForDisplay(results) {
  const sourceListing = readCurrentSourceListing();
  const filtered = results.filter((result) => passesActiveFilters(result, sourceListing));
  return rankResultsForDisplay(filtered);
}

function passesActiveFilters(result, sourceListing) {
  if (freeShippingOnlyInput.checked && Number(result.shipping) !== 0) {
    return false;
  }

  if (brandRequiredInput.checked) {
    const brand = brandInput.value.trim().toLowerCase();
    if (brand && !String(result.title || '').toLowerCase().includes(brand)) {
      return false;
    }
  }

  const passesSellerRating = globalThis.MarketMatchLib?.passesSellerRating;
  if (typeof passesSellerRating === 'function' && !passesSellerRating(result, {
    minPositiveRatings: Number(currentSettings.minPositiveRatings ?? FILTER_DEFAULTS.minPositiveRatings),
    maxNegativeRatioDivisor: Number(currentSettings.maxNegativeRatioDivisor ?? FILTER_DEFAULTS.maxNegativeRatioDivisor),
  })) {
    return false;
  }

  if (!passesDistanceFilter(result, sourceListing)) {
    return false;
  }

  return true;
}

function passesDistanceFilter(result, sourceListing) {
  const scope = distanceScopeInput.value;
  if (scope === 'any') return true;

  const sourceLocation = String(sourceListing?.locationText || '').toLowerCase();
  const resultLocation = String(result.locationText || '').toLowerCase();
  if (!sourceLocation || !resultLocation) return false;

  if (scope === 'city') {
    const sourceCity = sourceLocation.split(',')[0]?.trim();
    return Boolean(sourceCity) && resultLocation.includes(sourceCity);
  }

  if (scope === 'state') {
    const state = userStateInput.value.trim().toLowerCase() || extractStateToken(sourceLocation);
    return Boolean(state) && resultLocation.includes(state);
  }

  if (scope === 'country') {
    const country = extractCountryToken(sourceLocation);
    return Boolean(country) && resultLocation.includes(country);
  }

  return true;
}

function buildFlags(result) {
  const flags = [];
  if (result.bestOfferDetected) flags.push('Best Offer');
  if (Number(result.shipping) === 0) flags.push('Free Shipping');
  if (result.shipping == null) flags.push('Shipping Unknown');
  if (result.sellerStanding) flags.push('Seller Signal');
  if (result.locationText) flags.push(result.locationText);
  return flags;
}

function formatHistoryEntry(entry) {
  const formatter = globalThis.MarketMatchLib?.formatHistoryLabel;
  return typeof formatter === 'function'
    ? formatter(entry)
    : (entry?.title || entry?.query || 'Untitled action');
}

async function getSavedFilters() {
  const { filters } = await chrome.storage.local.get(['filters']);
  return filters || {};
}

async function getSavedConsent() {
  const { consent } = await chrome.storage.local.get(['consent']);
  return consent || {};
}

function detectPlatformFromUrl(url = '') {
  if (url.includes('facebook.com')) return 'facebook';
  if (url.includes('ebay.com')) return 'ebay';
  return 'unknown';
}

function readCurrentSourceListing() {
  return currentSourceListing || {
    title: titleInput.value.trim(),
    description: descriptionInput.value.trim(),
    locationText: '',
  };
}

function extractStateToken(locationText) {
  const parts = String(locationText || '').split(',').map((part) => part.trim()).filter(Boolean);
  return parts[1]?.toLowerCase() || '';
}

function extractCountryToken(locationText) {
  const parts = String(locationText || '').split(',').map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1]?.toLowerCase() || '';
}

function formatCurrencyOrUnknown(value) {
  return value == null ? 'unknown' : `$${Number(value).toFixed(2)}`;
}

function buildEbaySearchUrl(query) {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(String(query || '').trim())}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
