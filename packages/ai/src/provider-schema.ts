import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/**
 * Convert a Zod schema into the JSON Schema subset the structured-outputs API accepts.
 *
 * The provider schema is a GENERATION GUIDE, not the authority. Our Zod schema is the
 * authority: everything stripped here is still enforced when the response is parsed
 * (see validate.ts), so nothing is actually relaxed — the constraint just moves from
 * "the model was told" to "the output was checked".
 *
 * Every rule below was discovered by probing the live API, not assumed:
 *
 *  - `$ref` into `properties` is rejected. zod-to-json-schema dedupes identical
 *    sub-schemas that way by default, which invalidated every schema we sent.
 *  - `maxItems` is not supported at all.
 *  - `minItems` accepts only 0 or 1.
 *  - `minLength` / `maxLength` on strings are likewise unsupported.
 */

type JsonSchema = Record<string, unknown>;

const UNSUPPORTED_KEYWORDS = [
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "$schema",
  "default",
] as const;

function sanitise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitise);
  if (!node || typeof node !== "object") return node;

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node as JsonSchema)) {
    if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) continue;

    if (key === "minItems") {
      // Only 0 or 1 are accepted. "At least one" is the meaningful signal to the model;
      // the real lower bound is re-checked by the Zod parse.
      const n = typeof value === "number" ? value : 0;
      out[key] = n >= 1 ? 1 : 0;
      continue;
    }

    out[key] = sanitise(value);
  }
  return out;
}

/**
 * Some steps require an exact array length (all nine value dimensions, all five timeline
 * phases). `minItems`/`maxItems` cannot express that here, so the requirement is carried
 * in the prompt and enforced by the Zod parse. This records that it is deliberate.
 */
export function toProviderSchema<S extends z.ZodTypeAny>(schema: S): JsonSchema {
  const generated = zodToJsonSchema(schema, {
    target: "openApi3",
    // Inline every repeated sub-schema. The default emits `$ref: "#/properties/x"`,
    // which the API rejects outright.
    $refStrategy: "none",
  });
  return sanitise(generated) as JsonSchema;
}
