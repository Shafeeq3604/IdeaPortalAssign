import type { IdeaStatus } from "@iep/contracts";
import type { IdeaSort } from "./api";

/**
 * Smart filters (P20 — SPEC §14 M4, D-25): a plain question turned into the filters the
 * idea list already has. Pure text matching against names already known to the page —
 * no model, no request, no cost — and every piece it understood is shown back as a chip
 * before anything is applied, so a wrong guess is visible and removable.
 *
 * What it can NOT do is said out loud rather than faked: effort is not a list filter, so
 * "quick wins" produces a note, not an invented cut-off.
 */

export interface NamedRef {
  readonly id: string;
  readonly name: string;
}

export interface SmartFilterVocabulary {
  readonly departments: readonly NamedRef[];
  readonly categories: readonly NamedRef[];
}

export interface SmartFilter {
  readonly department?: NamedRef;
  readonly category?: NamedRef;
  readonly statuses: readonly IdeaStatus[];
  /** What the matched stage phrase was, for the chip ("in pilot"). */
  readonly stageLabel?: string;
  readonly sort?: IdeaSort;
  readonly sortLabel?: string;
  /** One word to search titles for — the list's search matches titles only. */
  readonly keyword?: string;
  /** The person asked about effort, which the list cannot filter by. */
  readonly asksAboutEffort: boolean;
}

const IMPLEMENTATION: readonly IdeaStatus[] = ["PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED"];

/** Longest phrases first, so "under review" wins over "review". */
const STAGES: readonly { phrases: readonly string[]; statuses: readonly IdeaStatus[]; label: string }[] = [
  { phrases: ["needs clarification", "need clarification", "unclear"], statuses: ["NEEDS_CLARIFICATION"], label: "Needs clarification" },
  { phrases: ["production candidate", "going to production", "production"], statuses: ["PRODUCTION_CANDIDATE"], label: "Production candidate" },
  { phrases: ["being built", "in progress", "in delivery", "moving forward", "implementation"], statuses: IMPLEMENTATION, label: "Moving toward being built" },
  { phrases: ["under review", "being reviewed", "awaiting review", "waiting for review", "in review"], statuses: ["UNDER_REVIEW"], label: "Under review" },
  { phrases: ["prototype", "prototypes", "prototyping"], statuses: ["PROTOTYPE_CANDIDATE"], label: "Prototype candidate" },
  { phrases: ["pilot", "pilots", "piloting", "trial", "trials"], statuses: ["PILOT"], label: "Pilot" },
  { phrases: ["implemented", "delivered", "shipped", "live", "done", "completed"], statuses: ["IMPLEMENTED"], label: "Implemented" },
  { phrases: ["parked", "on hold"], statuses: ["PARKED"], label: "Parked" },
  { phrases: ["blocked", "stuck"], statuses: ["BLOCKED"], label: "Blocked" },
  { phrases: ["rejected", "declined", "turned down"], statuses: ["REJECTED"], label: "Rejected" },
  { phrases: ["ranked", "scored"], statuses: ["RANKED"], label: "Ranked" },
];

const SORTS: readonly { phrases: readonly string[]; sort: IdeaSort; label: string }[] = [
  { phrases: ["highest scoring", "highest ranked", "best ranked", "top ranked", "top rated", "best", "top", "strongest", "leading", "highest"], sort: "rank", label: "Best ranked first" },
  { phrases: ["most recent", "newest", "latest", "recent", "new"], sort: "recent", label: "Newest first" },
  { phrases: ["oldest", "earliest"], sort: "oldest", label: "Oldest first" },
];

const EFFORT = ["quick wins", "quick win", "low effort", "low hanging", "easy", "cheap", "effort", "fast to build", "simple"];

/** Words that carry no search meaning on their own. */
const STOP = new Set([
  "a", "about", "all", "an", "and", "any", "are", "around", "at", "by", "can", "could", "do", "does",
  "find", "for", "from", "get", "give", "have", "help", "how", "i", "idea", "ideas", "in", "into",
  "is", "it", "list", "me", "more", "my", "of", "on", "or", "our", "please", "show", "so", "some",
  "that", "the", "their", "them", "there", "these", "this", "those", "to", "us", "we", "what", "which",
  "who", "with", "would", "you", "department", "team", "teams", "dept", "category", "things", "stuff",
  "cut", "reduce", "improve", "improving", "make", "making", "save", "saving", "better", "less", "lot",
  "quarter", "month", "year", "week", "next", "worth", "pursuing", "ten", "five", "three", "few",
]);

const normalise = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9&]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** Remove a phrase (as whole words) from the working text; true if it was there. */
function take(text: { value: string }, phrase: string): boolean {
  const needle = normalise(phrase);
  if (needle.trim() === "") return false;
  const at = text.value.indexOf(needle);
  if (at < 0) return false;
  text.value = `${text.value.slice(0, at)} ${text.value.slice(at + needle.length)}`.replace(/\s+/g, " ");
  text.value = ` ${text.value.trim()} `;
  return true;
}

/** A name matched as itself, and also without a trailing "department"/"team". */
function variants(name: string): string[] {
  const base = name.trim();
  const trimmed = base.replace(/\s+(department|dept|team)$/i, "");
  return [...new Set([base, trimmed].filter((v) => v.length >= 2))];
}

function matchRef(text: { value: string }, refs: readonly NamedRef[]): NamedRef | undefined {
  const ordered = [...refs].sort((a, b) => b.name.length - a.name.length);
  for (const ref of ordered) {
    for (const v of variants(ref.name)) {
      if (take(text, v)) return ref;
    }
  }
  return undefined;
}

export function parseSmartFilter(question: string, vocabulary: SmartFilterVocabulary): SmartFilter {
  const text = { value: normalise(question) };

  const department = matchRef(text, vocabulary.departments);
  const category = matchRef(text, vocabulary.categories);

  let asksAboutEffort = false;
  for (const phrase of EFFORT) if (take(text, phrase)) asksAboutEffort = true;

  // Order first: "best ranked" asks how to sort, and must not also filter to the Ranked
  // stage — that would hide every idea further along.
  let sort: (typeof SORTS)[number] | undefined;
  for (const s of SORTS) {
    if (s.phrases.some((p) => take(text, p))) {
      sort = s;
      break;
    }
  }

  let stage: (typeof STAGES)[number] | undefined;
  for (const s of STAGES) {
    if (s.phrases.some((p) => take(text, p))) {
      stage = s;
      break;
    }
  }

  // The longest word left that means something — the list searches titles, and a
  // whole sentence never matches a title.
  const words = text.value.trim().split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const keyword = words.reduce<string | undefined>((best, w) => (!best || w.length > best.length ? w : best), undefined);

  return {
    ...(department ? { department } : {}),
    ...(category ? { category } : {}),
    statuses: stage?.statuses ?? [],
    ...(stage ? { stageLabel: stage.label } : {}),
    ...(sort ? { sort: sort.sort, sortLabel: sort.label } : {}),
    ...(keyword ? { keyword } : {}),
    asksAboutEffort,
  };
}

/** True when the question produced nothing to apply. */
export function isEmptyFilter(f: SmartFilter): boolean {
  return !f.department && !f.category && f.statuses.length === 0 && !f.sort && !f.keyword;
}
