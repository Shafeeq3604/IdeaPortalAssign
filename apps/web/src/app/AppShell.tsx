import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown, Compass, LayoutDashboard, ListChecks, LogOut, PenSquare, Settings,
  Trophy, User,
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
}

const PRIMARY: readonly NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["MANAGEMENT", "ADMIN"] },
  { to: "/ideas/new", label: "Submit an idea", icon: PenSquare, roles: [] },
  { to: "/ideas", label: "Explore ideas", icon: Compass, roles: [] },
  { to: "/me/ideas", label: "My ideas", icon: User, roles: [] },
];

const PRIVILEGED: readonly NavItem[] = [
  { to: "/review", label: "Reviews", icon: ListChecks, roles: ["REVIEWER", "ADMIN"] },
  { to: "/rankings", label: "Rankings", icon: Trophy, roles: [] },
  { to: "/admin/users", label: "Administration", icon: Settings, roles: ["ADMIN"] },
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
          ? "relative flex items-center gap-3 rounded-lg bg-accent px-3 py-2 text-200 font-semibold text-accent-foreground shadow-e1 before:absolute before:inset-y-1.5 before:-left-px before:w-1 before:rounded-full before:bg-primary before:content-['']"
          : "relative flex items-center gap-3 rounded-lg px-3 py-2 text-200 text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-muted hover:text-foreground"
      }
    >
      <item.icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

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
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-100 font-medium text-primary-foreground">
          {initials}
        </span>
        <span className="hidden text-200 sm:inline">{data.user.displayName}</span>
        <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-lg border border-border bg-popover p-1 shadow-e3"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-200 font-medium">{data.user.displayName}</p>
            <p className="text-100 text-muted-foreground">{data.user.email}</p>
            <p className="mt-1 text-100 text-muted-foreground">
              {data.user.roles.join(" · ")}
              {data.user.department ? ` · ${data.user.department.name}` : ""}
            </p>
          </div>
          <Link
            to="/help/data-and-ai"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 text-200 hover:bg-muted"
          >
            How your data is handled
          </Link>
          {/*
            Sign out lives here, where every application on earth puts it. It existed
            before, buried in a grey card in the sidebar, and was reported as missing —
            which is what "not discoverable" looks like from the outside.
          */}
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-200 hover:bg-muted"
          >
            <LogOut aria-hidden className="size-4" />
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </button>
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
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background px-4">
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
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-100 font-semibold text-primary-foreground">
            IP
          </span>
          {/* Full name where there is room; the short form only when there is not. */}
          <span className="hidden truncate text-200 font-semibold xl:inline">{PRODUCT_NAME}</span>
          <span className="truncate text-200 font-semibold xl:hidden">{PRODUCT_SHORT}</span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_1fr]">
        <aside className="hidden border-r border-border lg:block">{nav}</aside>
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
