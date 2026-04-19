(function registerFacebookAdapter(globalScope) {
  globalScope.MarketMatchAdapters?.registerAdapter('facebook', function getFacebookAdapter() {
    return {
      platform: 'facebook',
      buildSearchUrl(query) {
        return `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}`;
      },
      captureListing(context = {}) {
        return {
          platform: 'facebook',
          supported: false,
          url: context.url || '',
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
          notes: ['Implement Facebook Marketplace listing selectors in src/adapters/facebook.js.'],
        };
      },
      collectResults() {
        return {
          platform: 'facebook',
          supported: false,
          results: [],
          notes: ['Implement Facebook Marketplace result selectors in src/adapters/facebook.js.'],
        };
      },
    };
  });
})(globalThis);
