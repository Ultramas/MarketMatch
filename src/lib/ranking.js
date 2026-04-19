(function registerRankingLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.buildComparableResult = function buildComparableResult(result, options = {}) {
    const sourceListing = options.sourceListing || {};
    const effectivePrice = Number(result.descriptionPriceHint || result.listedPrice || 0);
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
    });
    const variantMismatchPenalty = Number(confidence.variantMismatchPenalty || 0);
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
      comparisonSummary: summarizedComparison,
      rankingBoost,
      adjustedRankScore: totalCost - rankingBoost - (confidence.score * 0.12) + (variantMismatchPenalty * 0.4),
    };
  };

  lib.rankResults = function rankResults(results = [], options = {}) {
    return results
      .map((result) => lib.buildComparableResult(result, options))
      .sort((a, b) => a.adjustedRankScore - b.adjustedRankScore);
  };

  function buildComparisonSummary(source, result) {
    const sourcePrice = readSourcePrice(source);
    const totalCost = Number(result.totalCost || 0);
    const priceDelta = sourcePrice == null ? null : roundCurrency(totalCost - sourcePrice);
    const conditionComparison = compareCondition(source?.condition, result?.condition);
    const locationComparison = compareLocation(source?.locationText, result?.locationText);
    const offerComparison = compareOfferSignal(source?.bestOfferDetected, result?.bestOfferDetected);
    const shippingComparison = compareShipping(result?.shipping);
    const reasons = [];
    const mismatches = [];

    if (priceDelta != null) {
      if (priceDelta <= -25) reasons.push(`About $${Math.abs(priceDelta).toFixed(2)} cheaper than source`);
      else if (priceDelta < 0) reasons.push(`Slightly cheaper than source`);
      else if (priceDelta >= 100) mismatches.push(`About $${priceDelta.toFixed(2)} above source`);
      else if (priceDelta > 0) mismatches.push(`Priced above source`);
      else reasons.push('Price roughly matches source');
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
      priceDelta,
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

  function readSourcePrice(source) {
    const hinted = Number(source?.descriptionPriceHint);
    if (Number.isFinite(hinted) && hinted > 0) return hinted;
    const listed = Number(source?.listedPrice);
    return Number.isFinite(listed) && listed > 0 ? listed : null;
  }

  function compareCondition(sourceCondition, resultCondition) {
    const sourceRank = rankCondition(sourceCondition);
    const resultRank = rankCondition(resultCondition);
    if (!sourceRank || !resultRank) {
      return { value: 'unknown', label: '', isMismatch: false };
    }
    if (sourceRank === resultRank) {
      return { value: 'same', label: 'Condition aligns with source', isMismatch: false };
    }
    if (resultRank > sourceRank) {
      return { value: 'better', label: 'Condition looks stronger than source', isMismatch: false };
    }
    return { value: 'worse', label: 'Condition looks worse than source', isMismatch: true };
  }

  function compareLocation(sourceLocation, resultLocation) {
    const source = String(sourceLocation || '').toLowerCase().trim();
    const result = String(resultLocation || '').toLowerCase().trim();
    if (!source || !result) {
      return { value: 'unknown', label: '', isMismatch: false };
    }

    const sourceParts = source.split(',').map((part) => part.trim()).filter(Boolean);
    const resultParts = result.split(',').map((part) => part.trim()).filter(Boolean);
    const sourceCity = sourceParts[0] || '';
    const sourceState = sourceParts[1] || '';
    const sourceCountry = sourceParts[sourceParts.length - 1] || '';

    if (sourceCity && result.includes(sourceCity)) {
      return { value: 'same-city', label: 'Location is close to source', isMismatch: false };
    }
    if (sourceState && result.includes(sourceState)) {
      return { value: 'same-state', label: 'Same state as source', isMismatch: false };
    }
    if (sourceCountry && resultParts[resultParts.length - 1] === sourceCountry) {
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

  function rankCondition(value) {
    const text = String(value || '').toLowerCase();
    if (!text) return 0;
    if (/new/.test(text)) return 5;
    if (/like new/.test(text)) return 4;
    if (/very good|good|used/.test(text)) return 3;
    if (/fair|acceptable/.test(text)) return 2;
    if (/parts|broken|poor/.test(text)) return 1;
    return 0;
  }

  function roundCurrency(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }
})(globalThis);
