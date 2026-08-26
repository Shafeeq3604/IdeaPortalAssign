import { Link } from "react-router-dom";
import type { Role } from "@iep/contracts";

interface RoutePlaceholderProps {
  readonly routeId: string;
  readonly title: string;
  readonly path: string;
  readonly roles: readonly Role[];
  readonly renders: readonly string[];
  readonly searchParams?: readonly string[] | undefined;
  readonly backPath: string | null;
  readonly crumbs: readonly string[];
}

/**
 * A placeholder that shows what the navigation map says about this route.
 * Deliberately informative rather than blank: walking the shell is how you verify
 * the P0 nav contract by eye, alongside `pnpm test:nav`.
 */
export function RoutePlaceholder({
  routeId,
  title,
  path,
  roles,
  renders,
  searchParams,
  backPath,
  crumbs,
}: RoutePlaceholderProps) {
  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        {crumbs.join("  ›  ")}
      </nav>

      <h1>{title}</h1>
      <p className="muted">
        Placeholder — screens land in P1. This page is generated from{" "}
        <code>navigation.map.ts</code>.
      </p>

      <dl className="facts">
        <dt>Route id</dt>
        <dd><code>{routeId}</code></dd>

        <dt>Path</dt>
        <dd><code>{path}</code></dd>

        <dt>Roles</dt>
        <dd>{roles.length === 0 ? "all authenticated" : roles.join(", ")}</dd>

        <dt>Renders</dt>
        <dd>{renders.length === 0 ? "—" : renders.join(", ")}</dd>

        <dt>URL state</dt>
        <dd>{searchParams?.length ? searchParams.join(", ") : "—"}</dd>

        <dt>Back path</dt>
        <dd>
          {backPath ? <Link to={backPath}>{backPath}</Link> : <span>root</span>}
        </dd>
      </dl>
    </main>
  );
}
