# Architecture Notes

## Goal
Keep scraping concerns, normalization, ranking, persistence, and UI separate so real marketplace logic can be added incrementally.

## Intended Layers
- `src/content.js`: browser/page boundary for capture and result collection
- `src/adapters/*.js`: per-platform extraction + search-url behavior
- `src/lib/normalize.js`: query shaping, price hints, offer detection
- `src/lib/filters.js`: hard-rule filtering and cost math
- `src/lib/ranking.js`: ranking-oriented transformations and boost logic
- `src/lib/history.js`: consent-gated history entry formatting
- `src/lib/coupons.js`: optional coupon-provider planning and later adapters
- `src/popup.*`: operator-facing manual controls and status views
- `src/options.*`: durable defaults and tax/rating preferences

## Why This Split
- Marketplace selectors will churn; adapter files isolate that volatility.
- Ranking rules and hard filters will evolve independently.
- Coupon search is optional and should remain detachable.
- History/consent behavior should stay isolated from scraping logic.

## Current Runtime Wiring
- `manifest.json` loads `src/adapters/registry.js`, then each platform adapter, then `src/content.js` for supported marketplace pages.
- `src/content.js` now dispatches capture/result collection through the registered adapter for the active hostname.
- `src/background.js` now loads the same adapter/state scripts so search-target building and default state come from shared runtime layers.
- `src/popup.html` now loads shared normalize/filter/history/ranking helpers before `src/popup.js` so the popup uses the same query and ranking logic.
- Adapters still return placeholder payloads, but the runtime shape now matches the documented layering.
