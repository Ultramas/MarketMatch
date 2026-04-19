(function registerRankingLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.buildComparableResult = function buildComparableResult(result, options = {}) {
    const effectivePrice = Number(result.descriptionPriceHint || result.listedPrice || 0);
    const confidence = typeof lib.computeMatchConfidence === 'function'
      ? lib.computeMatchConfidence(options.sourceListing || {}, result)
      : { score: 0, matchedTokens: [] };
    const taxes = lib.computeTaxEstimate({
      listedTax: result.taxes,
      effectivePrice,
      defaultTaxRate: options.defaultTaxRate,
      stateTaxRate: options.stateTaxRate,
    });
    const totalCost = lib.computeTotalCost({ effectivePrice, shipping: result.shipping, taxes });
    const rankingBoost = lib.computeRankingBoosts(result, options);

    return {
      ...result,
      effectivePrice,
      taxes,
      totalCost,
      matchConfidence: confidence.score,
      matchedTokens: confidence.matchedTokens,
      rankingBoost,
      adjustedRankScore: totalCost - rankingBoost - (confidence.score * 0.12),
    };
  };

  lib.rankResults = function rankResults(results = [], options = {}) {
    return results
      .map((result) => lib.buildComparableResult(result, options))
      .sort((a, b) => a.adjustedRankScore - b.adjustedRankScore);
  };
})(globalThis);
