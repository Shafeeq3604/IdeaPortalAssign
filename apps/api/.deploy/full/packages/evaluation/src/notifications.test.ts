import { describe, expect, it } from "vitest";
import { notificationHref, parseNotificationPayload, renderEmail, renderNotification } from "./notifications.js";

describe("P13 notification rendering", () => {
  it("words each event from its stored facts", () => {
    expect(
      renderNotification({ event: "STATUS_CHANGED", ideaTitle: "Rooms", from: "EVALUATED", to: "UNDER_REVIEW", actorName: "Rae" }),
    ).toEqual({ title: "Your idea is now Under review", body: "Rae moved “Rooms” from Evaluated to Under review." });
    expect(renderNotification({ event: "ANALYSIS_COMPLETED", ideaTitle: "Rooms", outcome: "NEEDS_CLARIFICATION" }).title)
      .toBe("Your idea needs more detail");
  });

  it("links analysis results to the Evaluation tab and everything else to the Overview", () => {
    expect(notificationHref("ANALYSIS_COMPLETED", "abc")).toBe("/ideas/abc/evaluation");
    expect(notificationHref("REVIEW_RECORDED", "abc")).toBe("/ideas/abc/overview");
    expect(notificationHref("REVIEW_RECORDED", null)).toBe("/notifications");
  });

  it("keeps a user-written title out of the email subject, and builds absolute links", () => {
    const email = renderEmail(
      { event: "REVIEW_RECORDED", ideaTitle: "Evil\r\nBcc: x@y.z", decision: "VALIDATED", actorName: "Rae" },
      "/ideas/abc/overview",
      "https://iep.example.invalid",
    );
    expect(email.subject).toBe("Your idea was reviewed");
    expect(email.text).toContain("https://iep.example.invalid/ideas/abc/overview");
    expect(email.text).toContain("https://iep.example.invalid/notifications");
  });

  it("drops a stored row it cannot read instead of throwing", () => {
    expect(parseNotificationPayload("SOMETHING_NEW", {})).toBeNull();
    expect(parseNotificationPayload("REVIEW_RECORDED", { event: "REVIEW_RECORDED" })).toBeNull();
    // Event column and payload disagree → unreadable, not silently re-labelled.
    expect(
      parseNotificationPayload("STATUS_CHANGED", { event: "ANALYSIS_COMPLETED", ideaTitle: "x", outcome: "EVALUATED" }),
    ).toBeNull();
  });
});
