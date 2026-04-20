(function registerRankingLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.buildComparableResult = function buildComparableResult(result, options = {}) {
    const sourceListing = options.sourceListing || {};
    const effectivePrice = Number(result.descriptionPriceHint || result.listedPrice || 0);
    const sourcePriceContext = readSourcePriceContext(sourceListing, lib);
    const confidence = typeof lib.computeMatchConfidence === 'function'
      ? lib.computeMatchConfidence(sourceListing, result)
      : { score: 0, matchedTokens: [] };
    const taxes = lib.computeTaxEstimate({
      listedTax: result.taxes,
      effectivePrice,
      defaultTaxRate: options.defaultTaxRate,
      stateTaxRate: options.stateTaxRate,
    });
    const totalCost = lib.computeTotalCost({ effectivePrice, shipping: result.shipping, taxes });
    const comparisonSummary = buildComparisonSummary(sourceListing, {
      ...result,
      effectivePrice,
      taxes,
      totalCost,
    }, sourcePriceContext);
    const variantMismatchPenalty = Number(confidence.variantMismatchPenalty || 0);
    const priceBandPenalty = Number(comparisonSummary.priceBandPenalty || 0);
    const listingFormatPenalty = Number(comparisonSummary.listingFormatPenalty || 0);
    const summarizedComparison = appendVariantMismatchSummary(comparisonSummary, confidence.variantMismatches);
    const rankingBoost = lib.computeRankingBoosts(result, {
      ...options,
      comparisonSummary: summarizedComparison,
    });

    return {
      ...result,
      effectivePrice,
      taxes,
      totalCost,
      matchConfidence: confidence.score,
      matchedTokens: confidence.matchedTokens,
      variantMismatchSignals: confidence.variantMismatches || [],
      variantMismatchPenalty,
      priceBandPenalty,
      listingFormatPenalty,
      sourcePriceConfidence: sourcePriceContext.confidence,
      sourcePriceBasis: sourcePriceContext.basis,
      comparisonSummary: summarizedComparison,
      rankingBoost,
      adjustedRankScore: totalCost - rankingBoost - (confidence.score * 0.12) + (variantMismatchPenalty * 0.4) + priceBandPenalty + listingFormatPenalty,
    };
  };

  lib.rankResults = function rankResults(results = [], options = {}) {
    return results
      .map((result) => lib.buildComparableResult(result, options))
      .sort((a, b) => a.adjustedRankScore - b.adjustedRankScore);
  };

  function buildComparisonSummary(source, result, sourcePriceContext = readSourcePriceContext(source, lib)) {
    const sourcePrice = sourcePriceContext.value;
    const totalCost = Number(result.totalCost || 0);
    const priceDelta = sourcePrice == null ? null : roundCurrency(totalCost - sourcePrice);
    const priceBandComparison = comparePriceBand(sourcePriceContext, totalCost, priceDelta);
    const listingFormatComparison = compareListingFormat(result);
    const sourcePriceReference = sourcePriceContext.confidence === 'weak' ? 'source price hint' : 'source';
    const conditionComparison = compareCondition(source?.condition, result?.condition);
    const locationComparison = compareLocation(source?.locationText, result?.locationText);
    const offerComparison = compareOfferSignal(source?.bestOfferDetected, result?.bestOfferDetected);
    const shippingComparison = compareShipping(result?.shipping);
    const reasons = [];
    const mismatches = [];

    if (priceDelta != null) {
      if (priceBandComparison.value === 'far-below' || priceBandComparison.value === 'far-above') {
        // Let the explicit price-band watchout carry the message instead.
      } else if (priceDelta <= -25) reasons.push(`About $${Math.abs(priceDelta).toFixed(2)} cheaper than ${sourcePriceReference}`);
      else if (priceDelta < 0) reasons.push(`Slightly cheaper than ${sourcePriceReference}`);
      else if (priceDelta >= 100) mismatches.push(`About $${priceDelta.toFixed(2)} above ${sourcePriceReference}`);
      else if (priceDelta > 0) mismatches.push(`Priced above ${sourcePriceReference}`);
      else reasons.push('Price roughly matches source');
    }

    if (priceBandComparison.label) {
      (priceBandComparison.isMismatch ? mismatches : reasons).push(priceBandComparison.label);
    }

    if (listingFormatComparison.label) {
      (listingFormatComparison.isMismatch ? mismatches : reasons).push(listingFormatComparison.label);
    }

    if (conditionComparison.label) {
      (conditionComparison.isMismatch ? mismatches : reasons).push(conditionComparison.label);
    }

    if (locationComparison.label) {
      (locationComparison.isMismatch ? mismatches : reasons).push(locationComparison.label);
    }

    if (shippingComparison.label) {
      (shippingComparison.isMismatch ? mismatches : reasons).push(shippingComparison.label);
    }

    if (offerComparison.label) {
      (offerComparison.isMismatch ? mismatches : reasons).push(offerComparison.label);
    }

    return {
      sourcePrice,
      sourcePriceConfidence: sourcePriceContext.confidence,
      sourcePriceBasis: sourcePriceContext.basis,
      priceDelta,
      priceBandComparison: priceBandComparison.value,
      priceBandPenalty: priceBandComparison.penalty,
      listingFormatComparison: listingFormatComparison.value,
      listingFormatPenalty: listingFormatComparison.penalty,
      conditionComparison: conditionComparison.value,
      locationComparison: locationComparison.value,
      offerComparison: offerComparison.value,
      shippingComparison: shippingComparison.value,
      highlights: reasons.slice(0, 4),
      mismatches: mismatches.slice(0, 3),
    };
  }

  function appendVariantMismatchSummary(summary, variantMismatches = []) {
    const variantLabels = (variantMismatches || []).map((item) => item?.label).filter(Boolean);
    if (!variantLabels.length) {
      return {
        ...summary,
        variantMismatches: [],
      };
    }

    return {
      ...summary,
      variantMismatches: variantLabels,
      mismatches: [...variantLabels, ...(summary.mismatches || [])].slice(0, 3),
    };
  }

  function readSourcePriceContext(source, sharedLib) {
    const listed = readFinitePositive(source?.listedPrice);
    const hinted = Number(source?.descriptionPriceHint);
    const hint = Number.isFinite(hinted) && hinted > 0 ? hinted : null;
    const placeholderPrice = Boolean(source?.placeholderPriceFlag)
      || (typeof sharedLib?.isFacebookPlaceholderPrice === 'function' && sharedLib.isFacebookPlaceholderPrice(source || {}));

    if (placeholderPrice) {
      if (hint != null && hint >= 10) {
        return { value: hint, confidence: 'weak', basis: 'description-hint-placeholder' };
      }

      return { value: null, confidence: 'placeholder', basis: 'placeholder' };
    }

    if (listed != null) {
      return {
        value: listed,
        confidence: 'strong',
        basis: isCompatiblePriceHint(listed, hint) ? 'listed-price' : 'listed-price-only',
      };
    }

    if (hint != null && hint >= 10) {
      return {
        value: hint,
        confidence: 'weak',
        basis: 'description-hint',
      };
    }

    return { value: null, confidence: 'none', basis: 'missing' };
  }

  function comparePriceBand(sourcePriceContext, totalCost, priceDelta) {
    const sourcePrice = Number(sourcePriceContext?.value || 0);
    const cost = Number(totalCost || 0);
    if (!sourcePrice || !cost || priceDelta == null) {
      return { value: 'unknown', label: '', isMismatch: false, penalty: 0 };
    }

    const ratio = cost / sourcePrice;
    const absoluteGap = Math.abs(Number(priceDelta || 0));
    const isWeakSourcePrice = sourcePriceContext?.confidence === 'weak';

    if (!isWeakSourcePrice && priceDelta <= -250 && ratio <= 0.45) {
      return {
        value: 'far-below',
        label: 'Much lower than source price; check for accessory or bundle differences',
        isMismatch: true,
        penalty: roundCurrency(Math.min(180, absoluteGap * 0.3)),
      };
    }

    if (isWeakSourcePrice && priceDelta <= -400 && ratio <= 0.3) {
      return {
        value: 'far-below',
        label: 'Much lower than the source price hint; double-check the match',
        isMismatch: true,
        penalty: roundCurrency(Math.min(90, absoluteGap * 0.18)),
      };
    }

    if (!isWeakSourcePrice && priceDelta >= 250 && ratio >= 1.9) {
      return {
        value: 'far-above',
        label: 'Much higher than source price',
        isMismatch: true,
        penalty: roundCurrency(Math.min(140, absoluteGap * 0.15)),
      };
    }

    if (isWeakSourcePrice && priceDelta >= 400 && ratio >= 2.5) {
      return {
        value: 'far-above',
        label: 'Much higher than the source price hint',
        isMismatch: true,
        penalty: roundCurrency(Math.min(100, absoluteGap * 0.12)),
      };
    }

    return { value: 'within-band', label: '', isMismatch: false, penalty: 0 };
  }

  function compareListingFormat(result) {
    if (result?.isAuctionOnly) {
      return {
        value: 'auction-only',
        label: 'Auction-only listing; current bid may not reflect the final sale price',
        isMismatch: true,
        penalty: 180,
      };
    }

    return { value: 'standard', label: '', isMismatch: false, penalty: 0 };
  }

  function isCompatiblePriceHint(listedPrice, hintedPrice) {
    if (listedPrice == null || hintedPrice == null) return false;
    const delta = Math.abs(Number(listedPrice) - Number(hintedPrice));
    return delta <= Math.max(40, Number(listedPrice) * 0.35);
  }

  function readFinitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function compareCondition(sourceCondition, resultCondition) {
    const sourceBucket = getConditionBucket(sourceCondition);
    const resultBucket = getConditionBucket(resultCondition);
    if (!sourceBucket.rank || !resultBucket.rank) {
      return { value: 'unknown', label: '', isMismatch: false };
    }
    if (sourceBucket.rank === resultBucket.rank) {
      return { value: 'same', label: 'Condition aligns with source', isMismatch: false };
    }
    if (resultBucket.rank > sourceBucket.rank) {
      return { value: 'better', label: 'Condition looks stronger than source', isMismatch: false };
    }

    if ((sourceBucket.rank - resultBucket.rank) >= 2) {
      return { value: 'clearly-worse', label: 'Condition is clearly worse than source', isMismatch: true };
    }

    return { value: 'worse', label: 'Condition looks worse than source', isMismatch: true };
  }

  function compareLocation(sourceLocation, resultLocation) {
    const normalizeLocationText = lib.normalizeLocationText;
    if (typeof normalizeLocationText !== 'function') {
      return { value: 'unknown', label: '', isMismatch: false };
    }

    const source = normalizeLocationText(sourceLocation);
    const result = normalizeLocationText(resultLocation);
    if (!source.hasSignal || !result.hasSignal) {
      return { value: 'unknown', label: '', isMismatch: false };
    }

    if (source.city && result.city && source.city === result.city && (!source.state || !result.state || source.state === result.state)) {
      return { value: 'same-city', label: 'Location is close to source', isMismatch: false };
    }
    if (source.state && result.state && source.state === result.state) {
      return { value: 'same-state', label: 'Same state as source', isMismatch: false };
    }
    if (source.country && result.country && source.country === result.country) {
      return { value: 'same-country', label: 'Same country as source', isMismatch: false };
    }
    return { value: 'different', label: 'Location differs from source', isMismatch: true };
  }

  function compareOfferSignal(sourceOffer, resultOffer) {
    if (sourceOffer && resultOffer) {
      return { value: 'both', label: 'Offer language matches source', isMismatch: false };
    }
    if (!sourceOffer && resultOffer) {
      return { value: 'result-only', label: 'eBay listing includes Best Offer', isMismatch: false };
    }
    if (sourceOffer && !resultOffer) {
      return { value: 'source-only', label: 'Source mentions offers but eBay match does not', isMismatch: true };
    }
    return { value: 'none', label: '', isMismatch: false };
  }

  function compareShipping(shipping) {
    if (shipping == null) {
      return { value: 'unknown', label: 'Shipping cost is unknown', isMismatch: true };
    }
    if (Number(shipping) === 0) {
      return { value: 'free', label: 'Free shipping', isMismatch: false };
    }
    if (Number(shipping) >= 25) {
      return { value: 'high', label: 'Shipping cost is high', isMismatch: true };
    }
    return { value: 'paid', label: 'Paid shipping', isMismatch: false };
  }

  function getConditionBucket(value) {
    const text = String(value || '').toLowerCase();
    if (!text) return { rank: 0, bucket: 'unknown' };
    if (/for parts|parts only|broken|poor|not working|as is/.test(text)) return { rank: 1, bucket: 'parts' };
    if (/fair|acceptable/.test(text)) return { rank: 2, bucket: 'fair' };
    if (/used - good|very good|good/.test(text)) return { rank: 3, bucket: 'good' };
    if (/used - like new|like new|open box|open-box|excellent/.test(text)) return { rank: 4, bucket: 'like-new' };
    if (/brand new|new in box|new/.test(text)) return { rank: 5, bucket: 'new' };
    if (/refurbished|renewed/.test(text)) return { rank: 3, bucket: 'refurbished' };
    if (/used/.test(text)) return { rank: 3, bucket: 'used' };
    return { rank: 0, bucket: 'unknown' };
  }

  function roundCurrency(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }
})(globalThis);
