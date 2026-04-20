(function registerStateLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.DEFAULT_DRAFT = {
    brand: '',
    title: '',
    description: '',
  };

  lib.DEFAULT_SETTINGS = {
    ebayProxyBaseUrl: '',
    proxyAccessKey: '',
    ebayMarketplaceId: 'EBAY_US',
    endUserZip: '',
    ebayLimit: 10,
    minPositiveRatings: 5,
    maxNegativeRatioDivisor: 5,
    defaultTaxRate: 0,
    defaultState: '',
  };

  lib.normalizeProxyBaseUrl = function normalizeProxyBaseUrl(value = '') {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return '';
      }

      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  };

  lib.normalizeProxyAccessKey = function normalizeProxyAccessKey(value = '') {
    return String(value || '').trim();
  };

  lib.isLoopbackProxyBaseUrl = function isLoopbackProxyBaseUrl(value = '') {
    const normalizedBaseUrl = lib.normalizeProxyBaseUrl(value);
    if (!normalizedBaseUrl) return false;

    try {
      const parsed = new URL(normalizedBaseUrl);
      const hostname = String(parsed.hostname || '').trim().toLowerCase();
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
    } catch {
      return false;
    }
  };

  lib.hasEbayProxy = function hasEbayProxy(settings = {}) {
    return Boolean(lib.normalizeProxyBaseUrl(settings?.ebayProxyBaseUrl));
  };

  lib.buildProxyRequestHeaders = function buildProxyRequestHeaders(settings = {}) {
    const proxyAccessKey = lib.normalizeProxyAccessKey(settings?.proxyAccessKey);
    return {
      'X-MarketMatch-Client': 'extension',
      ...(proxyAccessKey ? { 'X-MarketMatch-Proxy-Key': proxyAccessKey } : {}),
    };
  };

  lib.maskProxyAccessKey = function maskProxyAccessKey(value = '') {
    return lib.normalizeProxyAccessKey(value) ? '[stored]' : '[empty]';
  };

  lib.sanitizeSettings = function sanitizeSettings(settings = {}) {
    const rawTaxRate = Number(settings?.defaultTaxRate ?? lib.DEFAULT_SETTINGS.defaultTaxRate);
    const normalizedTaxRate = rawTaxRate > 1 ? rawTaxRate / 100 : rawTaxRate;

    return {
      ebayProxyBaseUrl: lib.normalizeProxyBaseUrl(settings?.ebayProxyBaseUrl),
      proxyAccessKey: lib.normalizeProxyAccessKey(settings?.proxyAccessKey),
      ebayMarketplaceId: String(settings?.ebayMarketplaceId || lib.DEFAULT_SETTINGS.ebayMarketplaceId).trim() || lib.DEFAULT_SETTINGS.ebayMarketplaceId,
      endUserZip: String(settings?.endUserZip || '').trim(),
      ebayLimit: Math.min(20, Math.max(1, Number(settings?.ebayLimit || lib.DEFAULT_SETTINGS.ebayLimit))),
      minPositiveRatings: Math.max(0, Number(settings?.minPositiveRatings || lib.DEFAULT_SETTINGS.minPositiveRatings)),
      maxNegativeRatioDivisor: Math.max(1, Number(settings?.maxNegativeRatioDivisor || lib.DEFAULT_SETTINGS.maxNegativeRatioDivisor)),
      defaultTaxRate: Math.max(0, Math.min(Number.isFinite(normalizedTaxRate) ? normalizedTaxRate : lib.DEFAULT_SETTINGS.defaultTaxRate, 1)),
      defaultState: String(settings?.defaultState || '').trim(),
    };
  };

  lib.fetchProxyHealth = async function fetchProxyHealth(settings = {}) {
    const ebayProxyBaseUrl = lib.normalizeProxyBaseUrl(settings?.ebayProxyBaseUrl);
    if (!ebayProxyBaseUrl) {
      return { state: 'missing' };
    }

    try {
      const response = await fetch(`${ebayProxyBaseUrl}/api/health`, {
        method: 'GET',
        headers: lib.buildProxyRequestHeaders(settings),
      });
      let data = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        return {
          state: 'error',
          status: response.status,
          error: data?.error || 'Health check failed.',
        };
      }

      return {
        state: 'ok',
        status: response.status,
        ready: Boolean(data?.ready),
        environment: data?.environment || 'production',
      };
    } catch (error) {
      return {
        state: 'error',
        error: error?.message || 'Could not reach the backend proxy.',
      };
    }
  };

  lib.DEFAULT_FILTERS = {
    distanceScope: 'any',
    sameLocationValue: '',
    brandRequired: false,
    brand: '',
    freeShippingOnly: false,
    includeAuctionOnly: false,
    hideWorseCondition: false,
    hideLikelyMismatch: false,
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
