# MarketMatch

Firefox-first, frontend-only browser extension for capturing a Facebook Marketplace listing and comparing it against eBay Browse API matches.

## Current product direction
- Facebook Marketplace is the source capture surface.
- eBay Browse API is the comparison source.
- No backend is involved.
- Users paste an eBay application token into the Options page.

## Current capabilities
- Capture a Facebook Marketplace listing from the active page, including price, location, condition, and seller details when available
- Require both title and description before searching
- Preserve partial captures with notes so missing fields can be completed manually
- Build a normalized search query from the captured listing
- Search eBay Browse API from the background worker
- Enrich stronger matches with item detail requests
- Rank results with price, shipping, tax, seller, and lightweight confidence signals
- Clear stale eBay results when the source listing or draft changes
- Persist settings, filters, drafts, source listing state, and consent-gated history in extension storage

## Runtime flow
1. Open a Facebook Marketplace listing in Firefox.
2. Open the extension popup.
3. Click `Capture Facebook Listing`.
4. Review the captured source summary and complete any missing title or description fields.
5. Configure the eBay application token in Options if needed.
6. Click `Search eBay Matches`.
7. Review ranked matches in the popup.
8. If the source listing changes, re-run the search for fresh matches.

## Firefox setup
There is no established install/build pipeline in this repo yet. Load it as a temporary Firefox extension:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on...`.
3. Select `manifest.json` from this repository.
4. Open the extension Options page and paste an eBay application token.

## Important constraints
- Frontend-only by design.
- The extension does not mint eBay OAuth tokens.
- Facebook extraction is heuristic and needs ongoing selector maintenance.
- Public Marketplace pages and login-gated pages can expose different DOM shapes.

## Capture behavior
- Facebook extraction prefers scoped Marketplace signals before broad page fallbacks.
- Description capture is section-aware to reduce UI chrome leaking into the source description.
- Price and location capture use scored heuristics to prefer listing-specific values over nearby noise.
- Search results are tied to the current source snapshot so old comparisons are dropped when the source changes.

## Main files
```text
src/
  adapters/facebook.js   Facebook Marketplace extraction heuristics
  background.js          eBay Browse API search and enrichment flow
  content.js             page-side capture bridge
  popup.js               popup actions, validation, and rendering
  options.js             saved token and defaults
  lib/                   normalize, filters, ranking, history, state
docs/
  IMPLEMENTATION_PLAN.md
manifest.json            Firefox extension manifest
```

## Current focus
- Improve Facebook Marketplace extraction quality
- Improve eBay result quality and filtering
- Continue Firefox-targeted validation and polish
