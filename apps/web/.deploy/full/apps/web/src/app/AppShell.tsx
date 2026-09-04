import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, Compass, LayoutDashboard, ListChecks, LogOut, PenSquare, Plus, Settings,
  ShieldCheck, Trophy, User,
} from "lucide-react";
import { Button } from "@iep/ui";
import type { Role } from "@iep/contracts";
import { api } from "./api-client";
import { canSee, useSession } from "./use-session";
import { ThemeToggle } from "./theme";
import { PRODUCT_NAME, PRODUCT_SHORT } from "./product";

/**
 * The application shell — header, navigation, account menu.
 *
 * Replaces the P1 development scaffold, which listed all 25 routes from the navigation
 * map, showed a "19 of 25" counter meant for a developer, and kept an idea's tabs
 * permanently in the sidebar pointing at a placeholder id.
 *
 * REQUIREMENTS §20 is explicit and this follows it exactly: four destinations for
 * everyone, three more for people with the roles for them, and nothing else. "Do not put
 * every feature in the main navigation" — the rest is reachable from the pages it belongs
 * to, which is where someone would look for it anyway.
 */

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  /** Empty means everyone signed in. Mirrors the nav map's own role lists. */
  readonly roles: readonly Role[];
  /**
   * The icon chip's ink-and-tint pair (Idea Platform Redesign — sidebar).
   *
   * A destination per colour, so the sidebar is scanned by shape rather than read
   * top-to-bottom. `factor-up` on Rankings is a considered exception to "evidence
   * colours mean one thing": P-1 forbids green/red encoding an idea's QUALITY, and the
   * teal was chosen precisely so it does not read as a verdict. A nav icon is not a
   * score. Nothing here is ever applied to a number.
   */
  readonly tone: string;
}

const PRIMARY: readonly NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["MANAGEMENT", "ADMIN"],
    tone: "bg-accent text-accent-foreground" },
  { to: "/ideas/new", label: "Submit an idea", icon: PenSquare, roles: [],
    tone: "bg-state-warn-bg text-state-warn" },
  { to: "/ideas", label: "Explore ideas", icon: Compass, roles: [],
    tone: "bg-accent text-accent-foreground" },
  /* Not the `ai-*` palette the canvas uses here — provenance.test.ts reserves it for
     <Provenance>, and "your own ideas" is the last thing that should look model-authored. */
  { to: "/me/ideas", label: "My ideas", icon: User, roles: [],
    tone: "bg-ramp-1 text-accent-700" },
];

const PRIVILEGED: readonly NavItem[] = [
  { to: "/review", label: "Reviews", icon: ListChecks, roles: ["REVIEWER", "ADMIN"],
    tone: "bg-state-warn-bg text-state-warn" },
  { to: "/rankings", label: "Rankings", icon: Trophy, roles: [],
    tone: "bg-factor-up-bg text-factor-up" },
  { to: "/admin/users", label: "Administration", icon: Settings, roles: ["ADMIN"],
    tone: "bg-muted text-muted-foreground" },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      /*
       * The active item gets a rail down its left edge as well as a tint. On a sidebar
       * where several items share a similar background, the rail is what the eye lands
       * on — and unlike colour alone it survives being read at a glance from across a
       * meeting room, which is where this gets looked at.
       */
      className={
        active
          ? "brand-pill brand-pill--railed relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-200 font-semibold text-grad-ink no-underline shadow-e3"
          : "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-200 font-medium no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted"
      }
    >
      {/*
        The icon sits in its own tinted square when the item is at rest, and plain on the
        gradient when it is active — a chip inside a chip is two competing shapes and the
        label loses.
      */}
      {active ? (
        <item.icon aria-hidden className="size-4 shrink-0" />
      ) : (
        <span
          aria-hidden
          className={`grid size-6.5 shrink-0 place-items-center rounded-md ${item.tone}`}
        >
          <item.icon className="size-3.5" />
        </span>
      )}
      {item.label}
    </Link>
  );
}

/** How a ghost control has to look sitting on the dark gradient bar. */
const ON_BAR = "text-grad-ink hover:bg-grad-ink/15 hover:text-grad-ink";

function AccountMenu() {
  const { data } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const signOut = useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      // Clear every cached query: the next person must never see the last one's data.
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  if (!data) return null;
  const initials = data.user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-[var(--dur-fast)] ${ON_BAR}`}
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-grad-highlight/20 text-100 font-bold text-grad-highlight ring-1 ring-grad-rule">
          {initials}
        </span>
        <span className="hidden text-200 font-medium sm:inline">{data.user.displayName}</span>
        <ChevronDown
          aria-hidden
          className={`size-4 transition-transform duration-[var(--dur-fast)] ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/*
        `text-popover-foreground` is set explicitly rather than inherited. The header above
        is white-on-gradient, and a popover that inherits its parent's colour is one
        stylesheet change away from being invisible — which is exactly what happened to the
        sign-out item here.
      */}
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-e4"
        >
          <div className="brand-bar px-4 py-4 text-grad-ink">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-grad-highlight/20 text-200 font-bold text-grad-highlight ring-1 ring-grad-rule">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-200 font-semibold">{data.user.displayName}</p>
                <p className="truncate text-100 text-grad-ink-soft">{data.user.email}</p>
              </div>
            </div>

            {/*
              Roles as chips rather than a joined string. Somebody holding three of them
              was reading "EMPLOYEE · REVIEWER · ADMIN" as one run-on line.
            */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.user.roles.map((role) => (
                <span
                  key={role}
                  className="rounded-full bg-grad-ink/15 px-2 py-0.5 text-100 font-medium tracking-wide ring-1 ring-grad-rule"
                >
                  {role.charAt(0) + role.slice(1).toLowerCase()}
                </span>
              ))}
              {data.user.department ? (
                <span className="rounded-full px-2 py-0.5 text-100 text-grad-ink-soft">
                  {data.user.department.name}
                </span>
              ) : null}
            </div>
          </div>

          <div className="p-1.5">
            <Link
              to="/help/data-and-ai"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-200 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-accent-foreground"
            >
              <ShieldCheck aria-hidden className="size-4 shrink-0" />
              How your data is handled
            </Link>

            <div className="my-1.5 border-t border-border" />

            {/*
              Sign out is where every application on earth puts it, and it is tinted
              destructive so it reads as the one item that ends something.
            */}
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-200 font-medium text-destructive transition-colors duration-[var(--dur-fast)] hover:bg-destructive/10 disabled:opacity-60"
            >
              <LogOut aria-hidden className="size-4 shrink-0" />
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { data } = useSession();
  const roles: readonly Role[] = data?.user.roles ?? [];
  const [navOpen, setNavOpen] = React.useState(false);

  const visible = (items: readonly NavItem[]) => items.filter((i) => canSee(roles, i.roles));
  const primary = visible(PRIMARY);
  const privileged = visible(PRIVILEGED);

  // Longest match wins, so /ideas/new does not also light up /ideas.
  const activeFor = (to: string): boolean =>
    pathname === to ||
    (to !== "/" &&
      pathname.startsWith(`${to}/`) &&
      ![...primary, ...privileged].some((i) => i.to !== to && i.to.startsWith(to) && pathname.startsWith(i.to)));

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {primary.map((item) => (
        <NavLink key={item.to} item={item} active={activeFor(item.to)} />
      ))}

      {privileged.length > 0 ? (
        <>
          <p className="mt-4 px-3 pb-1 text-100 font-medium uppercase tracking-widest text-muted-foreground">
            For your role
          </p>
          {privileged.map((item) => (
            <NavLink key={item.to} item={item} active={activeFor(item.to)} />
          ))}
        </>
      ) : null}
    </nav>
  );

  return (
    <div className="min-h-dvh">
      {/*
        The header carries the brand gradient, so the product does not change identity the
        moment somebody signs in. Text on it is white in BOTH themes — the bar is dark in
        both, so a token that flips would be wrong here.
      */}
      <header className="brand-bar sticky top-0 z-40 flex h-14 items-center gap-3 px-4 text-grad-ink shadow-e2">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          aria-label="Menu"
        >
          ☰
        </Button>

        <Link to="/" className="flex min-w-0 items-center gap-2 no-underline">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-grad-highlight/20 text-100 font-bold text-grad-highlight ring-1 ring-grad-rule">
            IP
          </span>
          {/* Full name where there is room; the short form only when there is not. */}
          <span className="hidden truncate text-200 font-semibold text-grad-ink xl:inline">
            {PRODUCT_NAME}
          </span>
          <span className="truncate text-200 font-semibold text-grad-ink xl:hidden">
            {PRODUCT_SHORT}
          </span>
        </Link>

        {/*
          Each control is told how to look on a dark bar. Explicitly, one at a time.

          This was a `[&_button]` rule on the wrapper, which is shorter and was wrong: a
          descendant selector cannot distinguish a toolbar button from a menu item three
          levels down, so it painted the sign-out item inside the account dropdown white —
          on a white popover. The control was rendered, focusable and clickable, and
          completely invisible. Reported, reasonably, as "there is no sign out".
        */}
        <div className="ml-auto flex items-center gap-1">
          {/*
            "New idea" in the bar, in amber (Idea Platform Redesign — header).

            The one thing this product exists for was previously reachable only from the
            sidebar, which is hidden on a phone until you open the menu. Amber because it
            is the single warm accent the gradient tokens allow, and because the one CTA
            that should never be hunted for is the one that adds an idea.

            `text-grad-from`, not white: --grad-highlight is amber in both themes and
            white on it is about 2:1. The deep indigo is 6.6:1 on it, computed in
            tokens.css against this exact pair.
          */}
          <Link
            to="/ideas/new"
            className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-grad-highlight px-3 text-200 font-bold text-grad-from no-underline transition-transform duration-[var(--dur-fast)] hover:-translate-y-px"
          >
            <Plus aria-hidden className="size-4" />
            <span className="hidden sm:inline">New idea</span>
            <span className="sr-only sm:hidden">New idea</span>
          </Link>
          <ThemeToggle className={ON_BAR} />
          <AccountMenu />
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_1fr]">
        <aside className="brand-rail hidden border-r border-border bg-card lg:block">{nav}</aside>
        {navOpen ? (
          <div className="border-b border-border lg:hidden" onClick={() => setNavOpen(false)}>
            {nav}
          </div>
        ) : null}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
