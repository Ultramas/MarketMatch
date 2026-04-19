(function registerStateLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.DEFAULT_DRAFT = {
    brand: '',
    title: '',
    description: '',
  };

  lib.DEFAULT_FILTERS = {
    distanceScope: 'any',
    brandRequired: false,
    brand: '',
    freeShippingOnly: false,
    sellerStandingBoost: true,
    userState: '',
    defaultTaxRate: 0,
    couponOptIn: false,
  };

  lib.DEFAULT_CONSENT = {
    cookiesPrompted: false,
    cookiesAllowed: false,
    historyAllowed: false,
    couponLookupAllowed: false,
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
