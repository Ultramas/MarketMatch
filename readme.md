# MarketMatch

Firefox-first browser extension plus a lightweight backend proxy for capturing a Facebook Marketplace listing and comparing it against eBay Browse API matches.

## Current product direction
- Facebook Marketplace is the source capture surface.
- eBay Browse API is the comparison source.
- A small backend proxy stores the eBay client secret and mints application tokens server-side.
- The extension stores the backend URL and an optional proxy access key in Options instead of an eBay token.

## Features

### Facebook Marketplace capture
- Capture the active Facebook Marketplace listing with title, description, price, condition, seller, and location when available
- Preserve partial captures with notes so missing fields can be completed manually in the popup
- Flag placeholder prices like `Free` or `$1` and detect offer language from the listing text
- Prefer listing-scoped Facebook signals before broad page fallbacks for cleaner source extraction

### Smarter eBay search planning
- Require both title and description before searching
- Build normalized query variants that preserve brand and likely model identifiers
- Search the eBay Browse API from the background worker with a fixed-price-first strategy by default
- Enrich stronger matches with follow-up item detail requests for better comparison signals

### Ranking, filtering, and comparison
- Rank results with effective price, shipping, tax, seller standing, and match-confidence signals
- Compare source and result condition, location, offer language, and price bands
- Detect likely variant mismatches and downgrade clearly worse or suspicious matches
- Hide auction-only results by default, with popup filters for auctions, worse-condition items, and likely mismatches

### State and privacy
- Clear stale eBay results when the source listing or draft changes
- Persist settings, filters, drafts, source listing state, and consent-gated history in extension storage
- Keep the eBay client secret server-side, with the extension storing only the backend proxy URL plus any user-provided proxy access key in Options

## Runtime flow
1. Start the local or hosted backend proxy with your eBay client credentials and optional proxy access key.
2. Open a Facebook Marketplace listing in Firefox.
3. Open the extension popup.
4. Click `Capture Facebook Listing`.
5. Review the captured source summary and complete any missing title or description fields.
6. Configure the backend proxy URL in Options if needed, plus a proxy access key if your server requires one.
7. Click `Search eBay Matches`.
8. Review ranked matches in the popup.
9. If the source listing changes, re-run the search for fresh matches.

## Firefox setup
There is no established install/build pipeline in this repo yet. Start the proxy, then load the extension as a temporary Firefox add-on:

1. Copy `server/.env.example` to `server/.env` and add your eBay client ID + secret.
2. Run `node server/index.js`.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click `Load Temporary Add-on...`.
5. Select `manifest.json` from this repository.
6. Open the extension Options page and enter your backend URL, for example `http://localhost:8787`.
7. If you set `PROXY_ACCESS_KEY` on the server, enter the same value in Options.
8. Accept the Firefox host-permission prompt for that backend origin.

## Important constraints
- The extension should never contain the eBay client secret.
- The backend proxy mints eBay application tokens and calls Browse API endpoints.
- The included proxy binds to `127.0.0.1` by default.
- Non-local proxy bindings require `PROXY_ACCESS_KEY`, and non-local proxy URLs should use HTTPS.
- The included proxy now applies a required extension header, optional access-key auth, reflected extension-only CORS, and basic per-IP rate limiting.
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
  background.js          eBay proxy search and enrichment flow
  content.js             page-side capture bridge
  popup.js               popup actions, validation, and rendering
  options.js             saved proxy URL and defaults
  lib/                   normalize, filters, ranking, history, state
server/
  index.js               minimal Node proxy for eBay token minting + Browse API calls
docs/
  IMPLEMENTATION_PLAN.md
manifest.json            Firefox extension manifest
```

## Current focus
- Replace the current shared-key proxy gate with stronger multi-user auth before broad distribution
- Add deployment-ready proxy configuration and operational safeguards for non-local hosting
- Improve Facebook Marketplace extraction quality across more DOM variants
- Improve eBay result quality, seller heuristics, and landed-cost filtering
- Continue Firefox-targeted validation and polish

## Developer todo
- Add stronger proxy auth for deployed multi-user use instead of the current shared access key
- Add deployment/config guidance for remote proxy hosting, secrets management, and ops defaults
- Add repeatable fixture-based tests for Facebook capture, normalization, ranking, and popup filtering behavior
- Validate more Facebook Marketplace DOM variants across public, login-gated, and mobile-ish layouts
- Improve distance, seller-quality, tax, and shipping heuristics beyond the current defaults
- Add Firefox-targeted validation and release-readiness checks
- Decide whether inactive adapter scaffolds should be removed or fully implemented
