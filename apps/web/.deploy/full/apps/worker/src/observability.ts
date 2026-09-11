import type { WorkerEnv } from "@iep/contracts/env";

/**
 * iManner LLM observability — reports every real model call this worker makes so it is
 * attributed by agent, user and business record in the iManner dashboard.
 *
 * This app is Node/TypeScript, not Python, so there is no `observability_sdk` to install
 * (its own path is `packages/sdk-python`). This is the documented HTTP fallback: a plain
 * POST to the ingestion API's `/events/batch` compat endpoint, which accepts SDK-style
 * field names and computes cost server-side. No dependency, no `auto_patch` — every
 * Anthropic call site is instrumented explicitly, once each, at the one place in
 * apps/worker that has full attribution context (idea/submitter for the analysis
 * pipeline, discovery query/user for the Discovery Agent) — see pipeline.ts and
 * discovery.ts.
 *
 * Deliberately never sent: `org_id`/`project_id` (the API key carries those — sending our
 * own would make events land under a different project than the dashboard's default
 * view) and a static `agent_id`/`agent_name` (agent identity is resolved per call site so
 * each pipeline step and the Discovery Agent show up as distinct rows, not one).
 */

const EVENTS_PATH = "/events/batch";
const REQUEST_TIMEOUT_MS = 5_000;

export interface ObservabilityEvent {
  readonly agentId: string;
  readonly agentName: string;
  readonly userId?: string | null;
  readonly userName?: string | null;
  readonly sessionId?: string | null;
  readonly threadId?: string | null;
  readonly interactionType?: string | null;
  readonly businessTransactionType?: string | null;
  readonly businessTransactionId?: string | null;
  readonly businessTransactionName?: string | null;
  readonly provider: string;
  readonly modelId: string;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly latencyMs: number;
  /** The actual prompt sent — never omitted to keep an event small (Hard Rule 5). */
  readonly inputPayload: unknown;
  /** The actual completion received, or null on failure. */
  readonly outputPayload: unknown;
  readonly status: "success" | "error";
  readonly error?: string | null;
  readonly errorType?: string | null;
}

export interface ObservabilityClient {
  /** Fire-and-forget: never throws, never blocks the caller (Hard Rule 3). */
  record(event: ObservabilityEvent): void;
}

/** Exported for tests, scripts and load-test seeders that build `PipelineDeps` /
 * `DiscoveryDeps` directly without going through `makeObservabilityClient` — no test
 * should spend a real iManner event any more than it spends a real Anthropic token. */
export const NOOP_OBSERVABILITY_CLIENT: ObservabilityClient = { record: () => {} };
const NOOP_CLIENT = NOOP_OBSERVABILITY_CLIENT;

/**
 * Builds a real client when fully configured, else a no-op — the same
 * degrade-rather-than-crash shape `makeProvider()` already uses for the AI provider
 * itself (apps/worker/src/main.ts), so a missing/partial observability config can never
 * take the worker down.
 */
export function makeObservabilityClient(env: WorkerEnv): ObservabilityClient {
  if (!env.OBS_ENABLED) return NOOP_CLIENT;

  if (!env.OBS_API_ENDPOINT || !env.OBS_API_KEY || !env.OBS_APPLICATION_ID || !env.OBS_APPLICATION_NAME) {
    console.error(
      "[observability] OBS_ENABLED=true but OBS_API_ENDPOINT / OBS_API_KEY / " +
        "OBS_APPLICATION_ID / OBS_APPLICATION_NAME are not all set — iManner reporting " +
        "stays disabled until all four are configured.",
    );
    return NOOP_CLIENT;
  }

  const endpoint = `${env.OBS_API_ENDPOINT.replace(/\/+$/, "")}${EVENTS_PATH}`;
  const apiKey = env.OBS_API_KEY;
  const applicationId = env.OBS_APPLICATION_ID;
  const applicationName = env.OBS_APPLICATION_NAME;
  const environment = env.OBS_ENVIRONMENT;
  const samplingRate = env.OBS_SAMPLING_RATE;

  return {
    record(event) {
      try {
        // Sampling is applied here, not server-side — a dropped event never leaves this
        // process, so it costs nothing to skip.
        if (samplingRate < 1 && Math.random() >= samplingRate) return;

        const body = {
          events: [
            {
              event_id: crypto.randomUUID(),
              event_type: "generation",
              timestamp: new Date().toISOString(),

              application_id: applicationId,
              application_name: applicationName,
              environment,

              agent_id: event.agentId,
              agent_name: event.agentName,
              user_id: event.userId ?? null,
              user_name: event.userName ?? null,
              session_id: event.sessionId ?? null,
              thread_id: event.threadId ?? null,
              interaction_type: event.interactionType ?? null,

              business_transaction_type: event.businessTransactionType ?? null,
              business_transaction_id: event.businessTransactionId ?? null,
              business_transaction_name: event.businessTransactionName ?? null,

              provider: event.provider,
              model_id: event.modelId,
              input_tokens: event.inputTokens ?? null,
              output_tokens: event.outputTokens ?? null,
              latency_ms: event.latencyMs,

              input_payload: event.inputPayload,
              output_payload: event.outputPayload,

              status: event.status,
              ...(event.status === "error"
                ? { error: event.error ?? null, error_type: event.errorType ?? null }
                : {}),
            },
          ],
        };

        // Not awaited by the caller — an LLM call already succeeded or failed on its own
        // terms; reporting it must never add latency to the pipeline or the discovery job.
        void fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
          .then((res) => {
            if (!res.ok) {
              console.error(`[observability] iManner ingestion returned HTTP ${res.status}`);
            }
          })
          .catch((error: unknown) => {
            console.error(
              "[observability] failed to report event to iManner:",
              error instanceof Error ? error.message : error,
            );
          });
      } catch (error) {
        console.error(
          "[observability] unexpected error building event:",
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}
