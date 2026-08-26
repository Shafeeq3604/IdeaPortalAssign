# Contract amendment log

Every additive change to a P0-frozen contract gets one line here (SPEC §14.1).
Breaking changes do not appear here — they require a superseding ADR.

| Date | Contract | Change | Kind | Consumers updated |
|---|---|---|---|---|
| 2026-08-26 | — | **P0 baseline frozen**, `@iep/contracts@1.0.0` | baseline | — |
| 2026-08-26 | `ApiEnv` | `ANTHROPIC_API_KEY` relaxed from "must be undefined" to "must be empty or absent" | additive | apps/api. The guard still rejects a real key; a single shared dev `.env` now works. |
| 2026-08-26 | `@iep/contracts` exports | `env.ts` removed from the root barrel; now a separate `@iep/contracts/env` entry point | **corrective** | apps/api. Server-only session/OIDC secret schemas were reachable from the browser bundle. Verified absent from the built client. |
| 2026-08-26 | `@iep/ui` exports | Added `./theme.css` and `./tokens.css` subpath exports | additive | apps/web |
| 2026-08-26 | Custom components | `EmptyState` / `ErrorState` pulled forward from P1 and implemented | additive | Both now *require* a way out in their props, so SPEC §6.3 assertion 3 fails at compile time rather than in review. |
