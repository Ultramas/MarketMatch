(function bootstrap() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CAPTURE_LISTING') {
      sendResponse(captureCurrentListing());
      return;
    }

    if (message?.type === 'COLLECT_RESULTS') {
      sendResponse(collectCurrentResults());
      return;
    }
  });
})();

function captureCurrentListing() {
  const platform = detectPlatform(window.location.hostname);
  const adapter = globalThis.MarketMatchAdapters?.getAdapter(platform);

  if (!adapter) {
    return createUnsupportedResponse(platform, [`No adapter registered for ${platform}.`]);
  }

  return adapter.captureListing({
    url: window.location.href,
    document,
    location: window.location,
  });
}

function collectCurrentResults() {
  const platform = detectPlatform(window.location.hostname);
  const adapter = globalThis.MarketMatchAdapters?.getAdapter(platform);

  if (!adapter) {
    return {
      platform,
      supported: false,
      results: [],
      notes: [`No adapter registered for ${platform}.`],
    };
  }

  return adapter.collectResults({
    url: window.location.href,
    document,
    location: window.location,
  });
}

function detectPlatform(hostname) {
  if (hostname.includes('ebay.com')) return 'ebay';
  if (hostname.includes('facebook.com')) return 'facebook';
  if (hostname.includes('craigslist.org')) return 'craigslist';
  return 'unknown';
}

function createUnsupportedResponse(platform, notes = []) {
  return {
    platform,
    supported: false,
    url: window.location.href,
    title: '',
    description: '',
    listedPrice: null,
    shipping: null,
    taxes: null,
    condition: '',
    sellerName: '',
    sellerStanding: '',
    positiveRatings: null,
    negativeRatings: null,
    locationText: '',
    bestOfferDetected: false,
    placeholderPriceFlag: false,
    notes,
  };
}
