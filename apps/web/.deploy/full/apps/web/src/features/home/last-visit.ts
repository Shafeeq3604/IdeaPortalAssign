import * as React from "react";

/**
 * "Since you were last here" (P20 — SPEC §14 M4) needs one fact the server does not keep:
 * when this person last opened Home. It lives in the browser, per device — a convenience,
 * never a record anyone else reads. If storage is blocked (a private window, a locked-down
 * profile) the page simply treats every visit as the first.
 *
 * Two stores, so a reload does not wipe the answer: the previous visit is copied into
 * sessionStorage once per tab session (the baseline this tab keeps showing), and
 * localStorage is moved on to "now" for the next session.
 */

const LAST = (userId: string) => `iep-home-last-visit:${userId}`;
const BASELINE = (userId: string) => `iep-home-baseline:${userId}`;

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Storage refused — the page still works, it just cannot remember.
  }
}

/** The previous visit's time, or null for a first visit (or unknowable storage). */
export function useLastVisit(userId: string | undefined): Date | null {
  const [baseline] = React.useState<string | null>(() => {
    if (!userId || typeof window === "undefined") return null;
    const session = window.sessionStorage;
    const kept = read(session, BASELINE(userId));
    if (kept !== null) return kept || null;
    const previous = read(window.localStorage, LAST(userId));
    // An empty string marks "first visit" for the rest of this tab session.
    write(session, BASELINE(userId), previous ?? "");
    write(window.localStorage, LAST(userId), new Date().toISOString());
    return previous;
  });
  if (!baseline) return null;
  const at = new Date(baseline);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "3 hours ago" / "yesterday" / "on 12 Sept" — for a sentence, not a timestamp column. */
export function describeSince(at: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 2) return "a moment ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
