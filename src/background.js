if (typeof importScripts === 'function') {
  importScripts(
    'lib/state.js',
    'lib/normalize.js',
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
  const buildQueryVariants = globalThis.MarketMatchLib?.buildQueryVariants;

  if (typeof searchEbayBrowse !== 'function') {
    return { ok: false, error: 'eBay API helper is not loaded.' };
  }

  const sourceInput = {
    brand: String(payload.brand || '').trim(),
    title: String(payload.title || '').trim(),
    description: String(payload.description || '').trim(),
  };

  const candidateQueries = buildCandidateQueries({
    payloadQuery: payload.query,
    sourceInput,
    buildQueryVariants,
  });

  if (!candidateQueries.length) {
    return { ok: false, error: 'Search query is required.' };
  }

  if (!settings?.ebayApplicationToken) {
    return {
      ok: false,
      error: 'Missing eBay application token. Add one in extension options before searching.',
    };
  }

  const searchLimit = Number(settings.ebayLimit || 10);
  const searchAttempts = [];
  const matchMap = new Map();
  let lastResponse = null;

  for (const candidateQuery of candidateQueries.slice(0, 3)) {
    const response = await searchEbayBrowse({
      query: candidateQuery,
      token: settings.ebayApplicationToken,
      marketplaceId: settings.ebayMarketplaceId || 'EBAY_US',
      limit: searchLimit,
      endUserZip: settings.endUserZip || '',
    });

    lastResponse = response;
    searchAttempts.push({
      query: candidateQuery,
      returned: Array.isArray(response.matches) ? response.matches.length : 0,
      total: Number(response.requestMeta?.total || 0),
    });

    for (const match of (response.matches || [])) {
      const key = match.id || match.url || `${match.title}-${match.listedPrice}`;
      if (!matchMap.has(key)) {
        matchMap.set(key, match);
      }
    }

    if (matchMap.size >= Math.min(searchLimit, 5)) {
      break;
    }
  }

  const query = searchAttempts.find((attempt) => attempt.returned > 0)?.query || candidateQueries[0];
  const dedupedMatches = Array.from(matchMap.values()).slice(0, Math.max(1, searchLimit));

  const matches = typeof enrichEbayMatches === 'function'
    ? await enrichEbayMatches({
      matches: dedupedMatches,
      token: settings.ebayApplicationToken,
      marketplaceId: settings.ebayMarketplaceId || 'EBAY_US',
      endUserZip: settings.endUserZip || '',
      topN: 3,
    })
    : dedupedMatches;

  return {
    ok: true,
    query,
    sourcePlatform: payload.sourcePlatform || 'facebook',
    matches,
    queryAttempts: searchAttempts,
    requestMeta: {
      ...(lastResponse?.requestMeta || {}),
      attemptedQueries: searchAttempts,
      selectedQuery: query,
      dedupedCount: matches.length,
    },
  };
}

function buildCandidateQueries({ payloadQuery, sourceInput, buildQueryVariants }) {
  const queries = [];
  const initialQuery = String(payloadQuery || '').trim();
  if (initialQuery) {
    queries.push(initialQuery);
  }

  if (typeof buildQueryVariants === 'function') {
    const variants = buildQueryVariants(sourceInput || {});
    queries.push(...(variants?.queries || []));
  }

  return [...new Set(queries.map((query) => String(query || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
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
