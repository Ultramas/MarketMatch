(function registerFacebookAdapter(globalScope) {
  globalScope.MarketMatchAdapters?.registerAdapter('facebook', function getFacebookAdapter() {
    return {
      platform: 'facebook',
      captureListing(context = {}) {
        const doc = context.document || document;
        const mainRoot = findMainRoot(doc);
        const title = normalizeFacebookTitle(firstText(doc, [
          'meta[property="og:title"]',
          '[role="main"] h1',
          'h1',
        ], 'content'));

        const description = extractDescription(doc, mainRoot);
        const listedPrice = extractPrice(doc);
        const sellerName = normalizeSellerName(firstText(doc, [
          'a[href*="/marketplace/profile/"] span',
          '[role="main"] a span',
        ]));
        const locationText = extractLocationText(mainRoot || doc.body);
        const condition = findCondition(mainRoot || doc.body);
        const combinedText = `${title || ''} ${description || ''}`.trim();
        const moneyHints = extractMoneyHints(description);
        const descriptionPriceHint = moneyHints.length ? moneyHints[0] : null;

        return {
          platform: 'facebook',
          supported: Boolean(title || description),
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
          notes: [
            'Facebook extraction prefers main-content and metadata heuristics before broad text fallbacks.',
            'Description money hints are captured when dollar amounts appear in the description.',
          ],
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

  function extractDescription(doc, root) {
    const metaDescription = firstText(doc, ['meta[property="og:description"]', 'meta[name="description"]'], 'content');
    if (isUsefulDescription(metaDescription)) return metaDescription;

    const scopedRoot = root || doc.body;
    const candidates = Array.from(scopedRoot.querySelectorAll('div, span'))
      .map((node) => cleanText(node.textContent))
      .filter((text) => isUsefulDescription(text));

    return candidates[0] || '';
  }

  function extractPrice(doc) {
    const textCandidates = [
      firstText(doc, ['meta[property="product:price:amount"]'], 'content'),
      ...Array.from(doc.querySelectorAll('span, div')).slice(0, 120).map((node) => cleanText(node.textContent)),
    ].filter(Boolean);

    for (const text of textCandidates) {
      const match = String(text).match(/\$\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)/);
      if (match) {
        return Number(match[1].replace(/,/g, ''));
      }
    }

    return null;
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
    const direct = findTextByPattern(root, /(ships to you|local pickup|\d+\s+miles away|\b[A-Z][a-z]+,\s?[A-Z]{2}\b|\b[A-Z][a-z]+,\s?[A-Z][a-z]+\b)/i);
    return stripBoilerplateLocation(direct);
  }

  function findTextByPattern(root, pattern) {
    const text = cleanText(root?.textContent || '');
    const match = text.match(pattern);
    return match ? match[0] : '';
  }

  function extractMoneyHints(text) {
    const matches = String(text || '').match(/\$\s?\d+(?:\.\d{1,2})?/g) || [];
    return matches.map((value) => Number(value.replace(/[^\d.]/g, ''))).filter(Number.isFinite);
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
    if (!text || /marketplace|facebook|message/i.test(text)) return '';
    return text;
  }

  function isUsefulDescription(text) {
    const value = cleanText(text);
    if (!value) return false;
    if (value.length < 40 || value.length > 1200) return false;
    if (/^\$\d/.test(value)) return false;
    if (/facebook|marketplace|messenger|log in|see more|send seller a message/i.test(value)) return false;
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
