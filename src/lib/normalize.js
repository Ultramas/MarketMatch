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

  lib.buildQueryVariants = function buildQueryVariants({ brand, title, description }) {
    const normalized = lib.normalizeSearchInput({ brand, title, description });
    const titleFocused = dedupe([
      ...normalized.brandTokens,
      ...extractIdentifierTokens(normalized.titleTokens),
      ...normalized.titleTokens.slice(0, 8),
    ]).slice(0, 10);
    const balanced = dedupe([
      ...normalized.brandTokens,
      ...extractStrongTokens(normalized.titleTokens),
      ...extractStrongTokens(normalized.descriptionTokens).slice(0, 4),
    ]).slice(0, 12);
    const broad = dedupe([
      ...normalized.brandTokens,
      ...normalized.titleTokens.slice(0, 6),
      ...normalized.descriptionTokens.slice(0, 4),
    ]).slice(0, 12);

    return {
      ...normalized,
      queries: dedupe([
        normalized.query,
        titleFocused.join(' ').trim(),
        balanced.join(' ').trim(),
        broad.join(' ').trim(),
      ]).filter(Boolean),
    };
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
    const variantComparison = compareVariantSignals({
      sourceSignals: extractVariantSignals(source?.title || ''),
      candidateSignals: extractVariantSignals(candidate?.title || ''),
    });

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

    score -= variantComparison.penalty;

    return {
      score: Math.max(0, Math.min(score, 100)),
      matchedTokens: dedupe(matched).slice(0, 6),
      variantMismatches: variantComparison.mismatches,
      variantMismatchPenalty: variantComparison.penalty,
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

  function extractIdentifierTokens(tokens) {
    return tokens.filter((token) => /\d/.test(token) || /-/.test(token) || token.length >= 5);
  }

  function extractVariantSignals(text) {
    const cleaned = cleanFragment(text).toLowerCase();

    return {
      storageValues: extractStorageValues(cleaned),
      quantity: extractQuantitySignal(cleaned),
      sizeFamily: extractSizeSignal(cleaned),
      identifiers: extractModelIdentifiers(cleaned),
    };
  }

  function compareVariantSignals({ sourceSignals, candidateSignals }) {
    const mismatches = [];
    let penalty = 0;

    const sourceDominantStorage = readDominantStorage(sourceSignals.storageValues);
    const candidateDominantStorage = readDominantStorage(candidateSignals.storageValues);
    if (sourceDominantStorage?.key && candidateDominantStorage?.key && sourceDominantStorage.key !== candidateDominantStorage.key) {
      penalty += 26;
      mismatches.push({
        type: 'storage',
        label: `Possible variant mismatch: ${sourceDominantStorage.label} vs ${candidateDominantStorage.label}`,
      });
    }

    if (sourceSignals.quantity?.key && candidateSignals.quantity?.key && sourceSignals.quantity.key !== candidateSignals.quantity.key) {
      penalty += 18;
      mismatches.push({
        type: 'quantity',
        label: `Possible variant mismatch: ${sourceSignals.quantity.label} vs ${candidateSignals.quantity.label}`,
      });
    }

    if (sourceSignals.sizeFamily?.key && candidateSignals.sizeFamily?.key && sourceSignals.sizeFamily.key !== candidateSignals.sizeFamily.key) {
      penalty += 18;
      mismatches.push({
        type: 'size',
        label: `Possible variant mismatch: ${sourceSignals.sizeFamily.label} vs ${candidateSignals.sizeFamily.label}`,
      });
    }

    const sourceIdentifiers = sourceSignals.identifiers || [];
    const candidateIdentifiers = candidateSignals.identifiers || [];
    if (sourceIdentifiers.length && candidateIdentifiers.length && !setsIntersect(new Set(sourceIdentifiers), new Set(candidateIdentifiers))) {
      penalty += 16;
      mismatches.push({
        type: 'identifier',
        label: `Possible variant mismatch: model ${sourceIdentifiers[0].toUpperCase()} vs ${candidateIdentifiers[0].toUpperCase()}`,
      });
    }

    return {
      penalty: Math.min(45, penalty),
      mismatches: mismatches.slice(0, 2),
    };
  }

  function extractStorageValues(text) {
    const matches = [];
    const pattern = /\b(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/gi;
    let match;

    while ((match = pattern.exec(text))) {
      const amount = Number(match[1]);
      const unit = String(match[2] || '').toLowerCase();
      if (!Number.isFinite(amount) || !unit) continue;
      matches.push({
        key: `${amount}${unit}`,
        label: `${formatVariantNumber(amount)}${unit.toUpperCase()}`,
        value: convertStorageToMegabytes(amount, unit),
      });
    }

    return dedupeSignalObjects(matches);
  }

  function extractQuantitySignal(text) {
    if (/\bpair\b/.test(text)) {
      return { key: '2', label: '2-pack' };
    }

    const setMatch = text.match(/\b(?:set|lot|pack)\s+of\s+(\d+)\b/);
    if (setMatch?.[1]) {
      const quantity = Number(setMatch[1]);
      if (Number.isFinite(quantity) && quantity > 1) {
        return { key: String(quantity), label: `${quantity}-pack` };
      }
    }

    const packMatch = text.match(/\b(\d+)\s*(?:pack|pk|pcs|piece|pieces|count|ct)\b/);
    if (packMatch?.[1]) {
      const quantity = Number(packMatch[1]);
      if (Number.isFinite(quantity) && quantity > 1) {
        return { key: String(quantity), label: `${quantity}-pack` };
      }
    }

    return null;
  }

  function extractSizeSignal(text) {
    const matches = [];
    const hasCaliforniaKing = /\b(california king|cal king)\b/.test(text);
    if (hasCaliforniaKing) {
      matches.push('california king');
    }
    if (!hasCaliforniaKing && /\bking\b/.test(text)) {
      matches.push('king');
    }
    if (/\bqueen\b/.test(text)) {
      matches.push('queen');
    }
    if (/\btwin\b/.test(text)) {
      matches.push('twin');
    }
    if (/\bfull\b/.test(text) && /\b(full size|mattress|bed|frame|headboard|box spring)\b/.test(text)) {
      matches.push('full');
    }

    const uniqueMatches = dedupe(matches);
    if (uniqueMatches.length !== 1) return null;

    const key = uniqueMatches[0];
    return {
      key,
      label: key.split(' ').map(capitalizeWord).join(' '),
    };
  }

  function extractModelIdentifiers(text) {
    return dedupe(
      extractIdentifierTokens(tokenize(text)).filter((token) => (
        token.length >= 4
        && /[a-z]/.test(token)
        && /\d/.test(token)
        && !/^\d+(?:\.\d+)?(?:gb|tb|mb)$/.test(token)
      ))
    ).slice(0, 4);
  }

  function formatSignalList(items = []) {
    return items.map((item) => item.label).filter(Boolean).join(', ');
  }

  function readDominantStorage(items = []) {
    return [...items].sort((left, right) => Number(right.value || 0) - Number(left.value || 0))[0] || null;
  }

  function dedupeSignalObjects(items = []) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item?.key || seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  }

  function setsIntersect(left, right) {
    for (const value of left) {
      if (right.has(value)) return true;
    }
    return false;
  }

  function formatVariantNumber(value) {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  }

  function convertStorageToMegabytes(amount, unit) {
    if (unit === 'tb') return amount * 1024 * 1024;
    if (unit === 'gb') return amount * 1024;
    return amount;
  }

  function capitalizeWord(word) {
    return word ? `${word[0].toUpperCase()}${word.slice(1)}` : '';
  }

  function dedupe(values) {
    return [...new Set(values.filter(Boolean))];
  }
})(globalThis);
