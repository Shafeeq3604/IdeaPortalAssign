/**
 * Declaration merging into Vite's own `ImportMetaEnv` (already global via
 * tsconfig.app.json's `types: ["vite/client"]`) — the one custom build-time env var
 * this app reads (ADR-025). Optional: unset is a supported, safe state (error-tracking.ts
 * treats it as "reporting off"), not a build-time requirement.
 */
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
}
