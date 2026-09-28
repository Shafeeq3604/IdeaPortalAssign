import { describe, expect, it } from "vitest";
import type { IdeaSummary } from "@iep/contracts";
import { swipeDeck } from "./swipe-deck";

function idea(overrides: Partial<IdeaSummary>): IdeaSummary {
  return {
    id: "idea",
    title: "An idea",
    status: "RANKED",
    maturityLevel: 3,
    submitter: { id: "someone-else", displayName: "Someone Else", departmentName: null },
    department: null,
    category: null,
    currentVersionNo: 1,
    submittedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    rank: 1,
    compositeScore: 70,
    feedback: { up: 0, down: 0, myVote: null },
    commentCount: 0,
    ...overrides,
  };
}

describe("swipeDeck (P20 weigh in)", () => {
  it("keeps ranked-onward ideas by other people that you have not voted on", () => {
    const deck = swipeDeck(
      [
        idea({ id: "keep-ranked" }),
        idea({ id: "keep-pilot", status: "PILOT" }),
        idea({ id: "mine", submitter: { id: "me", displayName: "Me", departmentName: null } }),
        idea({ id: "voted", feedback: { up: 1, down: 0, myVote: "UP" } }),
        idea({ id: "draft", status: "DRAFT" }),
        idea({ id: "rejected", status: "REJECTED" }),
        idea({ id: "evaluated", status: "EVALUATED" }),
      ],
      "me",
    );
    expect(deck.map((i) => i.id)).toEqual(["keep-ranked", "keep-pilot"]);
  });
});
