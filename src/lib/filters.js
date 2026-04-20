(function registerFiltersLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.isFacebookPlaceholderPrice = function isFacebookPlaceholderPrice({ platform, listedPrice, title, description }) {
    if (platform !== 'facebook') return false;

    const text = `${title || ''} ${description || ''}`.toLowerCase();
    if (text.includes('free')) return true;
    return listedPrice === 1;
  };

  lib.computeNegativeLimit = function computeNegativeLimit(positiveRatings, divisor = 5) {
    return Math.max(1, Math.floor((Number(positiveRatings) || 0) / divisor));
  };

  lib.passesSellerRating = function passesSellerRating(result, { minPositiveRatings = 5, maxNegativeRatioDivisor = 5 } = {}) {
    const positive = Number(result.positiveRatings || 0);
    const negative = Number(result.negativeRatings || 0);
    return positive >= minPositiveRatings && negative <= lib.computeNegativeLimit(positive, maxNegativeRatioDivisor);
  };

  lib.computeTotalCost = function computeTotalCost({ effectivePrice = 0, shipping = 0, taxes = 0 }) {
    return Number(effectivePrice || 0) + Number(shipping || 0) + Number(taxes || 0);
  };

  lib.computeTaxEstimate = function computeTaxEstimate({ listedTax, effectivePrice = 0, defaultTaxRate = 0, stateTaxRate = null }) {
    if (Number.isFinite(Number(listedTax)) && Number(listedTax) > 0) {
      return Number(listedTax);
    }

    const rate = Number.isFinite(Number(stateTaxRate)) ? Number(stateTaxRate) : Number(defaultTaxRate || 0);
    return Number(effectivePrice || 0) * rate;
  };

  lib.computeRankingBoosts = function computeRankingBoosts(result, { sellerStandingBoost = true, couponSavings = 0, comparisonSummary = null } = {}) {
    let boost = 0;
    const queryVariantHits = Number(result?.queryVariantHits || 0);

    if (sellerStandingBoost && result?.sellerStanding) {
      boost += 10;
    }

    if (queryVariantHits > 1) {
      boost += Math.min(10, (queryVariantHits - 1) * 4);
    }

    if (comparisonSummary) {
      if (comparisonSummary.priceDelta != null) {
        if (comparisonSummary.priceDelta < 0) boost += Math.min(18, Math.abs(comparisonSummary.priceDelta) * 0.08);
        if (comparisonSummary.priceDelta > 75) boost -= Math.min(20, comparisonSummary.priceDelta * 0.05);
      }

      if (comparisonSummary.conditionComparison === 'same') boost += 8;
      if (comparisonSummary.conditionComparison === 'better') boost += 10;
      if (comparisonSummary.conditionComparison === 'worse') boost -= 12;

      if (comparisonSummary.locationComparison === 'same-city') boost += 8;
      else if (comparisonSummary.locationComparison === 'same-state') boost += 5;
      else if (comparisonSummary.locationComparison === 'same-country') boost += 2;
      else if (comparisonSummary.locationComparison === 'different') boost -= 6;

      if (comparisonSummary.shippingComparison === 'free') boost += 8;
      if (comparisonSummary.shippingComparison === 'unknown') boost -= 6;
      if (comparisonSummary.shippingComparison === 'high') boost -= 8;

      if (comparisonSummary.offerComparison === 'both') boost += 3;
      if (comparisonSummary.offerComparison === 'source-only') boost -= 3;
    }

    if (couponSavings > 0) {
      boost += Math.min(15, couponSavings);
    }

    return boost;
  };
})(globalThis);
