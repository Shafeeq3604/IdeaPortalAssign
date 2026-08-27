import { Link, useSearchParams } from "react-router-dom";
import {
  Badge, Button, EmptyState, ErrorState, Skeleton,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import { useSession } from "../../app/session";
import { STATUS_LABEL, parseSort, useIdeaList } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

interface Props {
  /** "mine" scopes to the signed-in user; "all" shows everything they may see. */
  readonly scope: "mine" | "all";
}

/**
 * Idea list (SPEC §6.2 rows 2, 25).
 *
 * Two contract rules are visible here:
 *   - the WHOLE ROW navigates, not just the title
 *   - filters and paging live in the URL, so Back restores them (§6.3 assertion 4)
 */
export function IdeaListPage({ scope }: Props) {
  const [params, setParams] = useSearchParams();
  const session = useSession();
  const page = Math.max(1, Number(params.get("page") ?? 1));

  const list = useIdeaList({
    page,
    ...(scope === "mine" && session.data ? { submitterId: session.data.user.id } : {}),
    ...(params.get("q") ? { q: params.get("q")! } : {}),
    sort: parseSort(params.get("sort")),
  });

  const setPage = (next: number) => {
    const p = new URLSearchParams(params);
    p.set("page", String(next));
    setParams(p); // URL, not state — Back must return to this exact view
  };

  return (
    <main className="page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1>{scope === "mine" ? "My ideas" : "Ideas"}</h1>
          <p className="muted">
            {scope === "mine"
              ? "Everything you have submitted, including drafts."
              : "Ideas you can see. Other people's appear once they have been ranked."}
          </p>
        </div>
        <Button asChild>{link({ to: "/ideas/new", children: "Submit an idea" })}</Button>
      </div>

      {list.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : list.isError ? (
        <ErrorState
          title="Could not load ideas"
          description="The list did not come back. Trying again usually works."
          onRetry={() => void list.refetch()}
          escapeTo={{ label: "Submit an idea instead", to: "/ideas/new" }}
          renderLink={link}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={scope === "mine" ? "You have not submitted anything yet" : "No ideas to show yet"}
          description={
            scope === "mine"
              ? "Ideas start as a few sentences in your own words. You can save a draft and come back to it."
              : "Once ideas are submitted and ranked, they appear here."
          }
          action={{ label: "Submit the first one", to: "/ideas/new" }}
          renderLink={link}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Idea</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted by</TableHead>
                <TableHead className="text-right">Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((idea) => (
                <TableRow key={idea.id} className="cursor-pointer">
                  {/* The link fills the cell so the whole row is the target (§6.2 row 2). */}
                  <TableCell className="p-0">
                    <Link to={`/ideas/${idea.id}/overview`} className="block px-4 py-3 font-medium">
                      {idea.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={idea.status === "DRAFT" ? "outline" : "secondary"}>
                      {STATUS_LABEL[idea.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {idea.submitter.displayName}
                  </TableCell>
                  <TableCell className="text-right tabular">v{idea.currentVersionNo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {list.data.meta.totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-200 text-muted-foreground tabular">
                Page {list.data.meta.page} of {list.data.meta.totalPages} · {list.data.meta.total} ideas
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= list.data.meta.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
