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
| 2026-08-27 | Design tokens | `--dur-pulse: 1800ms`, plus the `defer` and `pending-pulse` keyframes from SPEC §8.3 | additive | packages/ui. The durations were specified in §8.3 but never declared; two components would otherwise each have invented their own. |
| 2026-08-27 | Custom components | `Stepper`, `Provenance`, `StatusPill`, `EvidenceList` implemented against their P0-frozen signatures | additive | packages/ui, apps/web. No prop added, removed or widened. |
| 2026-08-27 | **OPEN — not amended** | P3 names SSE progress (SPEC §14), but no stream endpoint exists in the frozen `ENDPOINTS` list | **requested** | Not taken. The stepper polls `GET /ideas/{id}/analysis/status` every 2s, which meets §9.3's "within 2s of the job event" using only frozen contracts. Adding `GET /ideas/{id}/analysis/stream` is additive and can be done later without changing the UI's data shape — `AnalysisProgressEvent` and `AcceptedResponse.streamUrl` are already in the contract, unused. |
| 2026-08-27 | `navigation.map.ts` | `matchRouteId(pathname)` — which route a concrete URL belongs to | additive | apps/web. Needed once the placeholder fallback was removed: the catch-all has to tell "this URL is a typo" from "this URL is a real page your role cannot see". |
| 2026-08-28 | `AuthProvider`, `User`, `ENDPOINTS` | Password sign-in: `PasswordAuthProvider`, password columns, and `login` / `createUser` / `updateUser` / `get`+`setIdeaFeedback` endpoints | additive | See ADR-023. `login` is the second public endpoint, allow-listed by name in the contract test. |
| 2026-08-28 | `ENDPOINTS`, `navigation.map.ts`, `AnalysisStep`, AI schemas | **Improvement feature REMOVED.** `listRecommendations`, the `idea.improve` route, §6.2 rows 28–30, the `IMPROVEMENT` analysis step, its prompt, schema, fallback and model route | **removal** | Withdrawn by the product owner: the platform is for posting ideas and reacting to them, not for critiquing them. FR-15 is no longer implemented and requirements.md should say so. §6.2 row numbers 28–30 stay retired rather than renumbered — they are references into the SPEC document. |
