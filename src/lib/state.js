(function registerStateLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.DEFAULT_DRAFT = {
    brand: '',
    title: '',
    description: '',
  };

  lib.DEFAULT_SETTINGS = {
    ebayApplicationToken: '',
    ebayMarketplaceId: 'EBAY_US',
    endUserZip: '',
    ebayLimit: 10,
    minPositiveRatings: 5,
    maxNegativeRatioDivisor: 5,
    defaultTaxRate: 0,
    defaultState: '',
  };

  lib.DEFAULT_FILTERS = {
    distanceScope: 'any',
    sameLocationValue: '',
    brandRequired: false,
    brand: '',
    freeShippingOnly: false,
    includeAuctionOnly: false,
    minPositiveRatings: lib.DEFAULT_SETTINGS.minPositiveRatings,
    maxNegativeRatioDivisor: lib.DEFAULT_SETTINGS.maxNegativeRatioDivisor,
    sellerStandingBoost: true,
    userState: lib.DEFAULT_SETTINGS.defaultState,
    defaultTaxRate: lib.DEFAULT_SETTINGS.defaultTaxRate,
  };

  lib.DEFAULT_CONSENT = {
    cookiesPrompted: false,
    cookiesAllowed: false,
    historyAllowed: false,
  };

  lib.createEmptySessionState = function createEmptySessionState() {
    return {
      draft: { ...lib.DEFAULT_DRAFT },
      filters: { ...lib.DEFAULT_FILTERS },
      consent: { ...lib.DEFAULT_CONSENT },
      sourceListing: null,
      lastSearchSourceSignature: '',
      results: [],
      history: [],
    };
  };
})(globalThis);
