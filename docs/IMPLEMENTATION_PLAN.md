# Implementation Plan

## Scope
Build a Firefox-first browser extension plus a minimal backend proxy that captures a Facebook Marketplace listing and compares it against eBay Browse API matches using a required `title + description` query.

## Current Runtime Status
- Facebook Marketplace capture is implemented in `src/adapters/facebook.js` and triggered by `src/content.js`.
- The popup already supports manual drafting, consent, filter persistence, saved source listing state, and ranked match rendering.
- The background worker now performs query planning locally and calls backend proxy endpoints for Browse `item_summary/search` plus top-match `getItem` enrichment.
- Shared normalize/filter/ranking/history/state helpers are already loaded by the popup runtime.
- Current work is focused on extraction quality, result quality, proxy hardening, and Firefox-oriented validation rather than first-time scaffolding.

## Core Constraint
- A minimal backend proxy is required to keep the eBay client secret private.
- The backend mints eBay application tokens internally because the documented Browse API application-token flow requires a client secret.
- The extension stores the proxy base URL plus any user-provided proxy access key in Options.

## Phase 1: Facebook Source Capture
- Detect Facebook Marketplace from hostname.
- Extract from the listing page with metadata, scoped Marketplace heuristics, and conservative text fallback:
  title
  description
  listing price
  description money hints
  condition
  seller name
  location
- Flag placeholder Facebook prices like `free`, `$1`, and `1$`.
- Flag `best offer` / `offer` in title or description.
- Record capture notes when title, description, price, seller, or location cannot be determined automatically.
- Keep the output contract stable so popup validation, ranking, and history logging continue to work.

## Phase 2: Query Construction
- Require both title and description.
- Build a normalized query from:
  brand
  title
  description
- Preserve likely product identifiers while removing spacing noise.

## Phase 3: eBay Browse API Search
- Extension background calls backend proxy routes such as `/api/ebay/search` and `/api/ebay/item/{item_id}`.
- Backend proxy mints and caches an eBay application token with the server-side client secret.
- Extension requests send a required extension header plus an optional proxy access key header.
- Backend proxy sends required eBay headers:
  `Authorization: Bearer <application token>`
  `X-EBAY-C-MARKETPLACE-ID`
  `Accept: application/json`
- Backend proxy optionally adds shipping context via `X-EBAY-C-ENDUSERCTX`.
- Backend proxy reflects only allowed extension origins for browser CORS and applies basic per-IP rate limiting.
- Store proxy URL/config in extension Options only.
- Enrich the strongest returned matches with `GET /buy/browse/v1/item/{item_id}` for better shipping, condition, and seller signals.

## Phase 4: Result Mapping
- Map eBay API fields into a common result shape:
  title
  item URL
  listed price
  shipping
  condition
  seller username
  seller feedback percentage / score
  location
  buying options
- Treat `BEST_OFFER` as an offer signal.

## Phase 5: Ranking And Presentation
- Compute:
  effective price
  taxes
  shipping
  total landed cost
  seller-standing boost
- lightweight match confidence
- Show compact popup cards with:
  title
  landed cost
  price + shipping + tax clues
  seller signal
  location
  match reason / flags
- matched-token hints
- direct listing/search actions

## Phase 6: Persistence And Privacy
- Persist:
  draft source listing fields
  filters
  source listing snapshot
  eBay settings/proxy URL/access key
  recent history
- Prompt once before enabling history logging.
- Do not log history until consent is granted.

## Data Model
```js
{
  sourceListing: {
    platform: 'facebook',
    title: '',
    description: '',
    listedPrice: 0,
    descriptionPriceHint: null,
    condition: '',
    sellerName: '',
    locationText: '',
    placeholderPriceFlag: false,
    bestOfferDetected: false,
    url: ''
  },
  settings: {
    ebayProxyBaseUrl: '',
    proxyAccessKey: '',
    ebayMarketplaceId: 'EBAY_US',
    endUserZip: '',
    ebayLimit: 10,
    defaultTaxRate: 0,
    defaultState: ''
  },
  results: [
    {
      platform: 'ebay',
      id: '',
      title: '',
      url: '',
      listedPrice: 0,
      shipping: 0,
      taxes: 0,
      totalCost: 0,
      condition: '',
      sellerName: '',
      sellerStanding: '',
      positiveRatings: 0,
      buyingOptions: [],
      locationText: '',
      bestOfferDetected: false,
      matchReason: ''
    }
  ]
}
```

## Verified API Direction
- Recommended eBay API: Browse API.
- Primary endpoint: `item_summary/search`.
- Secret-handling limitation: application-token minting requires a client secret, so token generation must stay on the backend proxy.

## Current Known Gaps
- Facebook Marketplace DOM variants still require ongoing selector maintenance.
- Public Marketplace pages and login-gated pages expose different DOM shapes and overlays.
- Seller-threshold logic is only partially meaningful until richer negative/quality signals are available from eBay mappings.
- Tax handling is still mostly default-rate/state-text based rather than a fuller jurisdiction model.
- The current shared-key proxy gate is still only a bounded hardening step; stronger multi-user auth is still needed before public rollout.
- Extra adapters/stubs (`src/adapters/ebay.js`, `src/adapters/craigslist.js`) remain inactive scaffolds and are not part of the active Facebook -> eBay runtime path.

## Suggested Build Order
1. Facebook listing extractor tuning against more live Marketplace variants
2. Stronger backend proxy auth and deployment setup beyond the current shared-key gate
3. eBay Browse API request/filter expansion and result-quality improvements
4. Better distance / seller filtering polish
5. Firefox-targeted testing and manifest validation
