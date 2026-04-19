if (typeof importScripts === 'function') {
  importScripts(
    'lib/state.js',
    'lib/ebay-api.js',
    'adapters/registry.js',
    'adapters/facebook.js'
  );
}

const DEFAULT_FILTERS = {
  distanceScope: 'any',
  sameLocationValue: '',
  minPositiveRatings: 5,
  maxNegativeRatioDivisor: 5,
  ...(globalThis.MarketMatchLib?.DEFAULT_FILTERS || {}),
};

const DEFAULT_CONSENT = {
  ...(globalThis.MarketMatchLib?.DEFAULT_CONSENT || {}),
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    'filters',
    'sourceListing',
    'results',
    'draft',
    'history',
    'consent',
    'settings',
  ]);

  await chrome.storage.local.set({
    filters: { ...DEFAULT_FILTERS, ...(current.filters || {}) },
    sourceListing: current.sourceListing || null,
    results: current.results || [],
    draft: current.draft || null,
    history: current.history || [],
    consent: { ...DEFAULT_CONSENT, ...(current.consent || {}) },
    settings: {
      ebayApplicationToken: '',
      ebayMarketplaceId: 'EBAY_US',
      ebayLimit: 10,
      endUserZip: '',
      minPositiveRatings: 5,
      maxNegativeRatioDivisor: 5,
      defaultTaxRate: 0,
      defaultState: '',
      ...(current.settings || {}),
    },
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_PLATFORM') {
    const url = sender.tab?.url || '';
    sendResponse({ platform: detectPlatform(url) });
    return;
  }

  if (message?.type === 'SAVE_HISTORY') {
    saveHistoryEntry(message.entry).then((history) => sendResponse({ history }));
    return true;
  }

  if (message?.type === 'SEARCH_EBAY_LISTINGS') {
    searchEbayListings(message.payload)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'eBay search failed.' }));
    return true;
  }
});

function detectPlatform(url) {
  if (url.includes('facebook.com')) return 'facebook';
  if (url.includes('ebay.com')) return 'ebay';
  return 'unknown';
}

async function searchEbayListings(payload = {}) {
  const { settings } = await chrome.storage.local.get(['settings']);
  const searchEbayBrowse = globalThis.MarketMatchLib?.searchEbayBrowse;
  const enrichEbayMatches = globalThis.MarketMatchLib?.enrichEbayMatches;

  if (typeof searchEbayBrowse !== 'function') {
    return { ok: false, error: 'eBay API helper is not loaded.' };
  }

  const query = String(payload.query || '').trim();
  if (!query) {
    return { ok: false, error: 'Search query is required.' };
  }

  if (!settings?.ebayApplicationToken) {
    return {
      ok: false,
      error: 'Missing eBay application token. Add one in extension options before searching.',
    };
  }

  const response = await searchEbayBrowse({
    query,
    token: settings.ebayApplicationToken,
    marketplaceId: settings.ebayMarketplaceId || 'EBAY_US',
    limit: Number(settings.ebayLimit || 10),
    endUserZip: settings.endUserZip || '',
  });

  const matches = typeof enrichEbayMatches === 'function'
    ? await enrichEbayMatches({
      matches: response.matches || [],
      token: settings.ebayApplicationToken,
      marketplaceId: settings.ebayMarketplaceId || 'EBAY_US',
      endUserZip: settings.endUserZip || '',
      topN: 3,
    })
    : (response.matches || []);

  return {
    ok: true,
    query,
    sourcePlatform: payload.sourcePlatform || 'facebook',
    matches,
    requestMeta: response.requestMeta || {},
  };
}

async function saveHistoryEntry(entry) {
  const { consent, history } = await chrome.storage.local.get(['consent', 'history']);
  if (!consent?.historyAllowed) {
    return history || [];
  }

  const nextHistory = [
    {
      ...entry,
      createdAt: entry?.createdAt || Date.now(),
    },
    ...(history || []),
  ].slice(0, 50);

  await chrome.storage.local.set({ history: nextHistory });
  return nextHistory;
}
