(function bootstrap() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CAPTURE_LISTING') {
      sendResponse(captureCurrentListing());
      return;
    }
  });
})();

function captureCurrentListing() {
  const platform = 'facebook';
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
