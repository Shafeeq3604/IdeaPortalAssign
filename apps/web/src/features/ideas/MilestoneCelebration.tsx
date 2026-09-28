import * as React from "react";
import { toast } from "sonner";
import type { IdeaDetail, IdeaStatus } from "@iep/contracts";
import { celebrate } from "../../app/motion";
import { STATUS_LABEL } from "./api";

/**
 * P20 celebrations (SPEC §14 M4 — pulled forward from P19's "milestone moments"): the
 * first time the OWNER opens their idea after it reaches one of the delivery stages, a
 * short burst and one line saying so. Once per idea per stage, per browser — remembered
 * locally, since it is a courtesy, not a record. No badge, count or score comes with it.
 */

const MILESTONES: ReadonlySet<IdeaStatus> = new Set(["PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED"]);

const MESSAGE: Partial<Record<IdeaStatus, string>> = {
  PILOT: "Your idea is being piloted.",
  PRODUCTION_CANDIDATE: "Your idea is heading for production.",
  IMPLEMENTED: "Your idea has been implemented.",
};

export function MilestoneCelebration({ idea, isOwner }: { idea: IdeaDetail; isOwner: boolean }) {
  React.useEffect(() => {
    if (!isOwner || !MILESTONES.has(idea.status)) return;
    const key = `iep-celebrated:${idea.id}:${idea.status}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, new Date().toISOString());
    } catch {
      return; // Cannot remember it, so do not risk repeating it on every visit.
    }
    celebrate();
    toast.success(MESSAGE[idea.status] ?? `Your idea reached ${STATUS_LABEL[idea.status]}.`, {
      description: "Thank you for putting it forward.",
    });
  }, [idea.id, idea.status, isOwner]);
  return null;
}
