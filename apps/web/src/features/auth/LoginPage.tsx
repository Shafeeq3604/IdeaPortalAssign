import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionResponse, SignupOptions } from "@iep/contracts";
import { ApiError, api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import {
  ContentsList, WelcomeAlert, WelcomeField, WelcomePasswordField, WelcomeShell, WelcomeSubmit,
} from "./WelcomeShell";

/**
 * Sign-in (ADR-023).
 *
 * Third version of this screen. The first was the P0 development stand-in — seeded users
 * as buttons, no credential — which was the first thing anyone saw and read as an
 * unfinished tool. The second was a two-panel layout with a feature grid, which worked but
 * looked like every other internal product's sign-in page. This one is set as a page of
 * type: a warm ground, a serif masthead, a numbered contents list, and the form as a small
 * card beside it rather than the centre of attention.
 */

/** What actually happens, in the order it happens (requirements.md §33). */
const WHAT_HAPPENS = [
  {
    title: "Write it the way you would say it",
    body: "No form to decode, no template to fill in. A paragraph is enough to start.",
  },
  {
    title: "The platform reads it back to you",
    body: "It restates the idea, says where it would apply, and names what is still missing.",
  },
  {
    title: "Scored against criteria you can read",
    body: "The same weights for every idea, published, with the arithmetic shown.",
  },
  {
    title: "A person decides, and signs their name to it",
    body: "The platform never approves or rejects anything. Reviewers do, on the record.",
  },
] as const;

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Only to decide whether to offer the link. A closed door should not advertise itself.
  const options = useQuery({
    queryKey: queryKeys.signupOptions(),
    queryFn: () => api<SignupOptions>("/auth/signup-options"),
    staleTime: 5 * 60_000,
  });

  const signIn = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api<SessionResponse>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (session) => {
      // Seed the cache so the shell renders without a second round trip.
      queryClient.setQueryData(queryKeys.session(), session);
      navigate("/", { replace: true });
    },
  });

  const message =
    signIn.error instanceof ApiError
      ? signIn.error.message
      : signIn.error
        ? "Could not reach the server. Check your connection and try again."
        : null;

  return (
    <WelcomeShell
      eyebrow="Employee ideas"
      headline={<>The best idea in the building is usually not in the room.</>}
      standfirst={
        "Somewhere in this organisation is a person who already knows how to fix the thing " +
        "everyone complains about. This is where they say so, and where it gets taken seriously."
      }
      aside={<ContentsList items={WHAT_HAPPENS} />}
    >
      <h2 className="font-[family-name:var(--font-display)] text-500 font-normal">Sign in</h2>
      <p className="mt-1 text-200 text-welcome-ink-soft">
        With the email address your organisation knows you by.
      </p>

      <form
        className="mt-6 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate({ email: email.trim(), password });
        }}
      >
        <WelcomeField
          id="field-email"
          label="Email address"
          type="email"
          autoComplete="username"
          required
          placeholder="you@sageitinc.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <WelcomePasswordField
          id="field-password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />

        {message ? <WelcomeAlert>{message}</WelcomeAlert> : null}

        <WelcomeSubmit disabled={signIn.isPending}>
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </WelcomeSubmit>
      </form>

      <div className="mt-6 border-t border-welcome-rule pt-5 text-200 text-welcome-ink-soft">
        {options.data?.enabled ? (
          <p>
            First time here?{" "}
            <Link to="/signup" className="font-medium text-welcome-accent">
              Create an account
            </Link>
            .
          </p>
        ) : (
          <p>Accounts are created by an administrator.</p>
        )}
        <p className="mt-2">
          Locked out, or forgotten your password? An administrator can reset it — there is no
          self-service reset yet.
        </p>
      </div>
    </WelcomeShell>
  );
}
