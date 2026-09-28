import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bell, CheckCheck, Mail } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Skeleton, Switch,
} from "@iep/ui";
import type { NotificationItem } from "@iep/contracts";
import { PageHeading } from "../../app/PageHero";
import { ago } from "../../app/relative-time";
import {
  useMarkRead, useNotificationPreferences, useNotifications, useUpdateNotificationPreferences,
} from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Notification centre (P13 — FR-28). Every notification is about one of the reader's own
 * ideas, and the whole row opens it (SPEC §6.3's "whole row navigates"). Opening one
 * marks it read; "Mark all read" clears the bell. The unread filter and page live in the
 * URL (§7.8), so Back restores them.
 */
export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const unread = params.get("unread") === "true";
  const list = useNotifications({ page, unread });
  const markRead = useMarkRead();

  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next);
  };

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link>  ›  Notifications
      </nav>
      <PageHeading
        icon={Bell}
        heading="Notifications"
        description="Updates about your ideas and the ones you follow — analysis finishing, stage changes, reviews, decisions, new comments and @mentions."
        actions={
          <Button
            variant="outline"
            disabled={!list.data || list.data.unreadCount === 0 || markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            <CheckCheck aria-hidden className="size-4" />
            Mark all read
          </Button>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] [&>*]:min-w-0">
        <section aria-label="Notifications">
          <div className="mb-3 flex items-center gap-2">
            <Button
              variant={unread ? "outline" : "default"} size="sm" className="rounded-full"
              onClick={() => update((n) => { n.delete("unread"); n.delete("page"); })}
            >
              All
            </Button>
            <Button
              variant={unread ? "default" : "outline"} size="sm" className="rounded-full"
              onClick={() => update((n) => { n.set("unread", "true"); n.delete("page"); })}
            >
              Unread{list.data ? ` (${list.data.unreadCount})` : ""}
            </Button>
          </div>
          <List
            query={list}
            unread={unread}
            onOpen={(n) => { if (!n.readAt) markRead.mutate([n.id]); }}
          />
          {list.data && list.data.meta.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update((n) => n.set("page", String(page - 1)))}>
                Previous
              </Button>
              <span className="text-200 text-muted-foreground tabular-nums">
                Page {page} of {list.data.meta.totalPages}
              </span>
              <Button size="sm" disabled={page >= list.data.meta.totalPages} onClick={() => update((n) => n.set("page", String(page + 1)))}>
                Next
              </Button>
            </div>
          ) : null}
        </section>
        <Preferences />
      </div>
    </main>
  );
}

function List({
  query, unread, onOpen,
}: {
  query: ReturnType<typeof useNotifications>;
  unread: boolean;
  onOpen: (n: NotificationItem) => void;
}) {
  if (query.isPending) {
    return (
      <div className="grid gap-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        title="Could not load your notifications"
        description="Your ideas are unaffected — this is the list failing to load."
        onRetry={() => void query.refetch()}
        escapeTo={{ label: "Go to my ideas", to: "/me/ideas" }}
        renderLink={link}
      />
    );
  }
  if (query.data.items.length === 0) {
    return (
      <EmptyState
        title={unread ? "You're all caught up" : "No notifications yet"}
        description={
          unread
            ? "Nothing unread. Everything you've been told about is in the All view."
            : "You'll hear here when your ideas are analysed, moved, reviewed or decided on."
        }
        action={{ label: "Go to my ideas", to: "/me/ideas" }}
        renderLink={link}
      />
    );
  }
  return (
    <ul className="grid gap-2">
      {query.data.items.map((n) => (
        <li key={n.id}>
          <Link
            to={n.href}
            onClick={() => onOpen(n)}
            className={`flex gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted ${n.readAt ? "bg-card" : "bg-accent-050"}`}
          >
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent-600"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className={`text-300 ${n.readAt ? "font-medium" : "font-semibold"}`}>
                  {n.title}
                  {n.readAt ? null : <span className="sr-only"> (unread)</span>}
                </span>
                <time dateTime={n.createdAt} className="text-100 text-muted-foreground">{ago(n.createdAt)}</time>
              </span>
              <span className="mt-0.5 block text-200 text-muted-foreground">{n.body}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Preferences() {
  const prefs = useNotificationPreferences();
  const save = useUpdateNotificationPreferences();
  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail aria-hidden className="size-4" />
          Email me about
        </CardTitle>
        <p className="text-200 text-muted-foreground">
          These always appear here. Choose which ones also arrive by email, if your
          organisation has email delivery set up.
        </p>
      </CardHeader>
      <CardContent>
        {prefs.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : prefs.isError ? (
          <p className="text-200 text-muted-foreground">Could not load your email preferences.</p>
        ) : (
          <ul className="grid gap-4">
            {prefs.data.items.map((p) => (
              <li key={p.event} className="flex items-start justify-between gap-3">
                <span>
                  <label htmlFor={`pref-${p.event}`} className="block text-200 font-medium">{p.label}</label>
                  <span className="block text-100 text-muted-foreground">{p.description}</span>
                </span>
                <Switch
                  id={`pref-${p.event}`}
                  checked={p.emailEnabled}
                  disabled={save.isPending}
                  onCheckedChange={(checked) => save.mutate({ items: [{ event: p.event, emailEnabled: checked }] })}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
