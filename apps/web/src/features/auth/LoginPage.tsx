import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, Eye, EyeOff, FileText, Lightbulb, ListChecks, ScanSearch, Scale, Users,
} from "lucide-react";
import { Button, Input, Label } from "@iep/ui";
import type { SessionResponse } from "@iep/contracts";
import { ApiError, api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { ThemeToggle } from "../../app/theme";
import { PRODUCT_NAME, PRODUCT_SHORT } from "../../app/product";

/**
 * Sign-in (ADR-023).
 *
 * Replaces the P0 development stand-in — a list of seeded users as buttons, with no
 * credential — which was the first screen anyone saw and read as an unfinished tool.
 *
 * Split layout: what the product is on the left, the way in on the right. The left panel
 * is the only marketing surface in the whole application, and it exists because somebody
 * arriving at a link needs to know what they have been sent to before they type a
 * password into it.
 */

const WHAT_IT_DOES = [
  {
    icon: Lightbulb,
    title: "Share an idea in your own words",
    body: "No form to decode and no jargon. Write it the way you would say it.",
  },
  {
    icon: ScanSearch,
    title: "The platform works it out",
    body: "It restates your idea, finds where it applies, and says what is missing.",
  },
  {
    icon: Scale,
    title: "Scored on published criteria",
    body: "Every number is explained, and the rules behind it are public.",
  },
  {
    icon: Users,
    title: "People make the decisions",
    body: "AI describes. Reviewers decide, and their reasons are on the record.",
  },
] as const;

/** The employee's journey, in the four words REQUIREMENTS §33 uses for it. */
const JOURNEY = [
  { icon: FileText, label: "Submit" },
  { icon: ScanSearch, label: "Understand" },
  { icon: ListChecks, label: "Review" },
  { icon: ArrowRight, label: "Track" },
] as const;

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [reveal, setReveal] = React.useState(false);

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
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* ── what this is ── */}
      <section className="hidden flex-col justify-between bg-muted/40 p-10 lg:flex xl:p-14">
        <div>
          <p className="text-100 font-medium uppercase tracking-widest text-muted-foreground">
            Sage IT · Internal platform
          </p>
          <h1 className="mt-6 max-w-lg text-700 font-semibold leading-tight">
            {PRODUCT_NAME}
          </h1>
          <p className="mt-4 max-w-md text-300 text-muted-foreground">
            Tell the organisation what could be better. The platform structures it, scores
            it against published criteria, and shows its working.
          </p>
        </div>

        <ul className="my-10 grid max-w-xl gap-3 sm:grid-cols-2">
          {WHAT_IT_DOES.map((item) => (
            <li key={item.title} className="rounded-lg border border-border bg-card p-4">
              <item.icon aria-hidden className="size-5 text-primary" />
              <p className="mt-2 text-200 font-medium">{item.title}</p>
              <p className="mt-1 text-100 text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>

        <div>
          <p className="text-100 font-medium uppercase tracking-widest text-muted-foreground">
            How it works
          </p>
          <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3">
            {JOURNEY.map((step, i) => (
              <li key={step.label} className="flex items-center gap-2">
                <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                  <step.icon aria-hidden className="size-3.5 text-primary" />
                  <span className="text-100 font-medium">{step.label}</span>
                </span>
                {i < JOURNEY.length - 1 ? (
                  <span aria-hidden className="text-muted-foreground">›</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── the way in ── */}
      <section className="flex flex-col p-6 sm:p-10">
        <div className="flex items-center justify-end gap-2">
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            {/* Only shown where the brand panel is hidden, so the page still says what it is. */}
            <p className="mb-2 text-100 font-medium uppercase tracking-widest text-muted-foreground lg:hidden">
              Sage IT · Internal platform
            </p>
            <h2 className="text-500 font-semibold lg:text-600">Sign in</h2>
            <p className="mt-1 text-200 text-muted-foreground lg:hidden">{PRODUCT_NAME}</p>
            <p className="mt-1 hidden text-200 text-muted-foreground lg:block">
              Use your {PRODUCT_SHORT} account.
            </p>

            <form
              className="mt-8 space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                signIn.mutate({ email: email.trim(), password });
              }}
            >
              <div>
                <Label htmlFor="field-email">Email address</Label>
                <Input
                  id="field-email"
                  type="email"
                  autoComplete="username"
                  required
                  placeholder="you@sageitinc.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="field-password">Password</Label>
                <div className="relative mt-1.5">
                  <Input
                    id="field-password"
                    type={reveal ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  {/*
                    A reveal toggle, because forcing someone to retype a long password they
                    cannot see is how people end up choosing short ones.
                  */}
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  >
                    {reveal ? (
                      <EyeOff aria-hidden className="size-4" />
                    ) : (
                      <Eye aria-hidden className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {message ? (
                <p role="alert" className="text-200 text-destructive">
                  {message}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={signIn.isPending}>
                {signIn.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <p className="mt-6 text-100 text-muted-foreground">
              No account, or locked out? Your administrator can set one up or reset your
              password.
            </p>
          </div>
        </div>

        <p className="text-center text-100 text-muted-foreground">
          Confidential — internal use only
        </p>
      </section>
    </div>
  );
}
