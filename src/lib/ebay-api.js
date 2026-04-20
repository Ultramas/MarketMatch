(function registerEbayApiLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.searchEbayBrowse = async function searchEbayBrowse({
    query,
    backendBaseUrl,
    proxyAccessKey = '',
    marketplaceId = 'EBAY_US',
    limit = 10,
    endUserZip = '',
    buyingOptionFilter = '',
  }) {
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(Math.max(Number(limit) || 10, 1), 20)),
      fieldgroups: 'EXTENDED',
    });

    if (buyingOptionFilter) {
      params.set('filter', `buyingOptions:{${buyingOptionFilter}}`);
    }

    params.set('marketplaceId', marketplaceId);
    if (endUserZip) {
      params.set('endUserZip', endUserZip);
    }

    const response = await fetch(buildProxyEndpoint(backendBaseUrl, '/api/ebay/search', params), {
      method: 'GET',
      headers: buildProxyRequestHeaders({ proxyAccessKey }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay proxy error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return {
      matches: (data.itemSummaries || []).map(mapItemSummary),
      requestMeta: {
        href: data.href || '',
        total: data.total || 0,
        limit: data.limit || 0,
        buyingOptionFilter,
      },
    };
  };

  lib.getEbayBrowseItem = async function getEbayBrowseItem({ itemId, backendBaseUrl, proxyAccessKey = '', marketplaceId = 'EBAY_US', endUserZip = '' }) {
    const params = new URLSearchParams({ marketplaceId });
    if (endUserZip) {
      params.set('endUserZip', endUserZip);
    }

    const response = await fetch(buildProxyEndpoint(backendBaseUrl, `/api/ebay/item/${encodeURIComponent(itemId)}`, params), {
      method: 'GET',
      headers: buildProxyRequestHeaders({ proxyAccessKey }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay proxy item error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return mapItemDetails(data);
  };

  lib.enrichEbayMatches = async function enrichEbayMatches({ matches = [], backendBaseUrl, proxyAccessKey = '', marketplaceId = 'EBAY_US', endUserZip = '', topN = 3 }) {
    const limit = Math.max(0, Math.min(Number(topN) || 0, matches.length));
    const enriched = await Promise.all(matches.map(async (match, index) => {
      if (index >= limit || !match.id) {
        return match;
      }

      try {
        const detail = await lib.getEbayBrowseItem({
          itemId: match.id,
          backendBaseUrl,
          proxyAccessKey,
          marketplaceId,
          endUserZip,
        });
        return mergeMatchWithDetail(match, detail);
      } catch {
        return match;
      }
    }));

    return enriched;
  };

  function mapItemSummary(item) {
    const shippingOption = pickPreferredShippingOption(item.shippingOptions || []);
    const shipping = shippingOption?.shippingCost?.value != null
      ? Number(shippingOption.shippingCost.value)
      : null;
    const price = item.price?.value ? Number(item.price.value) : 0;
    const listingSignals = deriveListingSignals(item.buyingOptions || []);

    return {
      platform: 'ebay',
      id: item.itemId || '',
      url: item.itemWebUrl || '',
      title: item.title || '',
      listedPrice: price,
      descriptionPriceHint: null,
      shipping,
      taxes: null,
      condition: item.condition || '',
      sellerName: item.seller?.username || '',
      sellerStanding: item.seller?.feedbackPercentage ? `Feedback ${item.seller.feedbackPercentage}%` : '',
      positiveRatings: item.seller?.feedbackScore || 0,
      negativeRatings: 0,
      deliveryType: shippingOption?.shippingServiceCode || shippingOption?.type || '',
      locationText: [item.itemLocation?.city, item.itemLocation?.stateOrProvince, item.itemLocation?.country]
        .filter(Boolean)
        .join(', '),
      buyingOptions: item.buyingOptions || [],
      bestOfferDetected: Array.isArray(item.buyingOptions) && item.buyingOptions.includes('BEST_OFFER'),
      listingFormat: listingSignals.listingFormat,
      isAuctionOnly: listingSignals.isAuctionOnly,
      placeholderPriceFlag: false,
      matchReason: buildMatchReason(item),
      notes: ['Mapped from eBay Browse API item_summary/search response.'],
    };
  }

  function mapItemDetails(item) {
    const shippingOption = pickPreferredShippingOption(item.shippingOptions || []);
    const listingSignals = deriveListingSignals(item.buyingOptions || []);
    return {
      id: item.itemId || '',
      shipping: shippingOption?.shippingCost?.value != null ? Number(shippingOption.shippingCost.value) : null,
      taxes: null,
      condition: item.condition || item.conditionDescription || '',
      sellerName: item.seller?.username || '',
      sellerStanding: item.seller?.feedbackPercentage ? `Feedback ${item.seller.feedbackPercentage}%` : '',
      positiveRatings: item.seller?.feedbackScore || 0,
      locationText: [item.itemLocation?.city, item.itemLocation?.stateOrProvince, item.itemLocation?.country]
        .filter(Boolean)
        .join(', '),
      buyingOptions: item.buyingOptions || [],
      bestOfferDetected: Array.isArray(item.buyingOptions) && item.buyingOptions.includes('BEST_OFFER'),
      listingFormat: listingSignals.listingFormat,
      isAuctionOnly: listingSignals.isAuctionOnly,
      notes: ['Enriched from eBay Browse API getItem response.'],
    };
  }

  function buildMatchReason(item) {
    const reasons = [];
    const listingSignals = deriveListingSignals(item.buyingOptions || []);
    if (item.condition) reasons.push(item.condition);
    if (item.seller?.feedbackPercentage) reasons.push(`${item.seller.feedbackPercentage}% seller feedback`);
    if (item.shippingOptions?.some((option) => Number(option.shippingCost?.value) === 0)) reasons.push('free shipping');
    if (listingSignals.isAuctionOnly) reasons.push('auction-only');
    return reasons.join(' · ');
  }

  function deriveListingSignals(buyingOptions) {
    const normalized = Array.isArray(buyingOptions)
      ? [...new Set(buyingOptions.map((option) => String(option || '').toUpperCase()).filter(Boolean))]
      : [];
    const hasAuction = normalized.includes('AUCTION');
    const hasFixedPrice = normalized.includes('FIXED_PRICE');
    const hasBestOffer = normalized.includes('BEST_OFFER');
    const isAuctionOnly = hasAuction && !hasFixedPrice && !hasBestOffer;

    let listingFormat = 'unspecified';
    if (isAuctionOnly) listingFormat = 'auction-only';
    else if (hasAuction && (hasFixedPrice || hasBestOffer)) listingFormat = 'auction-or-fixed';
    else if (hasFixedPrice || hasBestOffer) listingFormat = 'fixed-price';

    return {
      listingFormat,
      isAuctionOnly,
    };
  }

  function pickPreferredShippingOption(shippingOptions) {
    if (!Array.isArray(shippingOptions) || !shippingOptions.length) return null;

    const shipToHome = shippingOptions.find((option) => {
      const summary = `${option.shippingServiceCode || ''} ${option.type || ''} ${option.optionType || ''}`;
      return /ship|delivery/i.test(summary) && !/pickup/i.test(summary);
    });

    return shipToHome || shippingOptions[0] || null;
  }

  function buildProxyEndpoint(baseUrl, pathname, params = null) {
    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!normalizedBaseUrl) {
      throw new Error('Missing eBay proxy URL.');
    }

    const url = new URL(normalizedBaseUrl);
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${basePath}${pathname}`.replace(/\/+/g, '/');
    url.search = params instanceof URLSearchParams ? params.toString() : '';
    return url.toString();
  }

  function buildProxyRequestHeaders(settings = {}) {
    const builder = lib.buildProxyRequestHeaders;
    if (typeof builder === 'function') {
      return builder(settings);
    }

    const proxyAccessKey = String(settings?.proxyAccessKey || '').trim();
    return {
      'X-MarketMatch-Client': 'extension',
      ...(proxyAccessKey ? { 'X-MarketMatch-Proxy-Key': proxyAccessKey } : {}),
    };
  }

  function mergeMatchWithDetail(match, detail) {
    return {
      ...match,
      ...detail,
      shipping: detail.shipping != null ? detail.shipping : match.shipping,
      taxes: detail.taxes != null ? detail.taxes : match.taxes,
      condition: detail.condition || match.condition,
      sellerName: detail.sellerName || match.sellerName,
      sellerStanding: detail.sellerStanding || match.sellerStanding,
      positiveRatings: detail.positiveRatings || match.positiveRatings,
      locationText: detail.locationText || match.locationText,
      buyingOptions: detail.buyingOptions?.length ? detail.buyingOptions : match.buyingOptions,
      bestOfferDetected: Boolean(detail.bestOfferDetected || match.bestOfferDetected),
      listingFormat: detail.listingFormat || match.listingFormat || 'unspecified',
      isAuctionOnly: Boolean(detail.isAuctionOnly || match.isAuctionOnly),
      notes: [...(match.notes || []), ...(detail.notes || [])],
    };
  }
})(globalThis);
