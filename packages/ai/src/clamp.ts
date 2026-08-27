import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/**
 * Bring output inside the schema's cosmetic bounds before validating.
 *
 * The structured-outputs API does not accept `maxLength` or `maxItems`, so the model is
 * never told them (see provider-schema.ts). Our Zod schema still enforces them — which
 * meant a complete, accurate analysis was thrown away because one finding ran to 420
 * characters instead of 400. That is a terrible trade.
 *
 * So: bounds that exist to keep the UI tidy are CLAMPED, not enforced by rejection.
 * Bounds that carry meaning — a mandatory mitigation, a required citation, nine value
 * dimensions — are untouched here and still rejected by the Zod parse. The distinction
 * is length versus substance.
 */

type JsonSchema = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function clampNode(schema: JsonSchema | undefined, value: unknown): unknown {
  if (!schema) return value;

  if (typeof value === "string") {
    const max = num(schema["maxLength"]);
    if (max !== null && value.length > max) {
      // Trim on a word boundary where possible; an ellipsis marks that it was cut.
      const cut = value.slice(0, max - 1);
      const boundary = cut.lastIndexOf(" ");
      return `${boundary > max * 0.6 ? cut.slice(0, boundary) : cut}…`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const items = schema["items"] as JsonSchema | undefined;
    const max = num(schema["maxItems"]);
    // Keep the FIRST n: models put their strongest items first, so truncating the tail
    // loses less than truncating the head.
    const trimmed = max !== null && value.length > max ? value.slice(0, max) : value;
    return trimmed.map((entry) => clampNode(items, entry));
  }

  if (value && typeof value === "object") {
    const properties = schema["properties"] as Record<string, JsonSchema> | undefined;
    if (!properties) return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = clampNode(properties[key], v);
    }
    return out;
  }

  return value;
}

/**
 * Clamp `data` to the length bounds declared by `schema`.
 *
 * Uses the FULL generated schema — the one that still carries maxLength/maxItems —
 * not the sanitised copy sent to the provider.
 */
export function clampToSchema<S extends z.ZodTypeAny>(schema: S, data: unknown): unknown {
  const full = zodToJsonSchema(schema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as JsonSchema;
  return clampNode(full, data);
}
