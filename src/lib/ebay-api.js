(function registerEbayApiLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.searchEbayBrowse = async function searchEbayBrowse({
    query,
    token,
    marketplaceId = 'EBAY_US',
    limit = 10,
    endUserZip = '',
    freeShippingOnly = false,
  }) {
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(Math.max(Number(limit) || 10, 1), 20)),
      fieldgroups: 'EXTENDED',
    });

    if (freeShippingOnly) {
      params.set('filter', 'deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP|SHIP_TO_HOME}');
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    };

    if (endUserZip) {
      headers['X-EBAY-C-ENDUSERCTX'] = `contextualLocation=country=US,zip=${encodeURIComponent(endUserZip)}`;
    }

    const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`eBay API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return {
      matches: (data.itemSummaries || []).map(mapItemSummary),
      requestMeta: {
        href: data.href || '',
        total: data.total || 0,
        limit: data.limit || 0,
      },
    };
  };

  function mapItemSummary(item) {
    const shippingOption = Array.isArray(item.shippingOptions) ? item.shippingOptions[0] : null;
    const shipping = shippingOption?.shippingCost?.value ? Number(shippingOption.shippingCost.value) : 0;
    const price = item.price?.value ? Number(item.price.value) : 0;

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
      locationText: [item.itemLocation?.city, item.itemLocation?.stateOrProvince, item.itemLocation?.country]
        .filter(Boolean)
        .join(', '),
      buyingOptions: item.buyingOptions || [],
      bestOfferDetected: Array.isArray(item.buyingOptions) && item.buyingOptions.includes('BEST_OFFER'),
      placeholderPriceFlag: false,
      matchReason: buildMatchReason(item),
      notes: ['Mapped from eBay Browse API item_summary/search response.'],
    };
  }

  function buildMatchReason(item) {
    const reasons = [];
    if (item.condition) reasons.push(item.condition);
    if (item.seller?.feedbackPercentage) reasons.push(`${item.seller.feedbackPercentage}% seller feedback`);
    if (item.shippingOptions?.some((option) => option.shippingCost?.value === '0.0')) reasons.push('free shipping');
    return reasons.join(' · ');
  }
})(globalThis);
