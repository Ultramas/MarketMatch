# MarketMatch

Firefox-first browser extension that captures a Facebook Marketplace listing and compares it against eBay Browse API matches without a backend.

## What it does
- Capture a Facebook Marketplace listing from the current page
- Require both title and description before searching
- Build a normalized query from the captured listing
- Search eBay Browse API with a user-supplied token from Options
- Rank matches with price, shipping, tax, and lightweight confidence signals
- Save filters, draft inputs, settings, and consent-gated history in extension storage

## Current flow
1. Open a Facebook Marketplace listing.
2. Click `Capture Facebook Listing` in the popup.
3. Review or edit the captured title and description.
4. Click `Search eBay Matches`.
5. Review ranked eBay results in the popup.

## Notes
- Frontend-only: the extension does not mint eBay tokens.
- The eBay application token must be pasted into Options.
- Facebook extraction is heuristic and will need ongoing selector maintenance.
- If capture is partial, the popup shows notes so missing fields can be filled manually.

## Main files
```text
src/
  adapters/facebook.js   Facebook Marketplace capture
  background.js          eBay API requests
  content.js             page-side capture bridge
  popup.js               popup actions and rendering
  options.js             saved token and defaults
  lib/                   normalize, filters, ranking, history, state
docs/
  IMPLEMENTATION_PLAN.md
manifest.json
```

## Next
- Keep tuning Facebook capture against more Marketplace page variants
- Improve eBay filtering and result quality
- Add Firefox-focused validation
