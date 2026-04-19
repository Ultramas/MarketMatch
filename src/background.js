if (typeof importScripts === 'function') {
  importScripts(
    'lib/state.js',
    'lib/normalize.js',
    'lib/filters.js',
    'lib/ranking.js',
    'lib/ebay-api.js',
    'adapters/registry.js',
    'adapters/facebook.js'
  );
}

const DEFAULT_FILTERS = {
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
  couponOptIn: false,
  ...(globalThis.MarketMatchLib?.DEFAULT_FILTERS || {}),
};

const DEFAULT_SETTINGS = {
  ebayApplicationToken: '',
  ebayMarketplaceId: 'EBAY_US',
  ebayLimit: 10,
  endUserZip: '',
  minPositiveRatings: 5,
  maxNegativeRatioDivisor: 5,
  defaultTaxRate: 0,
  defaultState: '',
  ...(globalThis.MarketMatchLib?.DEFAULT_SETTINGS || {}),
};

const DEFAULT_CONSENT = {
  ...(globalThis.MarketMatchLib?.DEFAULT_CONSENT || {}),
};

const MAX_QUERY_ATTEMPTS = 3;
const ENRICH_TOP_MATCHES = 3;
const EARLY_STOP_MIN_MATCHES = 6;
const EARLY_STOP_TOP_MATCHES = 4;
const HIGH_CONFIDENCE_MATCH = 42;
const MULTI_QUERY_CONFIDENCE_MATCH = 24;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    'filters',
    'sourceListing',
    'results',
    'lastSearchSourceSignature',
    'draft',
    'history',
    'consent',
    'settings',
  ]);

  await chrome.storage.local.set({
    filters: { ...DEFAULT_FILTERS, ...(current.filters || {}) },
    sourceListing: current.sourceListing || null,
    results: current.results || [],
    lastSearchSourceSignature: current.lastSearchSourceSignature || '',
    draft: current.draft || null,
    history: current.history || [],
    consent: { ...DEFAULT_CONSENT, ...(current.consent || {}) },
    settings: { ...DEFAULT_SETTINGS, ...(current.settings || {}) },
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
  const rankResults = globalThis.MarketMatchLib?.rankResults;
  const buildComparableResult = globalThis.MarketMatchLib?.buildComparableResult;
  const activeSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

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

  if (!activeSettings.ebayApplicationToken) {
    return {
      ok: false,
      error: 'Missing eBay application token. Add one in extension options before searching.',
    };
  }

  const searchLimit = Number(activeSettings.ebayLimit || DEFAULT_SETTINGS.ebayLimit);
  const sourceListing = buildSearchSourceListing(payload.sourceListing, sourceInput);
  const rankingOptions = {
    defaultTaxRate: Number(activeSettings.defaultTaxRate || DEFAULT_SETTINGS.defaultTaxRate),
    sellerStandingBoost: payload.sellerStandingBoost !== false,
    sourceListing,
  };
  const searchAttempts = [];
  const matchMap = new Map();

  for (const candidateQuery of candidateQueries.slice(0, MAX_QUERY_ATTEMPTS)) {
    const response = await searchEbayBrowse({
      query: candidateQuery,
      token: activeSettings.ebayApplicationToken,
      marketplaceId: activeSettings.ebayMarketplaceId || DEFAULT_SETTINGS.ebayMarketplaceId,
      limit: searchLimit,
      endUserZip: activeSettings.endUserZip || '',
    });

    const attemptMatches = (response.matches || []).map((match) => attachQueryVariant(match, candidateQuery));
    const rankedAttemptMatches = rankMatchesForSearch(attemptMatches, rankingOptions, rankResults);
    const attemptSummary = summarizeSearchAttempt(rankedAttemptMatches);

    searchAttempts.push({
      query: candidateQuery,
      returned: attemptMatches.length,
      total: Number(response.requestMeta?.total || 0),
      topConfidence: attemptSummary.topConfidence,
      strongMatches: attemptSummary.strongMatches,
      qualityScore: attemptSummary.qualityScore,
      requestMeta: response.requestMeta || {},
    });

    for (const match of attemptMatches) {
      const key = buildSearchMatchKey(match);
      const existing = matchMap.get(key);
      matchMap.set(
        key,
        existing
          ? mergeSearchMatches(existing, match, { buildComparableResult, rankingOptions })
          : match
      );
    }

    if (shouldStopSearching(matchMap, { rankResults, rankingOptions, searchLimit })) {
      break;
    }
  }

  const selectedAttempt = selectBestSearchAttempt(searchAttempts);
  const query = selectedAttempt?.query || candidateQueries[0];
  const rankedCandidates = rankMatchesForSearch(Array.from(matchMap.values()), rankingOptions, rankResults);
  const dedupedMatches = rankedCandidates.slice(0, Math.max(1, searchLimit));

  const matches = typeof enrichEbayMatches === 'function'
    ? await enrichEbayMatches({
      matches: dedupedMatches,
      token: activeSettings.ebayApplicationToken,
      marketplaceId: activeSettings.ebayMarketplaceId || DEFAULT_SETTINGS.ebayMarketplaceId,
      endUserZip: activeSettings.endUserZip || '',
      topN: ENRICH_TOP_MATCHES,
    })
    : dedupedMatches;

  const rankedMatches = rankMatchesForSearch(matches, rankingOptions, rankResults);

  return {
    ok: true,
    query,
    sourcePlatform: payload.sourcePlatform || 'facebook',
    matches: rankedMatches,
    queryAttempts: searchAttempts,
    requestMeta: {
      ...(selectedAttempt?.requestMeta || {}),
      attemptedQueries: searchAttempts,
      selectedQuery: query,
      dedupedCount: rankedCandidates.length,
      returnedCount: rankedMatches.length,
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

function buildSearchSourceListing(sourceListing = {}, sourceInput = {}) {
  return {
    ...(sourceListing || {}),
    platform: sourceListing?.platform || 'facebook',
    brand: sourceInput.brand || sourceListing?.brand || '',
    title: sourceInput.title || sourceListing?.title || '',
    description: sourceInput.description || sourceListing?.description || '',
  };
}

function attachQueryVariant(match, query) {
  return {
    ...match,
    matchedQueries: query ? [query] : [],
    queryVariantHits: query ? 1 : 0,
  };
}

function buildSearchMatchKey(match = {}) {
  if (match.id) return match.id;
  if (match.url) return match.url;

  const fallbackParts = [
    String(match.title || '').trim().toLowerCase(),
    Number.isFinite(Number(match.listedPrice)) ? Number(match.listedPrice).toFixed(2) : '',
    String(match.sellerName || '').trim().toLowerCase(),
    String(match.locationText || '').trim().toLowerCase(),
  ].filter(Boolean);

  return fallbackParts.join('|') || JSON.stringify({
    title: match.title || '',
    listedPrice: match.listedPrice ?? null,
    sellerName: match.sellerName || '',
    locationText: match.locationText || '',
  });
}

function mergeSearchMatches(existing, incoming, context) {
  const preferred = compareSearchMatchQuality(incoming, existing, context) > 0
    ? mergeResultFields(incoming, existing)
    : mergeResultFields(existing, incoming);
  const matchedQueries = uniqueStrings([...(existing.matchedQueries || []), ...(incoming.matchedQueries || [])]);

  return {
    ...preferred,
    matchedQueries,
    queryVariantHits: matchedQueries.length,
  };
}

function mergeResultFields(primary, secondary) {
  return {
    ...secondary,
    ...primary,
    notes: uniqueStrings([...(secondary.notes || []), ...(primary.notes || [])]),
  };
}

function compareSearchMatchQuality(left, right, { buildComparableResult, rankingOptions }) {
  const leftQuality = readSearchMatchQuality(left, { buildComparableResult, rankingOptions });
  const rightQuality = readSearchMatchQuality(right, { buildComparableResult, rankingOptions });

  if (leftQuality.matchConfidence !== rightQuality.matchConfidence) {
    return leftQuality.matchConfidence - rightQuality.matchConfidence;
  }

  if (leftQuality.queryVariantHits !== rightQuality.queryVariantHits) {
    return leftQuality.queryVariantHits - rightQuality.queryVariantHits;
  }

  if (leftQuality.sellerSignal !== rightQuality.sellerSignal) {
    return leftQuality.sellerSignal - rightQuality.sellerSignal;
  }

  if (leftQuality.shippingKnown !== rightQuality.shippingKnown) {
    return leftQuality.shippingKnown - rightQuality.shippingKnown;
  }

  if (leftQuality.adjustedRankScore !== rightQuality.adjustedRankScore) {
    return rightQuality.adjustedRankScore - leftQuality.adjustedRankScore;
  }

  return 0;
}

function readSearchMatchQuality(match, { buildComparableResult, rankingOptions }) {
  const comparable = typeof buildComparableResult === 'function'
    ? buildComparableResult(match, rankingOptions)
    : match;
  const adjustedRankScore = Number(comparable?.adjustedRankScore);

  return {
    matchConfidence: Number(comparable?.matchConfidence || 0),
    queryVariantHits: Number(match?.queryVariantHits || 0),
    sellerSignal: comparable?.sellerStanding ? 1 : 0,
    shippingKnown: comparable?.shipping != null ? 1 : 0,
    adjustedRankScore: Number.isFinite(adjustedRankScore) ? adjustedRankScore : Number.POSITIVE_INFINITY,
  };
}

function rankMatchesForSearch(matches = [], rankingOptions = {}, rankResults) {
  if (typeof rankResults !== 'function') {
    return [...matches];
  }

  return rankResults(matches, rankingOptions);
}

function summarizeSearchAttempt(matches = []) {
  const topMatches = matches.slice(0, 3);

  return {
    topConfidence: Number(topMatches[0]?.matchConfidence || 0),
    strongMatches: matches.filter(isStrongSearchMatch).length,
    qualityScore: topMatches.reduce((score, match, index) => (
      score
      + Number(match.matchConfidence || 0)
      + (match.sellerStanding ? 8 : 0)
      + (match.shipping != null ? 4 : 0)
      + Math.max(0, 6 - (index * 2))
    ), 0),
  };
}

function shouldStopSearching(matchMap, { rankResults, rankingOptions, searchLimit }) {
  if (matchMap.size < Math.min(searchLimit, EARLY_STOP_MIN_MATCHES)) {
    return false;
  }

  const rankedMatches = rankMatchesForSearch(Array.from(matchMap.values()), rankingOptions, rankResults);
  const topMatches = rankedMatches.slice(0, Math.min(searchLimit, EARLY_STOP_TOP_MATCHES));
  return topMatches.filter(isStrongSearchMatch).length >= Math.min(searchLimit, 3);
}

function isStrongSearchMatch(match = {}) {
  const matchConfidence = Number(match.matchConfidence || 0);
  const queryVariantHits = Number(match.queryVariantHits || 0);
  return matchConfidence >= HIGH_CONFIDENCE_MATCH
    || (queryVariantHits >= 2 && matchConfidence >= MULTI_QUERY_CONFIDENCE_MATCH);
}

function selectBestSearchAttempt(searchAttempts = []) {
  return [...searchAttempts].sort((left, right) => (
    Number(right.qualityScore || 0) - Number(left.qualityScore || 0)
    || Number(right.topConfidence || 0) - Number(left.topConfidence || 0)
    || Number(right.strongMatches || 0) - Number(left.strongMatches || 0)
    || Number(right.returned || 0) - Number(left.returned || 0)
    || Number(right.total || 0) - Number(left.total || 0)
  ))[0] || null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
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
