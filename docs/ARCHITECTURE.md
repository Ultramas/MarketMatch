# Architecture Notes

## Goal
Keep Facebook source scraping, proxy-backed eBay API calls, ranking, persistence, and popup presentation separate so the extension stays maintainable while secrets remain server-side.

## Intended Layers
- `src/content.js`: browser/page boundary for Facebook source capture
- `src/adapters/*.js`: Facebook listing extraction logic
- `src/lib/ebay-api.js`: extension-side proxy client plus eBay Browse response mapping
- `src/lib/normalize.js`: query shaping, price hints, offer detection
- `src/lib/filters.js`: hard-rule filtering and cost math
- `src/lib/ranking.js`: ranking-oriented transformations and boost logic
- `src/lib/history.js`: consent-gated history entry formatting
- `src/popup.*`: operator-facing manual controls and status views
- `src/options.*`: proxy URL/access-key config and comparison defaults
- `server/index.js`: server-side token minting, caching, auth/rate limiting, and eBay Browse proxying

## Why This Split
- Facebook selectors will churn; adapter files isolate that volatility.
- Ranking rules and hard filters will evolve independently.
- History/consent behavior should stay isolated from scraping logic.
- Proxy/eBay fetch logic should stay out of the popup so request mapping remains centralized in the background and client secrets stay on the server.

## Current Runtime Wiring
- `manifest.json` injects the Facebook adapter and `src/content.js` only on Facebook pages.
- `src/content.js` captures the Facebook source listing through the registered adapter.
- `src/background.js` owns local query planning and proxy-backed eBay fetches using `src/lib/ebay-api.js` plus stored Options settings.
- `src/background.js` also enriches the top eBay search results with proxy-backed `getItem` calls before sending them back to the popup.
- `server/index.js` stores the eBay client secret, optionally validates a proxy access key, rate limits clients, mints/caches the application token, and forwards Browse API requests.
- `src/popup.html` loads shared normalize/filter/history/ranking/state helpers before `src/popup.js`.
- The extension stores the proxy URL plus any user-provided proxy access key; the eBay client secret and application token stay on the backend proxy.
