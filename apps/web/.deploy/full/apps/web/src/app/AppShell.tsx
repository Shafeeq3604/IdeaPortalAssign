import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell, ChevronDown, Compass, LayoutDashboard, ListChecks, LogOut, Menu, PenSquare, Plus, Settings,
  ShieldCheck, Sparkles, Trophy, User, X,
} from "lucide-react";
import { Button } from "@iep/ui";
import type { Role } from "@iep/contracts";
import { api } from "./api-client";
import { canSee, useSession } from "./use-session";
import { ThemeToggle } from "./theme";
import { useUnreadCount } from "../features/notifications/api";
import { BrandMark } from "./BrandMark";
import { CommandPalette } from "./CommandPalette";
import { MobileTabBar } from "./MobileTabBar";
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
          : /*
             * `hover:bg-sidebar-hover`, not `hover:bg-muted` — dark-mode refinement pass.
             * `--muted` now resolves to the exact same colour as the sidebar's own
             * background (both point at the "secondary surface" tier), so a hovered row
             * would have nothing to show. `--sidebar-hover` is the lighter card tone
             * instead, equal to `--muted` in light mode (no change there), a visible lift
             * off the rail in dark.
             *
             * `text-muted-foreground` (dark-mode final-polish pass, item 8): an inactive
             * label used to inherit full-strength `--text`, the same weight the ACTIVE
             * item's white-on-gradient label carries — eight destinations all shouting at
             * once instead of one. Recedes at rest, `hover:text-foreground` brings it back
             * to full strength the moment it is actually the thing being looked at.
             */
            "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-200 font-medium text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-sidebar-hover hover:text-foreground"
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
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const closeAndReturnFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  React.useEffect(() => {
    if (!open) return;
    const onAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && closeAndReturnFocus();
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // `role="menu"` promises arrow-key/roving-tabindex behaviour a mouse-only implementation
  // never delivers — a keyboard user who reaches this popover could tab through it but not
  // move between items the way the role tells their screen reader they can.
  React.useEffect(() => {
    if (!open) return;
    const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[0]?.focus();
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (index: number) => items[(index + items.length) % items.length]?.focus();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(currentIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(currentIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        break;
      default:
        break;
    }
  };

  const signOut = useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      // Clear every cached query: the next person must never see the last one's data.
      queryClient.clear();
      navigate("/login", { replace: true });
    },
    // The button used to just revert from "Signing out…" back to "Sign out" on failure —
    // silent, with no sign anything went wrong. A shared machine is exactly where that
    // matters: someone who believes they signed out and walks away has not.
    onError: () => {
      toast.error("Could not sign out. Check your connection and try again.");
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
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        // Explicit, rather than left to be computed from the visible name span (which is
        // `hidden` below the `sm` breakpoint) — a button whose only accessible name comes
        // from text that can be hidden by CSS is one layout change away from having none.
        aria-label={`Account menu for ${data.user.displayName}`}
        className={`flex h-11 items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors sm:px-2 duration-[var(--dur-fast)] sm:h-auto ${ON_BAR}`}
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-grad-highlight/20 text-100 font-bold text-grad-highlight ring-1 ring-grad-rule">
          {initials}
        </span>
        <span className="hidden text-200 font-medium lg:inline">{data.user.displayName}</span>
        <ChevronDown
          aria-hidden
          className={`hidden size-4 transition-transform duration-[var(--dur-fast)] sm:block ${open ? "rotate-180" : ""}`}
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
          onKeyDown={onMenuKeyDown}
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

          {/* P9 tester feedback: "How your data is handled" moved out of this menu to the
              foot of the sidebar (`SidebarHelp`) — people did not expect a privacy notice
              behind their own avatar. */}
          <div className="p-1.5">
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

/*
 * No signed-in-person strip at the foot of the sidebar any more (owner feedback,
 * 2026-09-25): the header's account menu already shows who is signed in, their roles and
 * sign-out, and a second copy of the same name in the corner was repetition.
 */
/**
 * "How your data is handled", as a utility link at the foot of the sidebar (P9 tester
 * feedback — it used to sit inside the account menu, where nobody looked for it).
 *
 * Deliberately NOT a tenth main-navigation destination: REQUIREMENTS §20 keeps that list
 * to the seven it names. This sits below them, past a divider —
 * help chrome, the same place other enterprise tools put "How X works".
 */
const HELP_ITEM: NavItem = {
  to: "/help/data-and-ai", label: "How your data is handled", icon: ShieldCheck, roles: [],
  tone: "bg-muted text-muted-foreground",
};

function SidebarHelp() {
  const { pathname } = useLocation();
  return (
    <div className="mt-auto border-t border-border p-3">
      <NavLink item={HELP_ITEM} active={pathname === HELP_ITEM.to} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { data } = useSession();
  const roles: readonly Role[] = data?.user.roles ?? [];
  const [navOpen, setNavOpen] = React.useState(false);

  // A click on a nav link already closes this (it bubbles to the wrapping div's own
  // onClick below), but that left two gaps `AccountMenu` right above already closes for
  // its own popover: Escape did nothing, and navigating by any non-click path (browser
  // back/forward) left the drawer open over the new page underneath it.
  //
  // Adjusted during render, not in a `useEffect` — the React-recommended pattern for
  // resetting state in response to a prop/route change (react.dev "You Might Not Need
  // an Effect"): an effect that unconditionally calls `setState` on every dependency
  // change is exactly the cascading-render anti-pattern `react-hooks/set-state-in-effect`
  // exists to catch.
  const [prevPathname, setPrevPathname] = React.useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (navOpen) setNavOpen(false);
  }

  React.useEffect(() => {
    if (!navOpen) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [navOpen]);

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
        Manual accessibility pass (design-audit finding, distinct from the automated axe
        sweep): every page here puts 4-8 sidebar nav links between a keyboard or
        screen-reader user and the content they came for, on every single page load. A
        skip link is the standard fix (WCAG 2.4.1) and nothing in this codebase had one.
        Visually hidden until it receives focus, first thing in tab order, jumps straight
        to the content wrapper below.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent-600 focus:px-4 focus:py-2 focus:text-100 focus:font-semibold focus:text-primary-foreground focus:shadow-e4"
      >
        Skip to main content
      </a>

      {/*
        The header carries the brand gradient, so the product does not change identity the
        moment somebody signs in. Text on it is white in BOTH themes — the bar is dark in
        both, so a token that flips would be wrong here.
      */}
      <header className="brand-bar sticky top-0 z-40 flex h-14 items-center gap-1.5 px-2 sm:gap-3 sm:px-4 text-grad-ink shadow-e2">
        <Button
          variant="ghost"
          size="sm"
          className={`h-11 w-11 md:hidden ${ON_BAR}`}
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          aria-controls="mobile-nav"
          aria-label={navOpen ? "Close menu" : "Menu"}
        >
          {navOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        </Button>

        {/*
          Bug found live at phone width: `min-w-0` (needed so the truncating `PRODUCT_NAME`
          span doesn't force the row wider than its content) also told the flex algorithm
          this whole link could shrink all the way to 0 once the row got tight — and with
          the icon span's own `overflow: visible`, a 0-width anchor still PAINTED its icon,
          just on top of whatever sibling now started at that same x position (the command
          palette button). The link needs `min-w-0` for its text child but must never itself
          be squeezed below its icon's size, so `shrink-0` goes on the link and `min-w-0`
          moves to the text spans, which is the only place truncation actually happens.
        */}
        <Link to="/" className="flex shrink-0 items-center gap-2 no-underline">
          {/*
            The same mark the sign-in screen uses (`WelcomeShell`'s own header badge),
            not a second, unrelated "IP" monogram — design-audit finding: a plain
            two-letter initial badge here and a different mark there read as two
            different products across the sign-in/sign-up-to-app boundary. One mark now.
          */}
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-grad-highlight/20 ring-1 ring-grad-rule">
            <BrandMark className="size-3.5 text-grad-highlight" />
          </span>
          {/*
            Full name where there is room, the short form once there isn't, and neither
            below `sm` — a phone-width header has the hamburger, this link, "Submit an
            idea", Discover, the theme toggle and the account menu all in one 320-ish px
            row, and
            "Idea Platform" has no room left to sit in. Truncating it to "I…" was worse
            than showing nothing: the mark two characters to its left already carries the
            identity on its own at that width.
          */}
          <span className="hidden truncate text-200 font-semibold text-grad-ink xl:inline">
            {PRODUCT_NAME}
          </span>
          <span className="hidden truncate text-200 font-semibold text-grad-ink sm:inline xl:hidden">
            {PRODUCT_SHORT}
          </span>
        </Link>

        <div className="sm:mx-2 md:flex-1 md:max-w-80">
          {/*
            Design-audit finding: the header search was a bare text box that only
            submitted on Enter — no live results, no way to reach a page directly, and
            the single weakest surface a competitor evaluator singled out. `CommandPalette`
            replaces it: same slot, same placeholder, but Ctrl K/⌘K opens live idea search
            AND a "go to" list of every page this person can reach, from anywhere in the
            app, not just from this box. It used to be hidden below `md` entirely — now a
            compact icon button at every width, so a phone gets the same reach a desktop
            keyboard shortcut gives everyone else.
          */}
          <CommandPalette className="border-grad-rule bg-grad-ink/10 text-grad-ink-soft hover:bg-grad-ink/15 hover:text-grad-ink focus-visible:bg-card focus-visible:text-foreground" />
        </div>

        {/*
          Each control is told how to look on a dark bar. Explicitly, one at a time.

          This was a `[&_button]` rule on the wrapper, which is shorter and was wrong: a
          descendant selector cannot distinguish a toolbar button from a menu item three
          levels down, so it painted the sign-out item inside the account dropdown white —
          on a white popover. The control was rendered, focusable and clickable, and
          completely invisible. Reported, reasonably, as "there is no sign out".
        */}
        <div className="ml-auto flex items-center sm:gap-1">
          {/*
            "Submit an idea" in the bar, in amber (Idea Platform Redesign — header).

            The one thing this product exists for was previously reachable only from the
            sidebar, which is hidden on a phone until you open the menu. Amber because it
            is the single warm accent the gradient tokens allow, and because the one CTA
            that should never be hunted for is the one that adds an idea.

            Labeled to match every other entry point to this exact destination — the
            sidebar link, the command palette entry, this page's own heading and the
            escape hatch on an empty idea list (UI audit finding: this button used to say
            "New idea" while all five of those said "Submit an idea" — same href, two
            different names for a first-time user to reconcile). This was the one out of
            step with the rest, not the other five.

            `text-grad-from`, not white: --grad-highlight is amber in both themes and
            white on it is about 2:1. The deep indigo is 6.6:1 on it, computed in
            tokens.css against this exact pair.
          */}
          <Link
            to="/ideas/new"
            className="inline-flex h-11 w-11 items-center justify-center gap-1.5 rounded-full bg-grad-highlight sm:h-8 sm:w-8 md:mr-1 md:w-auto md:px-3 text-200 font-bold text-grad-from no-underline transition-transform duration-[var(--dur-fast)] hover:-translate-y-px"
          >
            <Plus aria-hidden className="size-4" />
            <span className="hidden whitespace-nowrap md:inline">Submit an idea</span>
            <span className="sr-only md:hidden">Submit an idea</span>
          </Link>
          {/*
            SPC-001 — AI Discovery Agent. Deliberately a header icon, not a sidebar item:
            REQUIREMENTS §20 fixes the main navigation at four destinations for everyone
            plus three for privileged roles, "nothing else" — adding a fifth would break
            that explicit constraint. This is the same layer as ThemeToggle/AccountMenu,
            not a sidebar addition.
          */}
          <Link
            to="/discovery"
            aria-label="Discover"
            title="Discover — ask the AI research agent"
            className={`${ON_BAR} inline-flex h-11 w-11 items-center justify-center gap-1.5 rounded-md px-2 sm:h-8 sm:w-8 lg:w-auto lg:justify-start lg:px-2.5`}
          >
            <Sparkles aria-hidden className="size-4 shrink-0" />
            <span className="hidden text-200 font-medium lg:inline">Discover</span>
          </Link>
          <NotificationBell />
          <ThemeToggle className={ON_BAR} />
          <AccountMenu />
        </div>
      </header>

      <div className="md:grid md:grid-cols-[15rem_1fr]">
        {/*
          `bg-sidebar`, not `bg-card` — dark-mode refinement pass. Equal to `bg-card` in
          light mode (unchanged there), but its own distinct, deliberately darker surface
          in dark mode, so the rail reads as related-to-but-different-from the cards
          sitting in the column beside it, instead of the exact same slate repeated.
        */}
        {/*
          `sticky` + a height pinned to the viewport minus the header (design-review
          request: the signed-in-user footer below should sit at the foot of the
          sidebar, not right under however few nav links happen to fit) — without this,
          `<aside>` is only ever as tall as `{nav}` itself (a two-column CSS grid does
          not stretch a short column to match a much longer one the way a flex row
          would), so `mt-auto` on the footer had nothing to push against and it sat
          flush under the last link instead of at the bottom of the screen.
        */}
        <aside className="brand-rail hidden border-r border-border bg-sidebar md:sticky md:top-14 md:flex md:h-[calc(100dvh-3.5rem)] md:flex-col md:overflow-y-auto">
          {nav}
          <SidebarHelp />
        </aside>
        {/*
          A real overlay drawer on a phone, not an inline panel that shoves the page's own
          content down the screen (design-audit finding: the old version left someone's
          scroll position wrecked the moment they closed it, and gave no way to close it
          except tapping the hamburger a second time). Fixed, sits above everything, and a
          scrim behind it is both the visual cue that this is temporary and a full-width
          "tap anywhere to close" target — the standard mobile nav pattern, not a bespoke
          one invented for this product.
        */}
        {navOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              aria-hidden
              className="absolute inset-0 bg-foreground/50"
              onClick={() => setNavOpen(false)}
            />
            <div
              id="mobile-nav"
              role="dialog"
              aria-modal="true"
              aria-label="Main navigation"
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-sidebar shadow-e4"
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
                <span className="flex items-center gap-2 text-200 font-semibold text-foreground">
                  <BrandMark className="size-4 text-accent-700" />
                  {PRODUCT_SHORT}
                </span>
                <button
                  type="button"
                  onClick={() => setNavOpen(false)}
                  aria-label="Close menu"
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
              {nav}
              <SidebarHelp />
            </div>
          </div>
        ) : null}
        <div id="main-content" tabIndex={-1} className="has-tab-bar min-w-0 focus:outline-none">
          {children}
        </div>
      </div>
      {/* P20 — the phone's bottom tab bar; hidden from `md` up, where the sidebar is. */}
      <MobileTabBar />
    </div>
  );
}

/**
 * P13 — the notification bell. A header icon for the same reason Discover is one:
 * REQUIREMENTS §20 fixes the sidebar's destinations, and this is account-level chrome,
 * like the theme toggle, not a new section of the product.
 */
function NotificationBell() {
  const session = useSession();
  const unread = useUnreadCount(Boolean(session.data));
  const count = unread.data ?? 0;
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  return (
    <Link
      to="/notifications"
      aria-label={label}
      title={label}
      className={`${ON_BAR} relative inline-flex h-11 w-11 items-center justify-center rounded-md sm:h-8 sm:w-8`}
    >
      <Bell aria-hidden className="size-4" />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-state-danger px-1 text-100 font-bold leading-4 text-primary-foreground tabular-nums"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
