import { Link, useLocation } from "react-router-dom";
import { Bell, Compass, Home, Plus, User } from "lucide-react";
import { useSession } from "./use-session";
import { useUnreadCount } from "../features/notifications/api";

/**
 * The phone's bottom tab bar (P20 — SPEC §14 M4, D-25). Below `md` only.
 *
 * Not a new navigation list: every destination here already sits in the header or the
 * sidebar (REQUIREMENTS §20 keeps the main navigation small). Home is the brand link,
 * Alerts is the bell. What changes is reach — a thumb gets there without opening the
 * menu first.
 */

const TABS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/ideas", label: "Explore", icon: Compass },
  { to: "/ideas/new", label: "Submit", icon: Plus, primary: true },
  { to: "/me/ideas", label: "My ideas", icon: User },
  { to: "/notifications", label: "Alerts", icon: Bell },
] as const;

function isActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  if (to === "/ideas") {
    // Explore owns the idea pages too, but not the two tabs that start with /ideas/new.
    return (pathname === "/ideas" || pathname.startsWith("/ideas/")) && !pathname.startsWith("/ideas/new");
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function MobileTabBar() {
  const { pathname } = useLocation();
  const session = useSession();
  const unread = useUnreadCount(Boolean(session.data));
  const count = unread.data ?? 0;

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-e3 backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-lg list-none grid-cols-5 p-0">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.to);
          const label = tab.to === "/notifications" && count > 0 ? `${tab.label}, ${count} unread` : tab.label;
          return (
            <li key={tab.to}>
              <Link
                to={tab.to}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-100 font-semibold no-underline ${
                  active ? "text-accent-700" : "text-muted-foreground"
                }`}
              >
                {"primary" in tab ? (
                  <span
                    aria-hidden
                    className="grid size-10 place-items-center rounded-full bg-grad-highlight text-grad-from shadow-e2"
                  >
                    <tab.icon className="size-5" />
                  </span>
                ) : (
                  <span aria-hidden className="relative">
                    <tab.icon className="size-5" />
                    {tab.to === "/notifications" && count > 0 ? (
                      <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-state-danger px-1 text-100 font-bold leading-4 text-primary-foreground tabular-nums">
                        {count > 99 ? "99+" : count}
                      </span>
                    ) : null}
                  </span>
                )}
                {"primary" in tab ? <span className="sr-only">{tab.label}</span> : <span aria-hidden>{tab.label}</span>}
                {active && !("primary" in tab) ? (
                  <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent-600" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
