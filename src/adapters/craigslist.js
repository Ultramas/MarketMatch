(function registerCraigslistAdapter(globalScope) {
  // Inactive scaffold only: this adapter is not loaded by manifest.json and is
  // not part of the current Facebook source -> eBay Browse API comparison flow.
  globalScope.MarketMatchAdapters?.registerAdapter('craigslist', function getCraigslistAdapter() {
    return {
      platform: 'craigslist',
      buildSearchUrl(query) {
        return `https://www.craigslist.org/search/sss?query=${encodeURIComponent(query)}`;
      },
      captureListing(context = {}) {
        return {
          platform: 'craigslist',
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
          notes: ['Implement Craigslist listing selectors in src/adapters/craigslist.js.'],
        };
      },
      collectResults() {
        return {
          platform: 'craigslist',
          supported: false,
          results: [],
          notes: ['Implement Craigslist result selectors in src/adapters/craigslist.js.'],
        };
      },
    };
  });
})(globalThis);
