import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { EMPTY_IDEA_CREATION_DRAFT } from "@iep/contracts";
import { AnthropicIdeaCreationProvider } from "./idea-creation.js";
import { IDEA_CREATION_ROUTE, type ModelRoute } from "./routing/routes.js";

/**
 * P9: the chat's model settings come from its `ai_model_routes` row, not a literal in
 * idea-creation.ts. These pin the request the provider actually sends.
 */
function fakeClient() {
  const sent: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        sent.push(params);
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ aiMessage: "Who does this today?" }) }],
          usage: { input_tokens: 100, output_tokens: 20 },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const input = { history: [], currentDraft: EMPTY_IDEA_CREATION_DRAFT };

describe("AnthropicIdeaCreationProvider — model settings from the route table", () => {
  it("defaults to the seeded route: Sonnet, adaptive thinking, low effort, the strict schema kept", async () => {
    const { client, sent } = fakeClient();
    const result = await new AnthropicIdeaCreationProvider({ apiKey: "x", client }).turn(input);

    expect(result.ok).toBe(true);
    const req = sent[0] ?? {};
    expect(req["model"]).toBe(IDEA_CREATION_ROUTE.modelId);
    expect(req["max_tokens"]).toBe(IDEA_CREATION_ROUTE.maxTokens);
    expect(req["thinking"]).toEqual({ type: "adaptive" });
    const output = req["output_config"] as { effort?: string; format?: { type?: string } };
    expect(output.effort).toBe("low");
    expect(output.format?.type).toBe("json_schema");
  });

  it("uses whatever route the table supplies — a model change is a row edit, not a deploy", async () => {
    const { client, sent } = fakeClient();
    const haiku: ModelRoute = {
      ...IDEA_CREATION_ROUTE, tier: "C", modelId: "route-from-table", effort: null,
      thinkingMode: "NONE", maxTokens: 2_000,
    };
    const result = await new AnthropicIdeaCreationProvider({ apiKey: "x", client }).turn({ ...input, route: haiku });

    expect(result.ok && result.model).toBe("route-from-table");
    const req = sent[0] ?? {};
    expect(req["thinking"]).toBeUndefined();
    expect((req["output_config"] as { effort?: string }).effort).toBeUndefined();
    expect(req["max_tokens"]).toBe(2_000);
  });
});
