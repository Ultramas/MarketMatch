(function registerNormalizeLib(globalScope) {
  const lib = globalScope.MarketMatchLib || (globalScope.MarketMatchLib = {});

  const STOP_WORDS = new Set([
    'the', 'and', 'with', 'for', 'from', 'this', 'that', 'have', 'used', 'brand', 'new', 'best',
    'great', 'good', 'condition', 'pickup', 'local', 'shipping', 'marketplace', 'facebook', 'item',
    'offer', 'offers', 'obo', 'firm', 'price', 'cash', 'only', 'sale', 'selling', 'ships', 'ship'
  ]);

  lib.buildQuery = function buildQuery({ brand, title, description }) {
    return lib.normalizeSearchInput({ brand, title, description }).query;
  };

  lib.normalizeSearchInput = function normalizeSearchInput({ brand, title, description }) {
    const cleanedBrand = cleanFragment(brand);
    const cleanedTitle = cleanFragment(title);
    const cleanedDescription = cleanFragment(description);
    const titleTokens = tokenize(cleanedTitle);
    const descriptionTokens = tokenize(cleanedDescription).slice(0, 14);
    const brandTokens = tokenize(cleanedBrand);

    const prioritized = dedupe([
      ...brandTokens,
      ...extractStrongTokens(titleTokens),
      ...extractStrongTokens(descriptionTokens).slice(0, 6),
    ]).slice(0, 12);

    return {
      query: prioritized.join(' ').trim(),
      brandTokens,
      titleTokens,
      descriptionTokens,
      strongTokens: prioritized,
    };
  };

  lib.computeMatchConfidence = function computeMatchConfidence(source, candidate) {
    const sourceNormalized = lib.normalizeSearchInput(source || {});
    const candidateTokens = tokenize(candidate?.title || '');
    const candidateSet = new Set(candidateTokens);

    let score = 0;
    const matched = [];

    for (const token of sourceNormalized.brandTokens) {
      if (candidateSet.has(token)) {
        score += 18;
        matched.push(token);
      }
    }

    for (const token of sourceNormalized.strongTokens) {
      if (candidateSet.has(token)) {
        score += token.length >= 5 ? 10 : 6;
        matched.push(token);
      }
    }

    if (candidate?.condition && /new|used|refurbished/i.test(candidate.condition)) {
      score += 4;
    }

    return {
      score: Math.max(0, Math.min(score, 100)),
      matchedTokens: dedupe(matched).slice(0, 6),
    };
  };

  lib.detectOfferLanguage = function detectOfferLanguage(text) {
    return /\bbest offer\b|\boffer\b/i.test(String(text || ''));
  };

  lib.extractMoneyHints = function extractMoneyHints(text) {
    const matches = String(text || '').match(/\$\s?\d+(?:\.\d{1,2})?/g) || [];
    return matches.map((value) => Number(value.replace(/[^\d.]/g, ''))).filter(Number.isFinite);
  };

  function cleanFragment(value) {
    return String(value || '')
      .replace(/[$€£]\s?\d+(?:\.\d{1,2})?/g, ' ')
      .replace(/[^a-zA-Z0-9\-\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(value) {
    return cleanFragment(value)
      .toLowerCase()
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token && token.length > 1 && !STOP_WORDS.has(token));
  }

  function extractStrongTokens(tokens) {
    return tokens.filter((token) => /\d/.test(token) || token.length >= 4);
  }

  function dedupe(values) {
    return [...new Set(values.filter(Boolean))];
  }
})(globalThis);
