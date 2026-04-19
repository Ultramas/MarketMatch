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
        ['h1 span'],
        ['[role="main"] h1'],
        ['[role="main"] h1 span'],
        ['[data-testid="marketplace_pdp_title"]'],
      ]),
      ...collectTextCandidates(root, 'h1, h2, [role="heading"], strong', 16),
    ])
      .map(normalizeFacebookTitle)
      .filter(isUsefulTitle);

    return pickBestCandidate(candidates, scoreTitleCandidate) || '';
  }

  function extractDescription(doc, root) {
    const sectionDescription = extractSectionBoundDescription(root);
    if (isUsefulDescription(sectionDescription)) return sectionDescription;

    const labeledDescription = extractInlineLabeledValue(root, /seller'?s description|description/i);
    if (isUsefulDescription(labeledDescription)) return labeledDescription;

    const explicitCandidates = collectCandidates([
      ...selectorsToCandidates(doc, [
        ['meta[property="og:description"]', 'content'],
        ['meta[name="description"]', 'content'],
        ['[data-testid="marketplace_pdp_description"]'],
        ['[role="main"] [data-testid*="description"]'],
      ]),
      ...collectLabeledTextCandidates(root, [/description/i], 6),
    ])
      .flatMap(expandDescriptionCandidates)
      .filter(isUsefulDescription);

    const fallbackCandidates = collectCandidates([
      ...collectStructuredTextCandidates(root, '[role="main"] p, [role="main"] div, [role="main"] span, div[data-testid], span[data-testid]', 140),
      ...collectStructuredTextCandidates(root, 'p, div, span', 220),
    ])
      .filter(isUsefulDescription);

    const candidates = collectCandidates([
      ...explicitCandidates,
      ...fallbackCandidates,
    ]);

    return pickBestCandidate(candidates, scoreDescriptionCandidate) || '';
  }

  function extractSectionBoundDescription(root) {
    const labelPatterns = [/^seller'?s description\b[:\-]?$/i, /^description\b[:\-]?$/i];
    const boundaryPatterns = [
      /^condition\b/i,
      /^seller details?\b/i,
      /^listed by\b/i,
      /^availability\b/i,
      /^location\b/i,
      /^pickup\b/i,
      /^shipping\b/i,
      /^more from this seller\b/i,
      /^vehicle history report\b/i,
      /^details\b/i,
      /^about this vehicle\b/i,
      /^similar listings?\b/i,
      /^marketplace\b/i,
    ];
    const nodes = Array.from((root || document.body).querySelectorAll('h2, h3, h4, strong, div, span')).slice(0, 280);
    const candidates = [];

    for (const node of nodes) {
      if (!isLikelySectionLabelNode(node, labelPatterns)) continue;
      candidates.push(...collectSectionDescriptionCandidates(node, boundaryPatterns));
      if (candidates.length >= 18) break;
    }

    const expandedCandidates = collectCandidates(candidates).flatMap(expandDescriptionCandidates);
    return pickBestCandidate(expandedCandidates, scoreDescriptionCandidate) || '';
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
      ...collectStructuredTextCandidates(root, '[role="main"] span, [role="main"] div', 180),
      ...collectTextCandidates(root, 'span, div', 160),
    ])
      .map(extractLocationFragment)
      .map(stripBoilerplateLocation)
      .filter(isUsefulLocation);

    return pickBestCandidate(candidates, scoreLocationCandidate) || '';
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

  function isLikelySectionLabelNode(node, labelPatterns) {
    const text = cleanText(node?.textContent);
    if (!text || text.length > 80) return false;
    return labelPatterns.some((pattern) => pattern.test(text));
  }

  function collectSectionDescriptionCandidates(labelNode, boundaryPatterns) {
    const candidates = [];
    const strippedLabelText = stripSectionLabel(labelNode?.textContent);
    if (strippedLabelText) candidates.push(strippedLabelText);

    const anchors = [
      labelNode,
      labelNode?.parentElement,
    ].filter((anchor, index, all) => anchor && all.indexOf(anchor) === index)
      .filter((anchor) => anchor === labelNode || isLikelySectionAnchorNode(anchor, labelNode));

    for (const anchor of anchors) {
      candidates.push(...collectSectionSiblingCandidates(anchor, boundaryPatterns));
    }

    return candidates;
  }

  function collectSectionSiblingCandidates(anchorNode, boundaryPatterns) {
    const chunks = [];
    let current = anchorNode?.nextElementSibling || null;
    let steps = 0;

    while (current && steps < 8) {
      if (isLikelySectionBoundaryNode(current, boundaryPatterns)) break;

      const { text, hitBoundary } = extractTextBeforeBoundary(current, boundaryPatterns);
      if (text && text.length <= 900) {
        chunks.push(text);
      }
      if (hitBoundary) break;

      current = current.nextElementSibling;
      steps += 1;
    }

    const candidates = [...chunks];
    let combined = '';
    for (const chunk of chunks.slice(0, 4)) {
      combined = cleanText(`${combined} ${chunk}`);
      if (combined) candidates.push(combined);
    }

    return candidates;
  }

  function isLikelySectionAnchorNode(anchorNode, labelNode) {
    if (!anchorNode || !labelNode || !anchorNode.contains(labelNode)) return false;
    const text = cleanText(anchorNode.textContent);
    if (!text || text.length > 500) return false;
    const childCount = anchorNode.children.length;
    return childCount >= 2 && childCount <= 6;
  }

  function extractTextBeforeBoundary(node, boundaryPatterns) {
    const doc = node?.ownerDocument || document;
    const view = doc.defaultView || globalThis;
    const walker = doc.createTreeWalker(
      node,
      (view.NodeFilter?.SHOW_ELEMENT || 1) | (view.NodeFilter?.SHOW_TEXT || 4)
    );
    const chunks = [];
    let hitBoundary = false;

    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current.nodeType === 1 && isLikelySectionBoundaryNode(current, boundaryPatterns)) {
        hitBoundary = true;
        break;
      }

      if (current.nodeType === 3) {
        const text = cleanText(current.textContent);
        if (text) chunks.push(text);
      }
    }

    return {
      text: cleanText(chunks.join(' ')),
      hitBoundary,
    };
  }

  function isLikelySectionBoundaryNode(node, boundaryPatterns) {
    const text = cleanText(node?.textContent);
    if (!text || text.length > 120) return false;
    return boundaryPatterns.some((pattern) => pattern.test(text));
  }

  function stripSectionLabel(text) {
    return cleanText(String(text || '').replace(/^(seller'?s description|description)\b[:\-]?\s*/i, ''));
  }

  function extractInlineLabeledValue(root, pattern) {
    const nodes = Array.from((root || document.body).querySelectorAll('div, span, strong, h2, h3')).slice(0, 260);

    for (const node of nodes) {
      const text = cleanText(node.textContent);
      if (!text || !pattern.test(text)) continue;

      const stripped = cleanText(text.replace(pattern, ''));
      if (isUsefulDescription(stripped)) return stripped;

      const nearby = [
        cleanText(node.firstElementChild?.textContent),
        cleanText(node.nextElementSibling?.textContent),
        cleanText(node.nextElementSibling?.nextElementSibling?.textContent),
      ];

      for (const candidate of nearby) {
        if (isUsefulDescription(candidate)) return candidate;
      }
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

  function collectStructuredTextCandidates(root, selector, limit = 60) {
    return Array.from((root || document.body).querySelectorAll(selector))
      .slice(0, limit)
      .filter((node) => !nodeLooksTooBroad(node))
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
        cleanText(node.nextElementSibling?.nextElementSibling?.textContent),
        cleanText(node.parentElement?.nextElementSibling?.textContent),
      ].filter(Boolean);

      candidates.push(...nearby);
      if (candidates.length >= limit) break;
    }

    return candidates;
  }

  function collectCandidates(values) {
    return [...new Set((values || []).map(cleanText).filter(Boolean))];
  }

  function expandDescriptionCandidates(value) {
    const text = cleanText(value);
    if (!text) return [];

    const expanded = [text];
    const labelMatch = text.match(/(?:seller'?s description|description)\b[:\-]?\s*(.+)$/i);
    if (labelMatch?.[1]) {
      expanded.push(cleanText(labelMatch[1]));
    }

    const sentenceChunks = text
      .split(/(?<=[.!?])\s+(?=[A-Z0-9])|\s{2,}|\s+[·•|]\s+/)
      .map(cleanText)
      .filter((chunk) => chunk.length >= 20);

    for (let index = 0; index < sentenceChunks.length; index += 1) {
      expanded.push(sentenceChunks[index]);
      if (sentenceChunks[index + 1]) {
        expanded.push(cleanText(`${sentenceChunks[index]} ${sentenceChunks[index + 1]}`));
      }
    }

    return expanded;
  }

  function nodeLooksTooBroad(node) {
    if (!node) return true;
    const text = cleanText(node.textContent);
    if (!text) return true;
    if (text.length > 900) return true;
    if (node.children.length >= 8 && text.length > 220) return true;
    return false;
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
    if (value.length >= 80) score += 6;
    if (value.length < 60) score -= 4;
    if (/[.!?]/.test(value)) score += 4;
    if (/\$\s?\d/.test(value)) score += 4;
    if (/condition|pickup|shipping|firm|obo|offer/i.test(value)) score += 4;
    if (/seller'?s description|description/i.test(value)) score += 10;
    if (/facebook|marketplace|log in|share|send seller a message|see less|see more/i.test(value)) score -= 24;
    if (/listed\s+\d+\s+(weeks?|days?|hours?)\s+ago/i.test(value)) score -= 10;
    if (/hide this listing|save this item|message seller|seller details|availability|create new listing/i.test(value)) score -= 22;
    if (/deposit|down payment|financing|per month/i.test(value)) score -= 16;
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

    const match = value.match(/(\d+\s+miles away|[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)*,\s?[A-Z]{2}|[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)*,\s?[A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)*|ships to you|local pickup)/);
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
    if (/,[A-Z]{2}\b/.test(value)) score += 16;
    if (/,[A-Z][a-z]+/.test(value)) score += 12;
    if (/miles away/i.test(value)) score += 10;
    if (/ships to you|local pickup/i.test(value)) score += 4;
    return score;
  }

  function isUsefulDescription(text) {
    const value = cleanText(text);
    if (!value) return false;
    if (value.length < 30 || value.length > 1200) return false;
    if (/^\$\d/.test(value)) return false;
    if (/today'?s picks/i.test(value)) return false;
    if (/facebook|marketplace|messenger|log in|see more|see less|send seller a message|share|save|hide this listing|message seller|seller details|availability/i.test(value)) return false;
    if (/listed\s+\d+\s+(minutes?|hours?|days?|weeks?)\s+ago/i.test(value)) return false;
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
