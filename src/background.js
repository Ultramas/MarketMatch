if (typeof importScripts === 'function') {
  importScripts(
    'lib/state.js',
    'adapters/registry.js',
    'adapters/ebay.js',
    'adapters/facebook.js',
    'adapters/craigslist.js'
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
  ]);
  const next = {
    filters: { ...DEFAULT_FILTERS, ...(current.filters || {}) },
    sourceListing: current.sourceListing || null,
    results: current.results || [],
    draft: current.draft || null,
    history: current.history || [],
    consent: { ...DEFAULT_CONSENT, ...(current.consent || {}) },
  };
  await chrome.storage.local.set(next);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'BUILD_SEARCH_TARGETS') {
    const query = String(message.query || '').trim();
    sendResponse(buildSearchTargets(query));
    return;
  }

  if (message?.type === 'GET_PLATFORM') {
    const url = sender.tab?.url || '';
    sendResponse({ platform: detectPlatform(url) });
    return;
  }

  if (message?.type === 'SAVE_HISTORY') {
    saveHistoryEntry(message.entry).then((history) => sendResponse({ history }));
    return true;
  }
});

function detectPlatform(url) {
  if (url.includes('ebay.com')) return 'ebay';
  if (url.includes('facebook.com')) return 'facebook';
  if (url.includes('craigslist.org')) return 'craigslist';
  return 'unknown';
}

function buildSearchTargets(query) {
  const adapters = globalThis.MarketMatchAdapters;
  if (adapters?.listPlatforms) {
    return adapters.listPlatforms().reduce((targets, platform) => {
      const adapter = adapters.getAdapter(platform);
      if (adapter?.buildSearchUrl) {
        targets[platform] = adapter.buildSearchUrl(query);
      }
      return targets;
    }, {});
  }

  const encoded = encodeURIComponent(query);
  return {
    ebay: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
    facebook: `https://www.facebook.com/marketplace/search/?query=${encoded}`,
    craigslist: `https://www.craigslist.org/search/sss?query=${encoded}`,
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
