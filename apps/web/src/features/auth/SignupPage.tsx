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
 * Self-registration (FR-01a).
 *
 * What this form deliberately does NOT ask for:
 *
 *  - **A role.** There is no field, and the contract has no property to carry one. A
 *    self-registered account is an employee; anything more is granted by an administrator
 *    who is named in the audit trail for granting it.
 *  - **A department.** Self-declared, it would end up in the management dashboards as
 *    fact. An administrator sets it, from the same screen where they set roles.
 *
 * The invite-code field appears only during first-run bootstrap — while the platform has
 * no administrator at all. Once one exists the server refuses the code and the field
 * disappears, so nobody is invited to guess at it.
 */

const AFTER_YOU_JOIN = [
  {
    title: "Nothing is analysed until you say so",
    /*
     * This used to read "a draft is private until you submit it". That is NOT TRUE:
     * SPEC §4.2 grants reviewers and administrators read access to every idea at any
     * status, drafts included. On a platform where people write criticism of their own
     * department, promising a privacy that does not exist is the worst kind of copy to
     * get wrong — so it says what is actually the case instead.
     */
    body: "A draft stays out of the rankings and out of the AI pipeline until you submit it. Reviewers and administrators can see it.",
  },
  {
    title: "You will see the working",
    body: "Every score comes with the criteria it was measured against and how it was reached.",
  },
  {
    title: "You can react to other people's ideas",
    body: "A thumb up or down. It is visible, it is not anonymous to the platform, and it changes no score.",
  },
] as const;

export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [inviteCode, setInviteCode] = React.useState("");

  const options = useQuery({
    queryKey: queryKeys.signupOptions(),
    queryFn: () => api<SignupOptions>("/auth/signup-options"),
    staleTime: 5 * 60_000,
  });

  const signUp = useMutation({
    mutationFn: (body: {
      displayName: string;
      email: string;
      password: string;
      inviteCode?: string;
    }) => api<SessionResponse>("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (session) => {
      queryClient.setQueryData(queryKeys.session(), session);
      navigate("/", { replace: true });
    },
  });

  const message =
    signUp.error instanceof ApiError
      ? signUp.error.message
      : signUp.error
        ? "Could not reach the server. Check your connection and try again."
        : null;

  const domains = options.data?.allowedEmailDomains ?? [];
  const bootstrap = options.data?.adminBootstrapAvailable ?? false;
  const closed = options.data ? !options.data.enabled : false;

  return (
    <WelcomeShell
      eyebrow="Create an account"
      headline={<>Start with the thing that has been bothering you for months.</>}
      standfirst={
        "You do not need a business case, a slide, or anyone's permission. Write down what is " +
        "wrong and what you would do about it — the platform does the structuring."
      }
      aside={<ContentsList items={AFTER_YOU_JOIN} />}
    >
      <h2 className="font-[family-name:var(--font-display)] text-500 font-normal">
        Your details
      </h2>
      <p className="mt-1 text-200 text-welcome-ink-soft">
        {domains.length > 0
          ? `Open to ${domains.map((d) => "@" + d).join(", ")} addresses.`
          : "Takes about a minute."}
      </p>

      {closed ? (
        <div className="mt-6">
          <WelcomeAlert>
            Self-registration is turned off here. Ask an administrator to set up an account
            for you.
          </WelcomeAlert>
        </div>
      ) : (
        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const code = inviteCode.trim();
            signUp.mutate({
              displayName: displayName.trim(),
              email: email.trim(),
              password,
              ...(code ? { inviteCode: code } : {}),
            });
          }}
        >
          <WelcomeField
            id="field-name"
            label="Your name"
            autoComplete="name"
            required
            placeholder="As colleagues would write it"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <WelcomeField
            id="field-email"
            label="Work email"
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
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            /*
              Length, and nothing else. Composition rules push people towards `Password1!`
              and towards reuse, which is why NIST dropped them — the server enforces the
              same single rule, so the hint and the validation cannot drift.
            */
            hint="At least 12 characters. A short phrase you will remember beats a short password you will not."
          />

          {bootstrap ? (
            <div className="rounded-md border border-dashed border-welcome-rule p-4">
              <WelcomeField
                id="field-invite"
                label="Administrator invite code"
                autoComplete="off"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                hint={
                  "Optional. This platform has no administrator yet, so whoever holds the " +
                  "code can create the first one. The field disappears once it exists."
                }
              />
            </div>
          ) : null}

          {message ? <WelcomeAlert>{message}</WelcomeAlert> : null}

          <WelcomeSubmit disabled={signUp.isPending}>
            {signUp.isPending ? "Creating your account…" : "Create account"}
          </WelcomeSubmit>

          <p className="text-100 text-welcome-ink-soft">
            Your name, email and the ideas you submit are visible to colleagues on this
            platform. Ideas you submit are sent to an AI model for analysis; drafts are not.
          </p>
        </form>
      )}

      <div className="mt-6 border-t border-welcome-rule pt-5 text-200 text-welcome-ink-soft">
        <p>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-welcome-accent">
            Sign in
          </Link>
          .
        </p>
      </div>
    </WelcomeShell>
  );
}
