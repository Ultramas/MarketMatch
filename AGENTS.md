# AGENTS.md

## Repo Shape
- Firefox-first, frontend-only extension.
- Current product direction is Facebook Marketplace source capture + eBay Browse API comparison.
- Facebook listing extraction is heuristic and lives in `src/adapters/facebook.js`.
- eBay token minting is intentionally out of scope for the extension; the user pastes an application token into Options.

## Commands
- No repo-standard install/test commands are established yet.
- Use the project README, `manifest.json`, and `docs/IMPLEMENTATION_PLAN.md` as the source of truth for runtime behavior.

## Notes
- Keep the implementation frontend-only; do not introduce backend/token-broker assumptions unless explicitly requested.
- Prefer changing the Facebook adapter, background eBay API flow, and popup presentation over adding new platform scaffolds.
