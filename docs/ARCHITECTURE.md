# Architecture Notes

## Goal
Keep Facebook source scraping, eBay API calls, ranking, persistence, and popup presentation separate so the extension stays frontend-only and maintainable.

## Intended Layers
- `src/content.js`: browser/page boundary for Facebook source capture
- `src/adapters/*.js`: Facebook listing extraction logic
- `src/lib/ebay-api.js`: eBay Browse API search and response mapping
- `src/lib/normalize.js`: query shaping, price hints, offer detection
- `src/lib/filters.js`: hard-rule filtering and cost math
- `src/lib/ranking.js`: ranking-oriented transformations and boost logic
- `src/lib/history.js`: consent-gated history entry formatting
- `src/popup.*`: operator-facing manual controls and status views
- `src/options.*`: eBay token/config and comparison defaults

## Why This Split
- Facebook selectors will churn; adapter files isolate that volatility.
- Ranking rules and hard filters will evolve independently.
- History/consent behavior should stay isolated from scraping logic.
- eBay API fetch logic should stay out of the popup so token/config handling and request mapping remain centralized.

## Current Runtime Wiring
- `manifest.json` injects the Facebook adapter and `src/content.js` only on Facebook pages.
- `src/content.js` captures the Facebook source listing through the registered adapter.
- `src/background.js` owns eBay Browse API calls and uses `src/lib/ebay-api.js` plus stored Options settings.
- `src/popup.html` loads shared normalize/filter/history/ranking/state helpers before `src/popup.js`.
- The extension is frontend-only; eBay application tokens are supplied via Options rather than minted inside the extension.
