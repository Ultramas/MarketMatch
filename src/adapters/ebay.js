(function registerEbayAdapter(globalScope) {
  // Inactive scaffold only: this adapter is not loaded by manifest.json and is
  // not part of the current Facebook source -> eBay Browse API comparison flow.
  globalScope.MarketMatchAdapters?.registerAdapter('ebay', function getEbayAdapter() {
    return {
      platform: 'ebay',
      buildSearchUrl(query) {
        return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
      },
      captureListing(context = {}) {
        return {
          platform: 'ebay',
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
          notes: ['Implement eBay listing selectors in src/adapters/ebay.js.'],
        };
      },
      collectResults() {
        return {
          platform: 'ebay',
          supported: false,
          results: [],
          notes: ['Implement eBay search result selectors in src/adapters/ebay.js.'],
        };
      },
    };
  });
})(globalThis);
