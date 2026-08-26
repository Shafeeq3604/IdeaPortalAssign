import * as React from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";

/**
 * EmptyState / ErrorState — SPEC §6.3 assertion 3, "no dead-ends".
 *
 * Implemented at P0 rather than P1 because the rule is only real if it is impossible to
 * break: both components REQUIRE a way out in their props, so a dead end does not compile.
 * The remaining nine custom components stay as frozen signatures until P1.
 *
 * The `to` props are plain strings, not router Links — @iep/ui stays router-agnostic.
 * Apps pass a `renderLink` so this package never depends on react-router.
 */

export type LinkRenderer = (props: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) => React.ReactElement;

const defaultLink: LinkRenderer = ({ to, children, className }) => (
  <a href={to} className={className}>
    {children}
  </a>
);

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  /** Required. An empty state with nothing to do next is a dead end. */
  readonly action: { readonly label: string; readonly to: string };
  readonly icon?: React.ReactNode;
  readonly renderLink?: LinkRenderer;
  readonly className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  renderLink = defaultLink,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center shadow-e1",
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h2 className="text-400 font-semibold text-foreground">{title}</h2>
      <p className="max-w-prose text-200 text-muted-foreground">{description}</p>
      <Button asChild className="mt-2">
        {renderLink({ to: action.to, children: action.label })}
      </Button>
    </div>
  );
}

export interface ErrorStateProps {
  readonly title: string;
  readonly description: string;
  /** Required — both of them. A retry alone still traps the user if retrying keeps failing. */
  readonly onRetry: () => void;
  readonly escapeTo: { readonly label: string; readonly to: string };
  /** Surfaced so a user-reported error is greppable against server logs (SPEC §7.8). */
  readonly requestId?: string | undefined;
  readonly renderLink?: LinkRenderer;
  readonly className?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  escapeTo,
  requestId,
  renderLink = defaultLink,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center shadow-e1",
        className,
      )}
    >
      <h2 className="text-400 font-semibold text-foreground">{title}</h2>
      <p className="max-w-prose text-200 text-muted-foreground">{description}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={onRetry}>Try again</Button>
        <Button asChild variant="outline">
          {renderLink({ to: escapeTo.to, children: escapeTo.label })}
        </Button>
      </div>
      {requestId ? (
        <p className="mt-2 text-100 text-muted-foreground">
          Reference: <code className="tabular">{requestId}</code>
        </p>
      ) : null}
    </div>
  );
}
