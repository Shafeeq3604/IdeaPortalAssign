/**
 * Embedding provider (P12, AI-10/AI-11 — FR-20/FR-21) — deliberately separate from
 * `provider.ts` / `AiProvider`, same reasoning as `discovery.ts`'s standalone pair.
 *
 * Anthropic has no embeddings endpoint, so this cannot reuse `AiProvider.complete`'s
 * Anthropic client at all — it is a genuinely different vendor call, chosen because
 * OpenAI's `text-embedding-3-small` outputs natively at 1536 dimensions, matching the
 * `vector(1536)` column ADR-012 reserved at P0 with no dimension-reduction config needed.
 *
 * Runs in the WORKER process only, same as every other provider key (SPEC §4.4).
 */

export interface EmbeddingUsage {
  readonly tokens: number;
  readonly costUsd: number;
}

export type EmbeddingResult =
  | { readonly ok: true; readonly vector: readonly number[]; readonly usage: EmbeddingUsage }
  | { readonly ok: false; readonly errorCode: "UNAVAILABLE" | "TIMEOUT" | "NO_KEY" };

export interface EmbeddingProvider {
  readonly name: "openai" | "stub";
  embed(text: string): Promise<EmbeddingResult>;
}

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_DIMENSIONS = 1536;
/** $0.02 / 1M tokens, per OpenAI's published rate for this model. */
const OPENAI_EMBEDDING_RATE_PER_MILLION = 0.02;

export interface OpenAiEmbeddingProviderOptions {
  readonly apiKey: string;
  /** Injected for tests; defaults to a real `fetch` against api.openai.com. */
  readonly fetchImpl?: typeof fetch;
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai" as const;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiEmbeddingProviderOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          dimensions: OPENAI_EMBEDDING_DIMENSIONS,
          // Untrusted employee text (SPEC §4.6) — sent as plain input, same as every
          // other provider call; embeddings have no instruction-following surface to
          // inject into, so no delimiting is needed here the way `complete<T>` needs it.
          input: text,
        }),
      });

      if (!response.ok) {
        console.error(`[embeddings] OpenAI call failed: ${response.status} ${response.statusText}`);
        return { ok: false, errorCode: "UNAVAILABLE" };
      }

      const body = (await response.json()) as {
        data?: ReadonlyArray<{ embedding: readonly number[] }>;
        usage?: { total_tokens: number };
      };
      const vector = body.data?.[0]?.embedding;
      if (!vector || vector.length !== OPENAI_EMBEDDING_DIMENSIONS) {
        console.error(`[embeddings] unexpected OpenAI response shape (length=${vector?.length ?? "n/a"})`);
        return { ok: false, errorCode: "UNAVAILABLE" };
      }

      const tokens = body.usage?.total_tokens ?? Math.ceil(text.length / 4);
      return {
        ok: true,
        vector,
        usage: { tokens, costUsd: (tokens / 1_000_000) * OPENAI_EMBEDDING_RATE_PER_MILLION },
      };
    } catch (error) {
      if (error instanceof Error && /timeout|aborted/i.test(error.message)) {
        return { ok: false, errorCode: "TIMEOUT" };
      }
      console.error("[embeddings] OpenAI call threw:", error instanceof Error ? error.message : error);
      return { ok: false, errorCode: "UNAVAILABLE" };
    }
  }
}

/**
 * StubEmbeddingProvider — deterministic, offline, free.
 *
 * A hash-seeded pseudo-random unit vector: identical input always produces an identical
 * vector, so idempotency and persistence are exercised for real, but this is scaffolding,
 * not a semantic model — it does not produce meaningful similarity between two DIFFERENT
 * texts. Tests that need a specific similarity between two stub vectors construct them
 * directly rather than relying on this provider's output to happen to be close.
 */
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly name = "stub" as const;

  embed(text: string): Promise<EmbeddingResult> {
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) {
      seed ^= text.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    seed = Math.abs(seed) || 1;

    const vector: number[] = [];
    let state = seed;
    for (let i = 0; i < OPENAI_EMBEDDING_DIMENSIONS; i++) {
      // A simple xorshift32 PRNG — fast, deterministic, no external dependency.
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      vector.push((state % 2000) / 1000 - 1); // in [-1, 1)
    }

    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return Promise.resolve({
      ok: true,
      vector: vector.map((v) => v / magnitude),
      usage: { tokens: Math.max(1, Math.round(text.length / 4)), costUsd: 0 },
    });
  }
}
