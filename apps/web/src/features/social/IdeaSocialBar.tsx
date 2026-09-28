import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bell, BellRing, Share2, UserPlus, Users } from "lucide-react";
import { Button } from "@iep/ui";
import type { IdeaDetail } from "@iep/contracts";
import { useSetSignal, useSignals } from "../feedback/api";
import { useFollow } from "./api";
import { celebrate, originOf } from "../../app/motion";

/**
 * P18 — follow, share and the idea's team, in the idea header beside Team feedback.
 *
 * "Join the team" is not a new concept: it is the existing "I could help build this"
 * structured signal (FR-18), which already means exactly that and already counts towards
 * demonstrated demand. The header just makes the people behind it visible, and joining
 * one click away. The submitter is always on the team; they do not "join" their own idea.
 */

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();

const SHOWN = 4;

/** An "on" toggle reads as on at a glance — the accent tint, not just a changed icon. */
// The `dark:` twins matter: the outline variant sets its own `dark:` border/background,
// which a plain class cannot outrank.
const PRESSED =
  "border-accent-600 bg-accent-100 text-accent-700 hover:bg-accent-100 hover:text-accent-700 " +
  "dark:border-accent-600 dark:bg-accent-100 dark:hover:bg-accent-100";

export function IdeaSocialBar({ idea, isOwner }: { idea: IdeaDetail; isOwner: boolean }) {
  const follow = useFollow(idea.id);
  const signals = useSignals(idea.id);
  const setSignal = useSetSignal(idea.id);

  const team = (signals.data?.entries ?? []).filter((e) => e.type === "CAN_HELP_IMPLEMENT");
  const onTeam = signals.data?.mine.includes("CAN_HELP_IMPLEMENT") ?? false;
  const { following, followerCount } = idea.social;

  const share = async () => {
    const url = `${window.location.origin}/ideas/${idea.id}/overview`;
    try {
      // The phone's own share sheet where there is one; otherwise the link, copied.
      if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: idea.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Link copied — anyone who can see this idea can open it.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return; // closed the share sheet
      toast.error("Could not copy the link. Copy it from the address bar instead.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <span className="flex items-center gap-2">
        <span className="text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">Team</span>
        <span className="flex items-center" aria-label={`Team: ${[idea.submitter.displayName, ...team.map((t) => t.submitter.displayName)].join(", ")}`}>
          {[{ id: idea.submitter.id, name: idea.submitter.displayName }, ...team.map((t) => ({ id: t.submitter.id, name: t.submitter.displayName }))]
            .slice(0, SHOWN)
            .map((p, i) => (
              <Link
                key={p.id}
                to={`/people/${p.id}`}
                title={i === 0 ? `${p.name} (submitter)` : p.name}
                className="-ml-1.5 grid size-8 place-items-center rounded-full bg-accent-100 text-100 font-extrabold text-accent-700 no-underline ring-2 ring-card first:ml-0 hover:z-10 hover:ring-accent-600"
              >
                {initials(p.name)}
              </Link>
            ))}
          {team.length + 1 > SHOWN ? (
            <span className="-ml-1.5 grid size-8 place-items-center rounded-full bg-muted text-100 font-bold text-muted-foreground ring-2 ring-card">
              +{team.length + 1 - SHOWN}
            </span>
          ) : null}
        </span>
        {isOwner ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={onTeam ? PRESSED : undefined}
            aria-pressed={onTeam}
            disabled={setSignal.isPending || signals.isPending}
            onClick={(e) => {
              const origin = originOf(e.currentTarget);
              setSignal.mutate(
                { type: "CAN_HELP_IMPLEMENT", active: !onTeam },
                {
                  onSuccess: () => {
                    // P20 celebration — joining, not leaving.
                    if (!onTeam) celebrate(origin);
                    toast.success(onTeam ? "You left the team." : "You joined the team — the submitter can see you offered to help.");
                  },
                },
              );
            }}
          >
            {onTeam ? <Users aria-hidden className="size-4" /> : <UserPlus aria-hidden className="size-4" />}
            {onTeam ? "On the team" : "Join the team"}
          </Button>
        )}
      </span>

      {isOwner ? (
        // The submitter cannot follow their own idea (they hear about it regardless), but
        // who is following it is exactly the encouragement worth showing them.
        <span className="flex items-center gap-1.5 text-200 text-muted-foreground">
          <Bell aria-hidden className="size-4" />
          <span className="tabular-nums font-semibold text-foreground">{followerCount}</span>
          {followerCount === 1 ? "person follows this" : "people follow this"}
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={following ? PRESSED : undefined}
          aria-pressed={following}
          aria-label={following ? `Following — stop following (${followerCount} following)` : `Follow this idea (${followerCount} following)`}
          disabled={follow.isPending}
          onClick={() => follow.mutate(!following)}
        >
          {following ? <BellRing aria-hidden className="size-4" /> : <Bell aria-hidden className="size-4" />}
          {following ? "Following" : "Follow"}
          <span className={following ? "tabular-nums" : "tabular-nums text-muted-foreground"}>{followerCount}</span>
        </Button>
      )}

      <Button type="button" size="sm" variant="outline" onClick={() => void share()}>
        <Share2 aria-hidden className="size-4" />
        Share
      </Button>
    </div>
  );
}
