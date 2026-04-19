(function registerRankingLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  lib.buildComparableResult = function buildComparableResult(result, options = {}) {
    const effectivePrice = Number(result.descriptionPriceHint || result.listedPrice || 0);
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
      rankingBoost,
      adjustedRankScore: totalCost - rankingBoost,
    };
  };

  lib.rankResults = function rankResults(results = [], options = {}) {
    return results
      .map((result) => lib.buildComparableResult(result, options))
      .sort((a, b) => a.adjustedRankScore - b.adjustedRankScore);
  };
})(globalThis);
