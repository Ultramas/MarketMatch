(function registerFacebookAdapter(globalScope) {
  globalScope.MarketMatchAdapters?.registerAdapter('facebook', function getFacebookAdapter() {
    return {
      platform: 'facebook',
      captureListing(context = {}) {
        const doc = context.document || document;
        const mainRoot = findMainRoot(doc);
        const title = extractTitle(doc, mainRoot);
        const description = extractDescription(doc, mainRoot);
        const listedPrice = extractPrice(doc, mainRoot);
        const sellerName = extractSellerName(doc, mainRoot);
        const locationText = extractLocationText(mainRoot || doc.body);
        const condition = findCondition(mainRoot || doc.body);
        const combinedText = `${title || ''} ${description || ''}`.trim();
        const moneyHints = extractMoneyHints(description);
        const descriptionPriceHint = moneyHints.length ? moneyHints[0] : null;
        const notes = buildCaptureNotes({ title, description, listedPrice, locationText, sellerName });

        return {
          platform: 'facebook',
          supported: Boolean(title && description),
          url: context.url || '',
          title: title || '',
          description: description || '',
          listedPrice,
          descriptionPriceHint,
          shipping: inferShipping(doc.body),
          taxes: null,
          condition,
          sellerName: sellerName || '',
          sellerStanding: '',
          positiveRatings: null,
          negativeRatings: null,
          locationText: locationText || '',
          bestOfferDetected: /\bbest offer\b|\boffer\b/i.test(combinedText),
          placeholderPriceFlag: isFacebookPlaceholderPrice(listedPrice, combinedText),
          notes,
        };
      },
      collectResults() {
        return {
          platform: 'facebook',
          supported: false,
          results: [],
          notes: ['Facebook result collection is not used in the current Facebook-to-eBay flow.'],
        };
      },
    };
  });

  function firstText(doc, selectors, attrName) {
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      if (!node) continue;
      const raw = attrName ? node.getAttribute(attrName) : node.textContent;
      const value = cleanText(raw);
      if (value) return value;
    }
    return '';
  }

  function findMainRoot(doc) {
    return doc.querySelector('[role="main"]') || doc.querySelector('main') || doc.body;
  }

  function extractTitle(doc, root) {
    const candidates = collectCandidates([
      ...selectorsToCandidates(doc, [
        ['meta[property="og:title"]', 'content'],
        ['meta[name="twitter:title"]', 'content'],
        ['h1'],
        ['[role="main"] h1'],
        ['[data-testid="marketplace_pdp_title"]'],
      ]),
      ...collectTextCandidates(root, 'h1, h2, [role="heading"], strong', 16),
    ])
      .map(normalizeFacebookTitle)
      .filter(isUsefulTitle);

    return pickBestCandidate(candidates, scoreTitleCandidate) || '';
  }

  function extractDescription(doc, root) {
    const labeledDescription = extractInlineLabeledValue(root, /seller'?s description|description/i);
    if (isUsefulDescription(labeledDescription)) return labeledDescription;

    const candidates = collectCandidates([
      ...selectorsToCandidates(doc, [
        ['meta[property="og:description"]', 'content'],
        ['meta[name="description"]', 'content'],
      ]),
      ...collectLabeledTextCandidates(root, [/description/i], 6),
      ...collectTextCandidates(root, '[role="main"] div, [role="main"] span, div[data-testid], span[data-testid]', 120),
      ...collectTextCandidates(root, 'div, span', 220),
    ]).filter(isUsefulDescription);

    return pickBestCandidate(candidates, scoreDescriptionCandidate) || '';
  }

  function extractPrice(doc, root) {
    const explicitCandidates = collectCandidates([
      ...selectorsToCandidates(doc, [
        ['meta[property="product:price:amount"]', 'content'],
        ['meta[name="product:price:amount"]', 'content'],
      ]),
      ...collectLabeledTextCandidates(root, [/price/i], 8),
      ...collectTextCandidates(root, 'span, div, strong', 80),
    ]);

    for (const text of explicitCandidates) {
      const price = parsePrice(text);
      if (price != null) return price;
    }

    return null;
  }

  function extractSellerName(doc, root) {
    const candidates = collectCandidates([
      ...selectorsToCandidates(doc, [
        ['a[href*="/marketplace/profile/"] span'],
        ['a[href*="/profile.php"] span'],
        ['[role="main"] a[href*="/marketplace/profile/"]'],
      ]),
      ...collectLabeledTextCandidates(root, [/seller/i, /listed by/i], 6),
    ])
      .map(normalizeSellerName)
      .filter(Boolean);

    return pickBestCandidate(candidates, scoreSellerCandidate) || '';
  }

  function inferShipping(root) {
    const text = cleanText(root?.textContent || '');
    if (/free shipping|ships for free/i.test(text)) return 0;
    return null;
  }

  function findCondition(root) {
    const text = cleanText(root?.textContent || '');
    const match = text.match(/\b(new|used - like new|used - good|used - fair|used|refurbished)\b/i);
    return match ? match[1] : '';
  }

  function extractLocationText(root) {
    const candidates = collectCandidates([
      ...collectLabeledTextCandidates(root, [/location/i, /pickup/i, /ships to you/i], 8),
      ...collectTextCandidates(root, 'span, div', 160),
    ])
      .map(extractLocationFragment)
      .map(stripBoilerplateLocation)
      .filter(isUsefulLocation);

    return pickBestCandidate(candidates, scoreLocationCandidate) || '';
  }

  function findTextByPattern(root, pattern) {
    const text = cleanText(root?.textContent || '');
    const match = text.match(pattern);
    return match ? match[0] : '';
  }

  function extractMoneyHints(text) {
    const matches = String(text || '').match(/(?:[A-Z]{1,3}\s*)?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|(?:[A-Z]{1,3}\s*)?\$\s?\d+(?:\.\d{1,2})?/g) || [];
    return matches.map((value) => Number(value.replace(/[^\d.]/g, ''))).filter(Number.isFinite);
  }

  function parsePrice(text) {
    const value = cleanText(text);
    if (!value || /per month|deposit|down payment|financing/i.test(value)) return null;

    const match = value.match(/(?:^|\b|\s)(?:[A-Z]{1,3}\s*)?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/);
    if (!match) return null;

    const price = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(price) ? price : null;
  }

  function isFacebookPlaceholderPrice(price, text) {
    return Number(price) === 1 || /\bfree\b|\$1\b|\b1\$/i.test(String(text || ''));
  }

  function normalizeFacebookTitle(title) {
    return cleanText(String(title || '')
      .replace(/\s*\|\s*Facebook.*$/i, '')
      .replace(/\s*Marketplace\s*-\s*/i, ''));
  }

  function normalizeSellerName(value) {
    const text = cleanText(value);
    if (!text || /marketplace|facebook|message|share|save|details|condition|description|availability|shipping/i.test(text)) return '';
    if (/[$\d,]|listed\s+\d+|miles away|local pickup|ships to you/i.test(text)) return '';
    if (/^(vehicles|cars\s*&\s*trucks|beds\s*&\s*bed\s*frames|property rentals|apparel|classifieds|electronics|entertainment|family|free stuff|garden & outdoor|hobbies|home goods|home improvement supplies|home sales|musical instruments|office supplies|pet supplies|sporting goods|toys & games)$/i.test(text)) return '';
    if (text.length > 60) return '';
    return text;
  }

  function extractInlineLabeledValue(root, pattern) {
    const nodes = Array.from((root || document.body).querySelectorAll('div, span, strong, h2, h3')).slice(0, 260);

    for (const node of nodes) {
      const text = cleanText(node.textContent);
      if (!text || !pattern.test(text)) continue;

      const stripped = cleanText(text.replace(pattern, ''));
      if (isUsefulDescription(stripped)) return stripped;

      const nextText = cleanText(node.nextElementSibling?.textContent);
      if (isUsefulDescription(nextText)) return nextText;
    }

    return '';
  }

  function buildCaptureNotes({ title, description, listedPrice, locationText, sellerName }) {
    const notes = [
      'Facebook extraction prefers metadata and scoped Marketplace text before broad fallbacks.',
      'Description money hints are captured when dollar amounts appear in the description.',
    ];

    if (!title) notes.push('Title was not captured automatically.');
    if (!description) notes.push('Description was not captured automatically.');
    if (listedPrice == null) notes.push('Visible listing price was not detected automatically.');
    if (!locationText) notes.push('Location text was not detected automatically.');
    if (!sellerName) notes.push('Seller name was not detected automatically.');

    return notes;
  }

  function selectorsToCandidates(doc, selectorsWithAttrs) {
    return selectorsWithAttrs
      .map(([selector, attrName]) => firstText(doc, [selector], attrName))
      .filter(Boolean);
  }

  function collectTextCandidates(root, selector, limit = 40) {
    return Array.from((root || document.body).querySelectorAll(selector))
      .slice(0, limit)
      .map((node) => cleanText(node.textContent))
      .filter(Boolean);
  }

  function collectLabeledTextCandidates(root, labelPatterns, limit = 10) {
    const nodes = Array.from((root || document.body).querySelectorAll('div, span, strong, h2, h3, a')).slice(0, 220);
    const candidates = [];

    for (const node of nodes) {
      const text = cleanText(node.textContent);
      if (!text) continue;

      const matchedPattern = labelPatterns.find((pattern) => pattern.test(text));
      if (!matchedPattern) continue;

      const nearby = [
        cleanText(node.nextElementSibling?.textContent),
        cleanText(node.parentElement?.textContent),
      ].filter(Boolean);

      candidates.push(...nearby);
      if (candidates.length >= limit) break;
    }

    return candidates;
  }

  function collectCandidates(values) {
    return [...new Set((values || []).map(cleanText).filter(Boolean))];
  }

  function pickBestCandidate(candidates, scorer) {
    let best = '';
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const score = scorer(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  function scoreTitleCandidate(value) {
    let score = 0;
    if (value.length >= 6 && value.length <= 140) score += 15;
    if (/\d/.test(value)) score += 6;
    if (/facebook|marketplace|buy now|log in|messenger/i.test(value)) score -= 30;
    if (/^[A-Z0-9][A-Za-z0-9\-\s]+$/.test(value)) score += 4;
    return score;
  }

  function scoreDescriptionCandidate(value) {
    let score = 0;
    if (value.length >= 30 && value.length <= 900) score += 18;
    if (/\$\s?\d/.test(value)) score += 4;
    if (/condition|pickup|shipping|firm|obo|offer/i.test(value)) score += 4;
    if (/seller'?s description|description/i.test(value)) score += 10;
    if (/facebook|marketplace|log in|share|send seller a message|see less|see more/i.test(value)) score -= 24;
    if (/listed\s+\d+\s+(weeks?|days?|hours?)\s+ago/i.test(value)) score -= 10;
    if (/today'?s picks/i.test(value)) score -= 40;
    if ((value.match(/(?:[A-Z]{1,3}\s*)?\$\s?\d/g) || []).length > 2) score -= 30;
    return score;
  }

  function scoreSellerCandidate(value) {
    let score = 0;
    if (value.length >= 2 && value.length <= 32) score += 12;
    if (/^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}$/.test(value)) score += 8;
    if (/seller|listed by|marketplace|message/i.test(value)) score -= 20;
    return score;
  }

  function extractLocationFragment(text) {
    const value = cleanText(text);
    if (!value) return '';

    const match = value.match(/(ships to you|local pickup|\d+\s+miles away|[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)*,\s?[A-Z]{2}|[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)*,\s?[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)*)/);
    return match ? cleanText(match[1]) : '';
  }

  function isUsefulLocation(text) {
    const value = cleanText(text);
    if (!value || value.length > 80) return false;
    if (/facebook|marketplace|share|save|message|log in/i.test(value)) return false;
    return /ships to you|local pickup|miles away|,/.test(value);
  }

  function scoreLocationCandidate(value) {
    let score = 0;
    if (/ships to you|local pickup/i.test(value)) score += 12;
    if (/miles away/i.test(value)) score += 8;
    if (/,[A-Z]{2}\b/.test(value)) score += 10;
    if (/,[A-Z][a-z]+/.test(value)) score += 8;
    return score;
  }

  function isUsefulDescription(text) {
    const value = cleanText(text);
    if (!value) return false;
    if (value.length < 30 || value.length > 1200) return false;
    if (/^\$\d/.test(value)) return false;
    if (/today'?s picks/i.test(value)) return false;
    if (/facebook|marketplace|messenger|log in|see more|see less|send seller a message|share|save/i.test(value)) return false;
    return true;
  }

  function isUsefulTitle(text) {
    const value = cleanText(text);
    if (!value) return false;
    if (value.length < 4 || value.length > 180) return false;
    if (/facebook|marketplace|log in|messenger|share|save/i.test(value)) return false;
    return true;
  }

  function stripBoilerplateLocation(text) {
    const value = cleanText(text);
    if (/facebook|marketplace|log in|share/i.test(value)) return '';
    return value;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
})(globalThis);
