# Implementation Plan

## Scope
Build a Firefox-first, frontend-only browser extension that captures a Facebook Marketplace listing and compares it against eBay Browse API matches using a required `title + description` query.

## Core Constraint
- No backend service.
- The extension does not mint eBay OAuth tokens internally because the documented Browse API application-token flow requires a client secret.
- Instead, the user pastes a previously generated eBay application token into Options.

## Phase 1: Facebook Source Capture
- Detect Facebook Marketplace from hostname.
- Extract from the listing page with DOM/meta heuristics:
  title
  description
  listing price
  description money hints
  condition
  seller name
  location
- Flag placeholder Facebook prices like `free`, `$1`, and `1$`.
- Flag `best offer` / `offer` in title or description.

## Phase 2: Query Construction
- Require both title and description.
- Build a normalized query from:
  brand
  title
  description
- Preserve likely product identifiers while removing spacing noise.

## Phase 3: eBay Browse API Search
- Use `GET /buy/browse/v1/item_summary/search`.
- Required headers:
  `Authorization: Bearer <application token>`
  `X-EBAY-C-MARKETPLACE-ID`
  `Accept: application/json`
- Optional shipping context header:
  `X-EBAY-C-ENDUSERCTX`
- Store token/config in extension Options only.

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
- Show compact popup cards with:
  title
  landed cost
  price + shipping + tax clues
  seller signal
  location
  match reason / flags

## Phase 6: Persistence And Privacy
- Persist:
  draft source listing fields
  filters
  source listing snapshot
  eBay settings/token
  recent history
- Prompt once before enabling history logging.

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
    ebayApplicationToken: '',
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
- Frontend-only limitation: application-token minting requires a client secret, so token generation must stay outside the extension.

## Suggested Build Order
1. Facebook listing extractor tuning
2. eBay Browse API search + mapping
3. popup comparison cards and ranking cues
4. better distance / seller filtering polish
5. optional item-detail enrichment via `getItem`
