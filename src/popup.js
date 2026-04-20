const DEFAULT_SETTINGS = {
  ebayProxyBaseUrl: '',
  proxyAccessKey: '',
  ebayMarketplaceId: 'EBAY_US',
  ebayLimit: 10,
  endUserZip: '',
  minPositiveRatings: 5,
  maxNegativeRatioDivisor: 5,
  defaultTaxRate: 0,
  defaultState: '',
  ...(globalThis.MarketMatchLib?.DEFAULT_SETTINGS || {}),
};
const sanitizeSettings = globalThis.MarketMatchLib?.sanitizeSettings;
const fetchProxyHealth = globalThis.MarketMatchLib?.fetchProxyHealth;

const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const brandInput = document.getElementById('brand');
const distanceScopeInput = document.getElementById('distanceScope');
const userStateInput = document.getElementById('userState');
const freeShippingOnlyInput = document.getElementById('freeShippingOnly');
const includeAuctionOnlyInput = document.getElementById('includeAuctionOnly');
const hideWorseConditionInput = document.getElementById('hideWorseCondition');
const hideLikelyMismatchInput = document.getElementById('hideLikelyMismatch');
const brandRequiredInput = document.getElementById('brandRequired');
const sellerStandingBoostInput = document.getElementById('sellerStandingBoost');
const consentCard = document.getElementById('consentCard');
const resultsNode = document.getElementById('results');
const resultsMetaNode = document.getElementById('resultsMeta');
const resultsDiagnosticsNode = document.getElementById('resultsDiagnostics');
const resultsSummaryNode = document.getElementById('resultsSummary');
const historySummaryNode = document.getElementById('historySummary');
const statusPillsNode = document.getElementById('statusPills');
const sourceListingSummaryNode = document.getElementById('sourceListingSummary');
const apiStatusNode = document.getElementById('apiStatus');

let currentSettings = { ...DEFAULT_SETTINGS };
let currentProxyHealth = { state: 'missing' };
let currentSourceListing = null;
let currentResults = [];
let sourceSyncTimer = null;
let lastSearchSourceSignature = '';
let activeSearchRequestId = 0;
let sourceSyncRevision = 0;
let activeSourceSyncPromise = Promise.resolve();
let activeProxyStatusRequestId = 0;

const FILTER_DEFAULTS = {
  distanceScope: 'any',
  sameLocationValue: '',
  brandRequired: false,
  brand: '',
  freeShippingOnly: false,
  includeAuctionOnly: false,
  hideWorseCondition: false,
  hideLikelyMismatch: false,
  minPositiveRatings: 5,
  maxNegativeRatioDivisor: 5,
  sellerStandingBoost: true,
  userState: '',
  defaultTaxRate: 0,
  ...(globalThis.MarketMatchLib?.DEFAULT_FILTERS || {}),
};

document.getElementById('captureListing').addEventListener('click', captureCurrentListing);
document.getElementById('searchEbayMatches').addEventListener('click', searchEbayMatches);
document.getElementById('applyFilters').addEventListener('click', applyFilters);
document.getElementById('resetSession').addEventListener('click', resetSession);
document.getElementById('allowCookies').addEventListener('click', () => saveConsent(true));
document.getElementById('declineCookies').addEventListener('click', () => saveConsent(false));
brandInput.addEventListener('input', scheduleActiveSourceSync);
titleInput.addEventListener('input', scheduleActiveSourceSync);
descriptionInput.addEventListener('input', scheduleActiveSourceSync);

bootstrap();

async function bootstrap() {
  const { draft, filters, consent, history, lastSearchSourceSignature: savedSearchSourceSignature, results, sourceListing, settings } = await chrome.storage.local.get([
    'draft',
    'filters',
    'consent',
    'history',
    'lastSearchSourceSignature',
    'results',
    'sourceListing',
    'settings',
  ]);

  const effectiveSettings = typeof sanitizeSettings === 'function'
    ? sanitizeSettings(settings || {})
    : { ...DEFAULT_SETTINGS, ...(settings || {}) };
  currentSettings = effectiveSettings;
  currentSourceListing = sourceListing || null;
  currentResults = results || [];
  restoreDraft(draft);
  lastSearchSourceSignature = String(savedSearchSourceSignature || '');
  restoreFilters(filters, effectiveSettings);
  updateConsentUI(consent);
  let renderedSourceChangeWarning = false;
  const activeSourceSignature = computeSourceSignature(readCurrentSourceListing());
  if (lastSearchSourceSignature && activeSourceSignature !== lastSearchSourceSignature) {
    currentResults = [];
    lastSearchSourceSignature = '';
    await chrome.storage.local.set({ results: [], lastSearchSourceSignature: '' });
    render({ message: 'Source changed since the last search. Re-run search for fresh matches.' });
    renderedSourceChangeWarning = true;
  }
  renderHistorySummary(history || []);
  renderResultsSummary(currentResults);
  renderResultsMeta();
  renderSourceListingSummary(readCurrentSourceListing());
  await refreshProxyStatus(filters, consent, effectiveSettings);

  if (history?.length && !renderedSourceChangeWarning) {
    render({ recentHistory: history.slice(0, 5) });
  }
}

async function captureCurrentListing() {
  await cancelPendingSourceSync();
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

  const capturedSource = buildCapturedSourceListing(response);
  const sameCapturedListing = isSameCapturedListing(currentSourceListing, capturedSource, tab?.url || '');
  const previousSignature = computeSourceSignature(readCurrentSourceListing());

  if (!response?.title || !response?.description) {
    if (!hasMeaningfulCapturedContent(response)) {
      render({
        error: 'Facebook capture did not find enough listing data. Fill the fields manually or try another Marketplace page variant.',
        notes: Array.isArray(response?.notes) ? response.notes : [],
      });
      return;
    }

    if (!sameCapturedListing) {
      brandInput.value = '';
      titleInput.value = '';
      descriptionInput.value = '';
    }
    applyCapturedDraftFields(response);

    const partialSourceListing = buildActiveSourceListing(mergeCapturedSource(capturedSource, tab?.url || ''));
    const nextSignature = computeSourceSignature(partialSourceListing);
    const sourceChanged = !sameCapturedListing || previousSignature !== nextSignature;
    await chrome.storage.local.set({
      sourceListing: partialSourceListing,
      ...(sourceChanged ? { results: [], lastSearchSourceSignature: '' } : {}),
    });
    currentSourceListing = partialSourceListing;
    if (sourceChanged) {
      currentResults = [];
      lastSearchSourceSignature = '';
    }
    renderSourceListingSummary(partialSourceListing);
    renderResultsMeta();
    renderResultsSummary(currentResults);
    await persistDraft();
    render({
      error: 'Facebook capture did not find both title and description. Fill missing fields manually or try another Marketplace page variant.',
      notes: Array.isArray(response?.notes) ? response.notes : [],
      captured: {
        title: response?.title || '',
        description: response?.description || '',
        listedPrice: response?.listedPrice ?? null,
        locationText: response?.locationText || '',
        sellerName: response?.sellerName || '',
      },
    });
    return;
  }

  applyCapturedDraftFields(response);

  const sourceListing = buildActiveSourceListing(mergeCapturedSource(capturedSource, tab?.url || ''));
  await chrome.storage.local.set({ sourceListing, results: [], lastSearchSourceSignature: '' });
  currentSourceListing = sourceListing;
  currentResults = [];
  lastSearchSourceSignature = '';
  renderSourceListingSummary(sourceListing);
  renderResultsMeta();
  renderResultsSummary([]);
  await persistDraft();
  await maybeSaveHistory({
    type: 'view',
    platform: 'facebook',
    title: response.title,
    query: buildDraftQuery(),
    url: response.url || tab.url || '',
  });
  renderStatusPills(await getSavedFilters(), await getSavedConsent(), currentSettings, currentProxyHealth);
  render(response);
}

async function searchEbayMatches() {
  await cancelPendingSourceSync();
  if (!titleInput.value.trim() || !descriptionInput.value.trim()) {
    render({ error: 'Title and description are both required before searching eBay.' });
    return;
  }

  const sourceInput = buildSourceInput();
  const query = buildDraftQuery();

  clearTimeout(sourceSyncTimer);
  lastSearchSourceSignature = '';
  await persistDraft();
  const activeSourceListing = buildActiveSourceListing();
  const requestSourceSignature = computeSourceSignature(activeSourceListing);
  const requestId = ++activeSearchRequestId;
  currentSourceListing = activeSourceListing;
  currentResults = [];
  await chrome.storage.local.set({ sourceListing: activeSourceListing, results: [], lastSearchSourceSignature: '' });
  renderSourceListingSummary(activeSourceListing);
  renderResultsMeta();
  renderResultsSummary([]);

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: 'SEARCH_EBAY_LISTINGS',
      payload: {
        query,
        ...sourceInput,
        includeAuctionOnly: includeAuctionOnlyInput.checked,
        sellerStandingBoost: sellerStandingBoostInput.checked,
        sourceListing: activeSourceListing,
        sourcePlatform: 'facebook',
      },
    });
  } catch {
    if (requestId !== activeSearchRequestId) return;
    render({ error: 'The background search failed before your eBay proxy returned results. Check your proxy settings and reload the extension.' });
    return;
  }

  if (requestId !== activeSearchRequestId) {
    return;
  }

  if (!response?.ok) {
    render(response || { error: 'eBay search failed.' });
    return;
  }

  if (computeSourceSignature(readCurrentSourceListing()) !== requestSourceSignature) {
    renderResultsMeta();
    renderResultsSummary([]);
    render({ message: 'Source changed while the search was running. Re-run search for fresh matches.' });
    return;
  }

  const matches = Array.isArray(response.matches) ? response.matches : [];
  currentResults = matches;
  lastSearchSourceSignature = requestSourceSignature;
  await chrome.storage.local.set({ results: matches, lastSearchSourceSignature: requestSourceSignature });
  renderResultsMeta(response.queryAttempts || [], response.query || query, matches.length);
  renderResultsSummary(matches);
  await maybeSaveHistory({
    type: 'search',
    platform: 'ebay',
    title: titleInput.value.trim(),
    query: response.query || query,
    url: response.requestMeta?.href || '',
  });
  render({
    ok: true,
    query: response.query,
    queryAttempts: response.queryAttempts || [],
    totalMatches: matches.length,
    requestMeta: response.requestMeta,
  });
}

async function applyFilters() {
  const saved = await getSavedFilters();
  const { settings } = await chrome.storage.local.get(['settings']);
  const effectiveSettings = typeof sanitizeSettings === 'function'
    ? sanitizeSettings(settings || {})
    : { ...DEFAULT_SETTINGS, ...(settings || {}) };
  currentSettings = effectiveSettings;

  const filters = {
    ...FILTER_DEFAULTS,
    minPositiveRatings: effectiveSettings.minPositiveRatings ?? FILTER_DEFAULTS.minPositiveRatings,
    maxNegativeRatioDivisor: effectiveSettings.maxNegativeRatioDivisor ?? FILTER_DEFAULTS.maxNegativeRatioDivisor,
    defaultTaxRate: effectiveSettings.defaultTaxRate ?? FILTER_DEFAULTS.defaultTaxRate,
    userState: effectiveSettings.defaultState ?? FILTER_DEFAULTS.userState,
    ...saved,
    distanceScope: distanceScopeInput.value,
    brandRequired: brandRequiredInput.checked,
    brand: brandInput.value.trim(),
    freeShippingOnly: freeShippingOnlyInput.checked,
    includeAuctionOnly: includeAuctionOnlyInput.checked,
    hideWorseCondition: hideWorseConditionInput.checked,
    hideLikelyMismatch: hideLikelyMismatchInput.checked,
    sellerStandingBoost: sellerStandingBoostInput.checked,
    userState: userStateInput.value.trim() || effectiveSettings.defaultState || '',
  };

  await chrome.storage.local.set({ filters });
  await persistDraft();
  await refreshProxyStatus(filters, await getSavedConsent(), effectiveSettings);
  render({ message: 'Saved Facebook-to-eBay comparison filters.' });
}

async function resetSession() {
  await cancelPendingSourceSync();
  const createEmptySessionState = globalThis.MarketMatchLib?.createEmptySessionState;
  const emptyState = typeof createEmptySessionState === 'function'
    ? createEmptySessionState()
    : { draft: { brand: '', title: '', description: '' }, sourceListing: null, lastSearchSourceSignature: '', results: [] };

  await chrome.storage.local.set({
    draft: emptyState.draft,
    sourceListing: emptyState.sourceListing,
    lastSearchSourceSignature: '',
    results: emptyState.results,
  });

  currentSourceListing = null;
  currentResults = emptyState.results;
  lastSearchSourceSignature = '';
  activeSearchRequestId += 1;
  restoreDraft(emptyState.draft);
  renderSourceListingSummary(null);
  renderResultsMeta();
  renderResultsSummary([]);
  render({ message: 'Cleared Facebook source listing and eBay matches.' });
}

async function saveConsent(allowed) {
  const consent = {
    cookiesPrompted: true,
    cookiesAllowed: allowed,
    historyAllowed: allowed,
  };

  await chrome.storage.local.set({ consent });
  updateConsentUI(consent);
  renderStatusPills(await getSavedFilters(), consent, currentSettings, currentProxyHealth);
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

async function refreshProxyStatus(filters = {}, consent = {}, settings = {}) {
  const requestId = ++activeProxyStatusRequestId;

  if (!settings?.ebayProxyBaseUrl) {
    currentProxyHealth = { state: 'missing' };
    renderStatusPills(filters, consent, settings, currentProxyHealth);
    renderApiStatus(settings, currentProxyHealth);
    return;
  }

  currentProxyHealth = { state: 'loading' };
  renderStatusPills(filters, consent, settings, currentProxyHealth);
  renderApiStatus(settings, currentProxyHealth);

  const proxyHealth = typeof fetchProxyHealth === 'function'
    ? await fetchProxyHealth(settings)
    : { state: 'unknown' };

  if (requestId !== activeProxyStatusRequestId) {
    return;
  }

  currentProxyHealth = proxyHealth;
  renderStatusPills(filters, consent, settings, currentProxyHealth);
  renderApiStatus(settings, currentProxyHealth);
}

function renderApiStatus(settings = {}, proxyHealth = currentProxyHealth) {
  if (!settings?.ebayProxyBaseUrl) {
    apiStatusNode.textContent = 'No eBay proxy configured yet. Add one in Options before searching.';
    return;
  }

  const suffix = ` at ${settings.ebayProxyBaseUrl} for ${settings.ebayMarketplaceId || 'EBAY_US'}${settings.endUserZip ? ` · ZIP ${settings.endUserZip}` : ''}`;
  if (proxyHealth?.state === 'loading') {
    apiStatusNode.textContent = `Checking eBay proxy health${suffix}`;
    return;
  }

  if (proxyHealth?.state === 'ok' && proxyHealth.ready) {
    apiStatusNode.textContent = `Proxy ready${suffix}${proxyHealth.environment ? ` · ${proxyHealth.environment}` : ''}`;
    return;
  }

  if (proxyHealth?.state === 'ok') {
    apiStatusNode.textContent = `Proxy reachable, but eBay credentials are missing on the server${suffix}`;
    return;
  }

  if (proxyHealth?.status === 401) {
    apiStatusNode.textContent = `Proxy reachable, but the access key was rejected${suffix}`;
    return;
  }

  if (proxyHealth?.status === 429) {
    apiStatusNode.textContent = `Proxy is rate limited right now${suffix}`;
    return;
  }

  apiStatusNode.textContent = `Proxy unreachable${proxyHealth?.error ? `: ${proxyHealth.error}` : ''}${suffix}`;
}

function renderResultsMeta(queryAttempts = [], selectedQuery = '', matchCount = null) {
  if (!resultsMetaNode) return;

  if (!queryAttempts.length) {
    resultsMetaNode.textContent = '';
    return;
  }

  const attemptLabel = queryAttempts.length === 1 ? '1 search variant tried' : `${queryAttempts.length} search variants tried`;
  const usedQuery = selectedQuery || queryAttempts[0]?.query || '';
  const countLabel = matchCount == null ? '' : ` · ${matchCount} matches after dedupe`;
  const queryLabel = queryAttempts.length > 1 ? 'best search variant' : 'query';
  const fixedPriceAttempted = queryAttempts.some((attempt) => attempt?.mode === 'fixed-price-first');
  const modeLabel = fixedPriceAttempted ? ' · fixed-price first' : '';
  resultsMetaNode.textContent = `${attemptLabel}${countLabel}${modeLabel}${usedQuery ? ` · ${queryLabel}: ${usedQuery}` : ''}`;
}

function renderResultsSummary(results = []) {
  if (!results.length) {
    renderResultsDiagnostics([]);
    resultsSummaryNode.innerHTML = `<div class="miniItem"><strong>No eBay matches yet</strong><div class="miniMeta">Capture a Facebook listing, then search eBay matches from the popup.</div></div>`;
    return;
  }

  const { rankedResults, evaluations } = evaluateResultsForDisplay(results);
  renderResultsDiagnostics(evaluations, rankedResults.length);
  if (!rankedResults.length) {
    resultsSummaryNode.innerHTML = `<div class="miniItem"><strong>No matches passed the current filters</strong><div class="miniMeta">Relax shipping, brand, seller, or location filters and try again.</div></div>`;
    return;
  }

  resultsSummaryNode.innerHTML = rankedResults.slice(0, 5).map((result, index) => {
    const flags = buildFlags(result);
    const searchUrl = buildEbaySearchUrl(result.title || '');
    const comparisonSummary = result.comparisonSummary || {};
    const highlights = Array.isArray(comparisonSummary.highlights) ? comparisonSummary.highlights : [];
    const mismatches = Array.isArray(comparisonSummary.mismatches) ? comparisonSummary.mismatches : [];
    const priceDelta = formatPriceDelta(comparisonSummary.priceDelta, comparisonSummary.sourcePriceConfidence);
    const queryVariantLabel = describeQueryVariantHits(result.queryVariantHits);
    const confidenceLabel = `${Number(result.matchConfidence || 0).toFixed(0)} confidence`;
    return `
      <div class="matchCard${index === 0 ? ' featured' : ''}">
        <div class="matchHeader">
          <div class="matchTitle">
            <strong>${escapeHtml(result.title || 'Untitled eBay match')}</strong>
            <div class="miniMeta">${escapeHtml(result.matchReason || result.condition || 'eBay Browse API match')}</div>
          </div>
          <div class="priceBlock">
            ${index === 0 ? '<div class="flag featured">Best Comparable</div>' : ''}
            <div class="metricLabel">Landed cost</div>
            <strong>$${Number(result.totalCost || 0).toFixed(2)}</strong>
          </div>
        </div>
        <div class="resultSummaryLine">
          <span class="summaryChip"><strong>${escapeHtml(confidenceLabel)}</strong></span>
          ${queryVariantLabel ? `<span class="summaryChip alt">${escapeHtml(queryVariantLabel)}</span>` : ''}
          ${result.matchedTokens?.length ? `<span class="summaryChip alt">${escapeHtml(result.matchedTokens.join(', '))}</span>` : ''}
        </div>
        <div class="metricGrid">
          <div class="metric">
            <div class="metricLabel">Item price</div>
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
        ${priceDelta ? `<div class="miniMeta">${escapeHtml(priceDelta)}</div>` : ''}
        ${highlights.length ? `<div class="flagRow">${highlights.map((item) => `<span class="flag">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        ${mismatches.length ? `<div class="watchoutBox"><div class="miniMeta"><strong>Watchouts:</strong> ${escapeHtml(mismatches.join(' · '))}</div></div>` : ''}
        <div class="miniMeta">Seller ${escapeHtml(result.sellerName || 'unknown')} ${result.sellerStanding ? `· ${escapeHtml(result.sellerStanding)}` : ''}${result.locationText ? ` · ${escapeHtml(result.locationText)}` : ''}${Array.isArray(result.buyingOptions) && result.buyingOptions.length ? ` · ${escapeHtml(result.buyingOptions.join(', '))}` : ''}</div>
        <div class="miniMeta">Item $${Number(result.listedPrice || 0).toFixed(2)} · Shipping ${formatCurrencyOrUnknown(result.shipping)} · Tax $${Number(result.taxes || 0).toFixed(2)}</div>
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
      <div class="miniMeta">${escapeHtml(sourceListing.locationText || 'location unavailable')}${sourceListing.locationConfidence === 'weak' ? ' · location inferred' : ''}${sourceListing.bestOfferDetected ? ' · offer language detected' : ''}${sourceListing.placeholderPriceFlag ? ' · placeholder price flagged' : ''}${sourceListing.brand ? ` · brand ${escapeHtml(sourceListing.brand)}` : ''}</div>
    </div>
  `;
}

function renderResultsDiagnostics(evaluations = [], passedCount = 0) {
  if (!resultsDiagnosticsNode) return;

  const excluded = evaluations.filter((evaluation) => !evaluation.passed);
  if (!excluded.length) {
    resultsDiagnosticsNode.textContent = '';
    return;
  }

  const reasonCounts = new Map();
  for (const evaluation of excluded) {
    for (const reason of evaluation.reasons) {
      reasonCounts.set(reason, Number(reasonCounts.get(reason) || 0) + 1);
    }
  }

  const reasonSummary = [...reasonCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([reason, count]) => `${formatFilterReason(reason)} (${count})`)
    .join(' · ');

  const shownLabel = passedCount > 0 ? `${passedCount} shown` : 'none shown';
  resultsDiagnosticsNode.textContent = `${excluded.length} filtered out · ${shownLabel}${reasonSummary ? ` · ${reasonSummary}` : ''}`;
}

function renderStatusPills(filters = {}, consent = {}, settings = {}, proxyHealth = currentProxyHealth) {
  const pills = [
    'Facebook Source',
    'eBay API',
    describeProxyStatusPill(settings, proxyHealth),
    consent?.historyAllowed ? 'History Enabled' : 'History Off',
    filters?.freeShippingOnly ? 'Free Ship Only' : 'Any Shipping',
    filters?.includeAuctionOnly ? 'Auctions Included' : 'Fixed Price Focus',
    filters?.hideWorseCondition ? 'Hide Worse Condition' : 'Mixed Conditions',
    filters?.hideLikelyMismatch ? 'Hide Likely Mismatch' : 'Mismatch Watchouts Only',
    filters?.sellerStandingBoost !== false ? 'Seller Boost On' : 'Seller Boost Off',
  ];

  statusPillsNode.innerHTML = pills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join('');
}

function describeProxyStatusPill(settings = {}, proxyHealth = currentProxyHealth) {
  if (!settings?.ebayProxyBaseUrl) return 'Proxy Missing';
  if (proxyHealth?.state === 'loading') return 'Proxy Checking';
  if (proxyHealth?.state === 'ok' && proxyHealth.ready) return 'Proxy Ready';
  if (proxyHealth?.state === 'ok') return 'Proxy Missing eBay Config';
  if (proxyHealth?.status === 401) return 'Proxy Auth Rejected';
  if (proxyHealth?.status === 429) return 'Proxy Rate Limited';
  if (proxyHealth?.state === 'error') return 'Proxy Unreachable';
  return 'Proxy Configured';
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
    minPositiveRatings: settings.minPositiveRatings ?? FILTER_DEFAULTS.minPositiveRatings,
    maxNegativeRatioDivisor: settings.maxNegativeRatioDivisor ?? FILTER_DEFAULTS.maxNegativeRatioDivisor,
    defaultTaxRate: settings.defaultTaxRate ?? FILTER_DEFAULTS.defaultTaxRate,
    userState: settings.defaultState ?? FILTER_DEFAULTS.userState,
    ...(filters || {}),
  };

  distanceScopeInput.value = merged.distanceScope;
  userStateInput.value = merged.userState;
  freeShippingOnlyInput.checked = Boolean(merged.freeShippingOnly);
  includeAuctionOnlyInput.checked = Boolean(merged.includeAuctionOnly);
  hideWorseConditionInput.checked = Boolean(merged.hideWorseCondition);
  hideLikelyMismatchInput.checked = Boolean(merged.hideLikelyMismatch);
  brandRequiredInput.checked = Boolean(merged.brandRequired);
  sellerStandingBoostInput.checked = merged.sellerStandingBoost !== false;
}

function buildDraftQuery() {
  const normalizeSearchInput = globalThis.MarketMatchLib?.normalizeSearchInput;
  if (typeof normalizeSearchInput === 'function') {
    return normalizeSearchInput(buildSourceInput()).query;
  }

  return Object.values(buildSourceInput())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSourceInput() {
  const activeSourceListing = buildActiveSourceListing() || {};
  return {
    brand: activeSourceListing.brand || '',
    title: activeSourceListing.title || '',
    description: activeSourceListing.description || '',
  };
}

function buildActiveSourceListing(overrideSource = null) {
  const baseSource = overrideSource || currentSourceListing || {};
  const title = titleInput.value.trim();
  const description = descriptionInput.value.trim();
  const brand = brandInput.value.trim();
  const hasBaseSource = Object.keys(baseSource).length > 0;
  if (!hasBaseSource && !title && !description) {
    return null;
  }

  return {
    ...baseSource,
    platform: baseSource.platform || 'facebook',
    brand,
    title,
    description,
    listedPrice: baseSource.listedPrice ?? null,
    descriptionPriceHint: baseSource.descriptionPriceHint ?? null,
    condition: baseSource.condition || '',
    sellerName: baseSource.sellerName || '',
    sellerStanding: baseSource.sellerStanding || '',
    positiveRatings: baseSource.positiveRatings ?? null,
    negativeRatings: baseSource.negativeRatings ?? null,
    locationText: baseSource.locationText || '',
    locationConfidence: baseSource.locationConfidence || 'missing',
    url: baseSource.url || '',
    bestOfferDetected: Boolean(baseSource.bestOfferDetected),
    placeholderPriceFlag: Boolean(baseSource.placeholderPriceFlag),
    notes: Array.isArray(baseSource.notes) ? baseSource.notes : [],
  };
}

function buildCapturedSourceListing(source = {}) {
  return {
    platform: source.platform || 'facebook',
    title: source.title || '',
    description: source.description || '',
    listedPrice: source.listedPrice ?? null,
    descriptionPriceHint: source.descriptionPriceHint ?? null,
    shipping: source.shipping ?? null,
    taxes: source.taxes ?? null,
    condition: source.condition || '',
    sellerName: source.sellerName || '',
    sellerStanding: source.sellerStanding || '',
    positiveRatings: source.positiveRatings ?? null,
    negativeRatings: source.negativeRatings ?? null,
    locationText: source.locationText || '',
    locationConfidence: source.locationConfidence || 'missing',
    url: source.url || '',
    bestOfferDetected: Boolean(source.bestOfferDetected),
    placeholderPriceFlag: Boolean(source.placeholderPriceFlag),
    notes: Array.isArray(source.notes) ? source.notes : [],
  };
}

function mergeCapturedSource(capturedSource = {}, activeTabUrl = '') {
  const existingSource = currentSourceListing || {};
  const sameListing = isSameCapturedListing(existingSource, capturedSource, activeTabUrl);
  const baseSource = sameListing ? existingSource : {};
  return {
    ...baseSource,
    ...capturedSource,
    title: capturedSource.title || baseSource.title || '',
    description: capturedSource.description || baseSource.description || '',
    listedPrice: capturedSource.listedPrice ?? baseSource.listedPrice ?? null,
    descriptionPriceHint: capturedSource.descriptionPriceHint ?? baseSource.descriptionPriceHint ?? null,
    condition: capturedSource.condition || baseSource.condition || '',
    sellerName: capturedSource.sellerName || baseSource.sellerName || '',
    sellerStanding: capturedSource.sellerStanding || baseSource.sellerStanding || '',
    positiveRatings: capturedSource.positiveRatings ?? baseSource.positiveRatings ?? null,
    negativeRatings: capturedSource.negativeRatings ?? baseSource.negativeRatings ?? null,
    locationText: capturedSource.locationText || baseSource.locationText || '',
    locationConfidence: capturedSource.locationConfidence || baseSource.locationConfidence || 'missing',
    url: capturedSource.url || baseSource.url || activeTabUrl || '',
    bestOfferDetected: Boolean(capturedSource.bestOfferDetected || baseSource.bestOfferDetected),
    placeholderPriceFlag: Boolean(capturedSource.placeholderPriceFlag || baseSource.placeholderPriceFlag),
    notes: Array.isArray(capturedSource.notes) && capturedSource.notes.length ? capturedSource.notes : (Array.isArray(baseSource.notes) ? baseSource.notes : []),
  };
}

function isSameCapturedListing(existingSource = {}, capturedSource = {}, activeTabUrl = '') {
  const existingUrl = normalizeListingUrl(existingSource.url || '');
  const capturedUrl = normalizeListingUrl(capturedSource.url || activeTabUrl || '');
  return Boolean(existingUrl && capturedUrl && existingUrl === capturedUrl);
}

function normalizeListingUrl(url = '') {
  const value = String(url || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^(m|www)\./, '');
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return value
      .replace(/[?#].*$/, '')
      .replace(/^https?:\/\/(m|www)\./i, 'https://')
      .replace(/\/+$/, '');
  }
}

function applyCapturedDraftFields(source = {}) {
  if (source?.title) titleInput.value = source.title;
  if (source?.description) descriptionInput.value = source.description;
}

function scheduleActiveSourceSync() {
  clearTimeout(sourceSyncTimer);
  sourceSyncTimer = setTimeout(() => {
    sourceSyncTimer = null;
    activeSourceSyncPromise = syncActiveSourceListing().catch(() => {});
  }, 150);
}

async function cancelPendingSourceSync() {
  clearTimeout(sourceSyncTimer);
  sourceSyncTimer = null;
  sourceSyncRevision += 1;
  await activeSourceSyncPromise;
}

async function syncActiveSourceListing() {
  const syncRevision = ++sourceSyncRevision;
  const draftSnapshot = {
    brand: brandInput.value.trim(),
    title: titleInput.value.trim(),
    description: descriptionInput.value.trim(),
  };
  const nextSourceListing = buildActiveSourceListing();
  const nextSignature = computeSourceSignature(nextSourceListing);
  const sourceChangedSinceSearch = Boolean(lastSearchSourceSignature) && nextSignature !== lastSearchSourceSignature;
  const nextResults = sourceChangedSinceSearch ? [] : currentResults;
  const nextSearchSourceSignature = sourceChangedSinceSearch ? '' : lastSearchSourceSignature;

  if (syncRevision !== sourceSyncRevision) {
    return;
  }

  const storagePayload = {
    draft: draftSnapshot,
    sourceListing: nextSourceListing,
    ...(sourceChangedSinceSearch ? { results: [], lastSearchSourceSignature: '' } : {}),
  };

  await chrome.storage.local.set(storagePayload);
  if (syncRevision !== sourceSyncRevision) {
    return;
  }

  currentSourceListing = nextSourceListing;
  if (sourceChangedSinceSearch) {
    currentResults = [];
    lastSearchSourceSignature = '';
  } else {
    currentResults = nextResults;
    lastSearchSourceSignature = nextSearchSourceSignature;
  }
  renderSourceListingSummary(currentSourceListing);
  if (sourceChangedSinceSearch) {
    renderResultsMeta();
    render({ message: 'Source changed. Re-run search for fresh matches.' });
  }
  renderResultsSummary(currentResults);
}

function computeSourceSignature(sourceListing) {
  if (!sourceListing) return '';
  return JSON.stringify({
    brand: sourceListing.brand || '',
    title: sourceListing.title || '',
    description: sourceListing.description || '',
    listedPrice: sourceListing.listedPrice ?? null,
    descriptionPriceHint: sourceListing.descriptionPriceHint ?? null,
    condition: sourceListing.condition || '',
    locationText: sourceListing.locationText || '',
    bestOfferDetected: Boolean(sourceListing.bestOfferDetected),
    placeholderPriceFlag: Boolean(sourceListing.placeholderPriceFlag),
  });
}

function hasMeaningfulCapturedContent(source = {}) {
  return Boolean(
    source?.title
    || source?.description
    || source?.listedPrice != null
    || source?.descriptionPriceHint != null
    || source?.condition
    || source?.sellerName
    || source?.locationText
    || source?.url
  );
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

function evaluateResultsForDisplay(results) {
  const sourceListing = readCurrentSourceListing();
  const evaluations = results.map((result) => evaluateResultAgainstFilters(result, sourceListing));
  return {
    evaluations,
    rankedResults: rankResultsForDisplay(evaluations.filter((evaluation) => evaluation.passed).map((evaluation) => evaluation.result)),
  };
}

function passesActiveFilters(result, sourceListing) {
  return evaluateResultAgainstFilters(result, sourceListing).passed;
}

function evaluateResultAgainstFilters(result, sourceListing) {
  const reasons = [];

  if (freeShippingOnlyInput.checked && Number(result.shipping) !== 0) {
    reasons.push('free-shipping');
  }

  if (!includeAuctionOnlyInput.checked && result.isAuctionOnly) {
    reasons.push('auction-only');
  }

  if (hideWorseConditionInput.checked && result?.comparisonSummary?.conditionComparison === 'clearly-worse') {
    reasons.push('worse-condition');
  }

  const isLikelyMismatch = globalThis.MarketMatchLib?.isLikelyMismatch;
  if (hideLikelyMismatchInput.checked && typeof isLikelyMismatch === 'function' && isLikelyMismatch(result)) {
    reasons.push('likely-mismatch');
  }

  if (brandRequiredInput.checked) {
    const brand = brandInput.value.trim().toLowerCase();
    if (brand && !String(result.title || '').toLowerCase().includes(brand)) {
      reasons.push('brand-mismatch');
    }
  }

  const passesSellerRating = globalThis.MarketMatchLib?.passesSellerRating;
  if (typeof passesSellerRating === 'function' && !passesSellerRating(result, {
    minPositiveRatings: Number(currentSettings.minPositiveRatings ?? FILTER_DEFAULTS.minPositiveRatings),
    maxNegativeRatioDivisor: Number(currentSettings.maxNegativeRatioDivisor ?? FILTER_DEFAULTS.maxNegativeRatioDivisor),
  })) {
    reasons.push('seller-threshold');
  }

  if (!passesDistanceFilter(result, sourceListing)) {
    reasons.push(`distance-${distanceScopeInput.value}`);
  }

  return {
    result,
    passed: reasons.length === 0,
    reasons,
  };
}

function passesDistanceFilter(result, sourceListing) {
  const scope = distanceScopeInput.value;
  if (scope === 'any') return true;

  const normalizeLocationText = globalThis.MarketMatchLib?.normalizeLocationText;
  if (typeof normalizeLocationText !== 'function') return true;

  const sourceLocation = normalizeLocationText(sourceListing?.locationText, {
    fallbackState: userStateInput.value.trim(),
  });
  const resultLocation = normalizeLocationText(result.locationText);
  if (!sourceLocation.hasSignal || !resultLocation.hasSignal) return false;

  if (scope === 'city') {
    return Boolean(sourceLocation.city)
      && Boolean(resultLocation.city)
      && sourceLocation.city === resultLocation.city
      && (!sourceLocation.state || !resultLocation.state || sourceLocation.state === resultLocation.state);
  }

  if (scope === 'state') {
    return Boolean(sourceLocation.state) && sourceLocation.state === resultLocation.state;
  }

  if (scope === 'country') {
    return Boolean(sourceLocation.country) && sourceLocation.country === resultLocation.country;
  }

  return true;
}

function buildFlags(result) {
  const flags = [];
  const priceBandComparison = result?.comparisonSummary?.priceBandComparison;
  const isLikelyMismatch = globalThis.MarketMatchLib?.isLikelyMismatch;
  if (result.bestOfferDetected) flags.push('Best Offer');
  if (result.isAuctionOnly) flags.push('Auction Only');
  if (result?.comparisonSummary?.conditionComparison === 'clearly-worse') flags.push('Worse Condition');
  if (Number(result.shipping) === 0) flags.push('Free Shipping');
  if (result.shipping == null) flags.push('Shipping Unknown');
  if (result.sellerStanding) flags.push('Seller Signal');
  if (Array.isArray(result.variantMismatchSignals) && result.variantMismatchSignals.length) flags.push('Possible Variant Mismatch');
  if (priceBandComparison === 'far-below' || priceBandComparison === 'far-above') flags.push('Price Watchout');
  if (typeof isLikelyMismatch === 'function' && isLikelyMismatch(result)) flags.push('Likely Mismatch');
  if (result.locationText) flags.push(result.locationText);
  return flags;
}

function formatFilterReason(reason) {
  if (reason === 'free-shipping') return 'shipping filter';
  if (reason === 'auction-only') return 'auction-only hidden';
  if (reason === 'worse-condition') return 'worse-condition hidden';
  if (reason === 'likely-mismatch') return 'likely mismatch hidden';
  if (reason === 'brand-mismatch') return 'brand mismatch';
  if (reason === 'seller-threshold') return 'seller threshold';
  if (reason === 'distance-city') return 'different city';
  if (reason === 'distance-state') return 'different state';
  if (reason === 'distance-country') return 'different country';
  return 'other filter';
}

function describeQueryVariantHits(queryVariantHits) {
  const hits = Number(queryVariantHits || 0);
  if (hits > 1) return 'Matched multiple search variants';
  return '';
}

function formatPriceDelta(value, sourcePriceConfidence = 'strong') {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const delta = Number(value);
  const reference = sourcePriceConfidence === 'weak' ? 'source price hint' : 'source listing';
  if (delta === 0) return `Total cost is about even with the ${reference}`;
  if (delta < 0) return `Total cost is about $${Math.abs(delta).toFixed(2)} below the ${reference}`;
  return `Total cost is about $${delta.toFixed(2)} above the ${reference}`;
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
  return buildActiveSourceListing();
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
