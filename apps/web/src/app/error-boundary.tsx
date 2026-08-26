import * as React from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "@iep/ui";

/**
 * Route-level error boundary (P0 deliverable 5c, SPEC §7.8 tier 1).
 *
 * SPEC §6.3 assertion 3 ("no dead-ends") applies to crashes too, not just empty lists.
 * A blank white screen is the worst dead end there is, so every route is wrapped and a
 * crash still renders a retry AND a route out.
 *
 * Panel-level boundaries (tier 2) arrive with the panels themselves in P1 — a failed
 * risk-analysis panel must not blank the whole idea page.
 */

interface Props {
  readonly children: React.ReactNode;
  /** Changing this resets the boundary — pass the pathname so navigating clears an error. */
  readonly resetKey?: string;
}

interface State {
  readonly error: Error | null;
}

export class RouteErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // P1 wires this to the telemetry sink with the requestId (SPEC §3.6).
    console.error("[route-error]", error, info.componentStack);
  }

  private readonly retry = (): void => this.setState({ error: null });

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="page">
        <ErrorState
          title="Something went wrong on this page"
          description={
            "The page could not be displayed. Trying again often works; if it does not, " +
            "you can go back to your ideas and carry on from there."
          }
          onRetry={this.retry}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={({ to, children, className }) => (
            <Link to={to} className={className}>
              {children}
            </Link>
          )}
        />
      </main>
    );
  }
}
