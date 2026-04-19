# MarketMatch

Firefox-first browser extension for capturing a Facebook Marketplace listing and comparing it against eBay Browse API matches with no backend service.

## What The Current Build Covers
- Manifest V3 extension structure
- Facebook source capture heuristics in the content script adapter layer
- Frontend-only eBay Browse API request flow through the extension background worker
- Comparison popup UI for source listing + top eBay matches + landed-cost signals
- Options page for storing eBay API token/config and comparison defaults
- First-run consent prompt for cookies/history logging
- Persistent user inputs and preferences across sessions
- Search/view history gated behind user consent
- Shared normalization/filter/ranking helpers used by the popup runtime
- Top-match enrichment via eBay Browse `getItem`
- Lightweight confidence scoring and matched-token hints in popup ranking
- Hardened Facebook Marketplace capture heuristics for title, description, price, seller, and location extraction
- Implementation plan in `docs/IMPLEMENTATION_PLAN.md`

## Core Product Goal
- Start from a listing page or a manual form.
- Require both title and description.
- Build a normalized query from those fields.
- Scrape the source listing from Facebook in-page with frontend heuristics.
- Call eBay Browse API directly from the extension using a user-supplied application token stored in Options.
- Normalize price, shipping, taxes, condition, seller standing, seller rating, and location.
- Present the strongest eBay matches back in the popup with landed-cost context and flags.
- Save form inputs, filters, and preferences across sessions.
- Ask for cookie/history consent on first use before logging searches or viewed listings.

## Supported Rules
- Distance filters: same city, same state, same country, or any.
- Seller standing filters.
- Optional brand match.
- Seller rating thresholds:
  Default minimum positive ratings: `5`
  Default maximum negatives: `floor(positive / 5)` with a minimum cap of `1`.
- Free shipping filter.
- Free shipping filtering only passes explicitly zero-cost eBay shipping; unknown shipping is not treated as free.
- If the description contains a money amount, prefer that over the visible listing price.
- Flag if `best offer` or `offer` appears in title or description.
- On Facebook Marketplace, ignore and flag `free`, `$1`, or `1$` placeholder prices.
- Taxes use a default rate, but should prefer state-based handling when the user provides a state.
- Seller standing is a ranking boost, not a strict pass/fail requirement.
- eBay API token minting is not done inside the extension; the extension expects a token generated externally and pasted into Options.

## Current Project Layout
```text
docs/
  ARCHITECTURE.md
  IMPLEMENTATION_PLAN.md
src/
  adapters/
    craigslist.js
    ebay.js
    facebook.js
    registry.js
  lib/
    coupons.js
    ebay-api.js
    filters.js
    history.js
    mock-data.js
    normalize.js
    ranking.js
    state.js
  background.js
  content.js
  options.html
  options.js
  popup.html
  popup.js
manifest.json
```

`src/adapters/ebay.js`, `src/adapters/craigslist.js`, and `src/lib/coupons.js` are present as future-facing stubs, but the active product flow is Facebook capture -> eBay Browse comparison.

## Current Runtime Flow
1. User opens a Facebook Marketplace listing.
2. On first use, the extension asks whether cookies/history logging are allowed.
3. User clicks the extension and presses `Capture Facebook Listing`.
4. The content script extracts title, description, price, seller info, condition, and location from Facebook using metadata, scoped Marketplace selectors, and conservative text fallbacks.
5. The extension refuses to continue unless both title and description are present.
6. The popup builds a normalized query from the Facebook source listing.
7. The background worker calls eBay Browse API with the saved application token.
8. The extension maps the API response into comparable result cards.
9. The ranking layer computes landed cost and soft boosts.
10. The popup shows the strongest eBay matches, cost breakdown clues, seller signals, and flags.

## Manual-Control Bias
This implementation assumes user-triggered collection rather than unattended crawling:
- user clicks buttons to capture the current page
- user clicks a button to query eBay from the popup
- user can refine brand/distance/rating filters before final ranking
- user explicitly opts in before history/cookie-backed behavior is enabled

That approach is safer for extension UX and easier to reason about than hidden background scraping.

## Ranking Inputs
- effective price
- taxes
- shipping
- total landed cost
- distance match
- brand match
- seller standing
- seller rating quality
- condition quality
- placeholder-price flags
- offer/best-offer flags
- eBay buying options / seller feedback

## Notes
- Facebook Marketplace extraction now prefers metadata and scoped Marketplace text before broad fallbacks, and records capture notes when title, description, price, seller, or location cannot be found automatically.
- eBay Browse API requires an OAuth application token, but token minting is intentionally left outside the extension because embedding client-secret-based auth in frontend code is unsafe.
- The extension stores popup inputs, preferences, consent state, and eBay token/config in extension storage.
- Tax calculation should use two modes: parsed from page when available, otherwise estimated from a default rate or a state-based rate when the user provides a state.
- Current popup filtering is active for free shipping, seller-threshold heuristics, brand-required matching, and basic location matching from captured Facebook/eBay location strings.
- After search, the extension enriches the top eBay matches with Browse `getItem` details for better shipping/condition/seller signals.
- Query construction now strips noisy Facebook sales words and emphasizes stronger product/model tokens before calling eBay.
- Popup ranking now includes lightweight match-confidence scoring and matched-token hints.
- Popup match cards now show clearer price/shipping/confidence metrics plus direct eBay listing/search links.

## Facebook Capture Heuristics
- Title capture prefers Open Graph and heading signals, then scores short Marketplace-style heading candidates.
- Description capture prefers metadata and nearby description-labeled blocks before wider text fallback.
- Price capture prefers explicit price metadata or nearby price-labeled content before general text scanning.
- Seller capture prefers Marketplace profile links and labeled seller text, with extra filtering for UI boilerplate.
- Location capture prefers explicit location/pickup/shipping text and conservative locality-shaped matches.
- If capture is partial, the popup shows capture notes so the user can manually fill gaps before searching eBay.

## Next Build Steps
1. Keep tuning Facebook listing extraction selectors against more real Facebook Marketplace page variants and login-wall/public-page differences.
2. Expand eBay Browse API request filters and item-detail enrichment.
3. Add Firefox-targeted testing and manifest validation.
4. Decide whether unused adapters/coupon scaffolds should be implemented or removed.

## Chosen Defaults
- Prioritize Firefox first.
- Facebook is the source platform; eBay is the comparison platform.
- Taxes use a default rate, with better handling when user state is known.
- Seller standing acts as a ranking boost.
- Search/view history only logs after consent.
