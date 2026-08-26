import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState } from "@iep/ui";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * Sign-in (FR-01).
 *
 * Assumption **A1** (an OIDC provider exists) is unanswered, so this renders the dev
 * provider's user picker. When A1 is answered, this page becomes a single "Sign in with
 * <IdP>" button and the picker disappears with the provider — nothing else changes,
 * because everything downstream depends on the session, not on how it was obtained.
 */

interface DevUser {
  email: string;
  displayName: string;
  roles: string[];
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const queryClient = useQueryClient();
  const returnTo = location.state?.from ?? "/ideas";

  const devUsers = useQuery({
    queryKey: ["dev-users"],
    queryFn: () => api<{ users: DevUser[] }>("/auth/dev/users"),
    retry: false,
  });

  const login = useMutation({
    mutationFn: (email: string) =>
      api<{ ok: true }>("/auth/dev/login", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
      navigate(returnTo, { replace: true });
    },
  });

  if (devUsers.isError) {
    const notConfigured =
      devUsers.error instanceof ApiError && devUsers.error.status === 404;
    return (
      <main className="page">
        <ErrorState
          title={notConfigured ? "Sign-in is not configured" : "Could not reach the server"}
          description={
            notConfigured
              ? "No identity provider is configured yet (assumption A1). Set AUTH_PROVIDER=dev and run `pnpm db:seed` for local development."
              : "The API did not respond. Check that it is running on port 3001."
          }
          onRetry={() => void devUsers.refetch()}
          escapeTo={{ label: "Data & AI notice", to: "/help/data-and-ai" }}
          renderLink={({ to, children, className }) => (
            <Link to={to} className={className}>
              {children}
            </Link>
          )}
        />
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: "32rem" }}>
      <h1>Sign in</h1>
      <p className="muted">Employee Idea Evaluation &amp; Innovation Platform</p>

      <Card>
        <CardHeader>
          <CardTitle>Development sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-200 text-muted-foreground">
            No identity provider is connected yet. Pick a seeded user to sign in as — each
            has a different role, so you can walk the permission model.
          </p>

          {devUsers.isPending ? (
            <p className="text-200 text-muted-foreground">Loading users…</p>
          ) : (
            <ul className="space-y-2">
              {devUsers.data?.users.map((u) => (
                <li key={u.email}>
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    disabled={login.isPending}
                    onClick={() => login.mutate(u.email)}
                  >
                    <span>{u.displayName}</span>
                    <span className="text-100 text-muted-foreground">{u.roles.join(" · ")}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {login.isError ? (
            <p role="alert" className="text-200 text-destructive">
              {login.error instanceof ApiError ? login.error.body.message : "Sign-in failed"}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
