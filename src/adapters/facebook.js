(function registerFacebookAdapter(globalScope) {
  globalScope.MarketMatchAdapters?.registerAdapter('facebook', function getFacebookAdapter() {
    return {
      platform: 'facebook',
      captureListing(context = {}) {
        const doc = context.document || document;
        const title = firstText(doc, [
          'meta[property="og:title"]',
          'h1',
          '[role="main"] h1',
        ], 'content');

        const description = extractDescription(doc);
        const listedPrice = extractPrice(doc);
        const sellerName = firstText(doc, [
          'a[href*="/marketplace/profile/"] span',
          '[role="main"] a span',
        ]);
        const locationText = findTextByPattern(doc.body, /(ships to you|local pickup|miles away|\b[A-Z][a-z]+,\s?[A-Z]{2}\b)/i);
        const condition = findCondition(doc.body);
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
            'Facebook extraction uses DOM/meta heuristics and may need selector tuning.',
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

  function extractDescription(doc) {
    const metaDescription = firstText(doc, ['meta[property="og:description"]', 'meta[name="description"]'], 'content');
    if (metaDescription) return metaDescription;

    const candidates = Array.from(doc.querySelectorAll('div, span'))
      .map((node) => cleanText(node.textContent))
      .filter((text) => text && text.length > 60 && text.length < 1200);

    return candidates.find((text) => !/^\$\d/.test(text)) || '';
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
    const match = text.match(/\b(new|used - like new|used - good|used - fair|used)\b/i);
    return match ? match[1] : '';
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

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
})(globalThis);
