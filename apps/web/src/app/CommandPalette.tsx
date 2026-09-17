import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
  CommandShortcut,
} from "@iep/ui";
import type { ListIdeasResponse, Role } from "@iep/contracts";
import {
  Compass, FileClock, LayoutDashboard, LifeBuoy, ListChecks, PenSquare, RotateCw, Search,
  Settings, Sparkles, SlidersHorizontal, Trophy, User,
} from "lucide-react";
import { api } from "./api-client";
import { canSee, useSession } from "./use-session";
import { queryKeys } from "./query-keys";

/**
 * Design-audit finding: the header's only search affordance was a bare text input that
 * submits to `/ideas?q=...` on Enter — no live results, no way to jump straight to a
 * page, nothing resembling the command palette every serious B2B tool has shipped for
 * years now (a competitor evaluator named this specifically). This is the same request,
 * answered properly: press ⌘K/Ctrl K anywhere in the app, get live idea search AND
 * every static destination you're allowed to reach, in one place, keyboard-only start to
 * finish.
 *
 * It costs nothing on the backend — idea search reuses `GET /ideas?q=`, exactly what the
 * header form already sent, and "go to" is the same nav map + role check the sidebar
 * already runs. No new endpoint, no contract change.
 */

interface Destination {
  readonly to: string;
  readonly label: string;
  readonly roles: readonly Role[];
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly keywords?: string;
}

const DESTINATIONS: readonly Destination[] = [
  { to: "/dashboard", label: "Dashboard", roles: ["MANAGEMENT", "ADMIN"], icon: LayoutDashboard },
  { to: "/ideas/new", label: "Submit an idea", roles: [], icon: PenSquare },
  { to: "/ideas", label: "Explore ideas", roles: [], icon: Compass },
  { to: "/me/ideas", label: "My ideas", roles: [], icon: User },
  { to: "/review", label: "Review queue", roles: ["REVIEWER", "ADMIN"], icon: ListChecks },
  { to: "/rankings", label: "Rankings", roles: [], icon: Trophy },
  { to: "/discovery", label: "Discover", roles: [], icon: Sparkles, keywords: "ai trends opportunities" },
  { to: "/config/criteria", label: "Evaluation criteria", roles: [], icon: SlidersHorizontal, keywords: "config weights" },
  { to: "/config/profiles", label: "Evaluation profiles", roles: [], icon: SlidersHorizontal, keywords: "config weights" },
  { to: "/admin/users", label: "Users & roles", roles: ["ADMIN"], icon: Settings, keywords: "administration people access" },
  { to: "/admin/audit", label: "Audit log", roles: ["ADMIN"], icon: FileClock, keywords: "administration history" },
  /*
   * Design-audit finding: recompute is a real action someone needs quickly, filed one
   * click deeper than the rest of Administration (a collapsed panel on the Audit log
   * tab) since it moved off the Dashboard. Same destination, but findable by the verb
   * someone actually types, and `?recompute=open` (AdminPages.tsx's `RecomputePanel`)
   * lands with the panel already expanded instead of one more click away.
   */
  { to: "/admin/audit?recompute=open", label: "Recompute the rankings", roles: ["ADMIN"], icon: RotateCw, keywords: "recompute rankings snapshot" },
  { to: "/help/data-and-ai", label: "Data & AI notice", roles: [], icon: LifeBuoy, keywords: "help privacy" },
];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * One component owns the trigger button AND the dialog, sharing a single `open` state —
 * a separate trigger dispatching a synthetic keydown at a listener elsewhere would work,
 * but two independent pieces of state pretending to be one is exactly the kind of
 * indirection that turns into a bug the first time either half changes.
 */
export function CommandPalette({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebounced(query, 200);
  const navigate = useNavigate();
  const { data: session } = useSession();
  const roles: readonly Role[] = session?.user.roles ?? [];

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const trimmed = debouncedQuery.trim();
  const searchable = open && trimmed.length >= 2;

  /*
   * `useQuery`, not a hand-rolled effect+fetch — the same data-fetching pattern every
   * other screen in this app uses (`useIdeaList` below is the same call `IdeaListPage`
   * makes). It owns its own loading/cancellation/caching, which is also what keeps this
   * clear of react-hooks/set-state-in-effect: nothing here calls setState from inside an
   * effect body, because there is no bare effect — TanStack Query's internals are.
   */
  const { data: results, isFetching: searching } = useQuery({
    queryKey: queryKeys.ideas.list({ q: trimmed, page: 1 }),
    queryFn: () => api<ListIdeasResponse>(`/ideas?q=${encodeURIComponent(trimmed)}&page=1`),
    enabled: searchable,
  });
  const shownResults = searchable ? (results ?? null) : null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const visibleDestinations = DESTINATIONS.filter((d) => canSee(roles, d.roles));

  return (
    <>
      {/*
        The button that used to submit a plain text form now opens the palette instead —
        same visual slot in the header, same placeholder copy, so nothing about where to
        look for search changes. What changes is what happens once you're in it.

        Design-audit finding: below `md` this whole control used to be `hidden` — a phone
        had no search AND no way to reach the "Go to" list at all, which is a bigger gap
        than any single icon on the header being unlabeled. Visible at every width now: a
        plain icon button on a phone (the same footprint as the Discover/Theme icons
        beside it), the full labeled search field from `md` up.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search ideas, or jump to a page"
        className={`flex h-8 w-9 shrink-0 items-center justify-center gap-2 rounded-md border px-0 text-100 transition-colors md:w-full md:justify-start md:px-2.5 ${className ?? ""}`}
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="hidden flex-1 truncate text-left md:inline">
          Search ideas, or jump to a page…
        </span>
        <CommandShortcut className="hidden shrink-0 rounded border border-current/30 px-1 py-0.5 text-100 normal-case md:inline">
          Ctrl K
        </CommandShortcut>
      </button>

      {/*
        Design-audit finding: this was built on the shared `Command`/`Dialog` primitives
        completely unskinned — a plain popover surface, a generic heading style, no
        touch of the product's own visual language anywhere in it, sitting one keystroke
        away from a hero card that has real considered depth. The primitives themselves
        are untouched (other features may reasonably want the plain version); every
        change below is a `className` passed in at this one call site, the same pattern
        `WelcomeShell`/`DashboardHero` already use to skin a shared base component rather
        than forking it.
      */}
      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Next open starts fresh rather than on whatever was last typed — set where
          // the change originates, not reacted to afterward in a second effect.
          if (!next) setQuery("");
        }}
        title="Search and go to"
        description="Search ideas or jump to any page you can reach"
        className="rounded-2xl shadow-e4 ring-1 ring-border sm:max-w-xl"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search ideas, or jump to a page…"
          className="text-200"
        />
        <CommandList>
          <CommandEmpty className="text-200 text-muted-foreground">
            {trimmed.length >= 2 && !searching
              ? "No ideas match, and nothing here jumps to that page."
              : "Type to search ideas, or pick a page below."}
          </CommandEmpty>

          {shownResults && shownResults.items.length > 0 ? (
            <CommandGroup
              heading="Ideas"
              className="[&_[cmdk-group-heading]]:text-100! [&_[cmdk-group-heading]]:font-bold! [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em]"
            >
              {shownResults.items.slice(0, 6).map((idea) => (
                <CommandItem
                  key={idea.id}
                  /*
                   * cmdk fuzzy-filters every item by its OWN `value`, on top of the
                   * server-side `q` search this list already ran — a UUID here (the
                   * first thing this said) never matches what someone actually typed,
                   * so every real result was being hidden by the palette's own filter
                   * the instant it rendered. The title is both the visible label and
                   * the thing that has to match.
                   */
                  value={idea.title}
                  onSelect={() => go(`/ideas/${idea.id}/overview`)}
                  /*
                   * A left accent rail on the selected row — the same affordance the
                   * sidebar's own active nav item uses (`NavLink`'s `brand-pill--railed`
                   * in AppShell.tsx), so "this is the one that's selected" reads the
                   * same way twice in the same product instead of two different tells.
                   */
                  className="rounded-lg border-l-2 border-l-transparent text-200 data-[selected=true]:border-l-accent-600"
                >
                  <Search className="text-muted-foreground" />
                  <span className="truncate">{idea.title}</span>
                  <CommandShortcut className="normal-case">{idea.status}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          <CommandGroup
            heading="Go to"
            className="[&_[cmdk-group-heading]]:text-100! [&_[cmdk-group-heading]]:font-bold! [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em]"
          >
            {visibleDestinations.map((d) => (
              <CommandItem
                key={d.to}
                value={`${d.label} ${d.keywords ?? ""}`}
                onSelect={() => go(d.to)}
                className="rounded-lg border-l-2 border-l-transparent text-200 data-[selected=true]:border-l-accent-600"
              >
                <d.icon className="text-muted-foreground" />
                {d.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
