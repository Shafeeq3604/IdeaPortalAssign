import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Input, Label } from "@iep/ui";
import { Link } from "react-router-dom";

const renderLink = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

function Boom(): React.ReactElement { throw new Error("deliberate test crash"); }

/**
 * P0.0 theme check — deleted in P1.
 *
 * Exists to answer one question by eye: do shadcn components render in the IEP palette,
 * or in shadcn's defaults? If the primary button is black, the token bridge in
 * theme.css is not wired and everything built on top of it will inherit the mistake.
 */
export function ThemeCheck() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-500 font-semibold">Buttons</h2>
        <p className="mb-4 text-200 text-muted-foreground">
          Primary must be indigo (<code>--accent-600</code>, #3548C7) — not black.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-500 font-semibold">Badges</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-500 font-semibold">Card + form controls</h2>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Submit an idea</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Idea title</Label>
              <Input id="title" placeholder="Automatic receipt extraction" />
            </div>
            <Button className="w-full">Continue</Button>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 text-500 font-semibold">Evidence colours</h2>
        <p className="mb-4 text-200 text-muted-foreground">
          Direction, not verdict — teal and clay, deliberately not green/red (P-1).
        </p>
        <div className="flex flex-wrap gap-3">
          <span className="rounded-md bg-factor-up-bg px-3 py-1 text-200 text-factor-up">
            Raises the ranking
          </span>
          <span className="rounded-md bg-factor-down-bg px-3 py-1 text-200 text-factor-down">
            Lowers the ranking
          </span>
          <span className="rounded-md border border-ai-border bg-ai-surface px-3 py-1 text-200 text-ai-ink">
            AI-generated · not yet validated
          </span>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-500 font-semibold">Score ramp</h2>
        <p className="mb-4 text-200 text-muted-foreground">
          Magnitude only. No good/bad reading.
        </p>
        <div className="flex gap-2">
          <div className="h-10 w-16 rounded-md bg-ramp-1" />
          <div className="h-10 w-16 rounded-md bg-ramp-2" />
          <div className="h-10 w-16 rounded-md bg-ramp-3" />
          <div className="h-10 w-16 rounded-md bg-ramp-4" />
          <div className="h-10 w-16 rounded-md bg-ramp-5" />
        </div>
      </section>
      <section>
        <h2 className="mb-1 text-500 font-semibold">No-dead-end states</h2>
        <p className="mb-4 text-200 text-muted-foreground">
          Both require a way out in their props — a dead end does not compile.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            title="No recommendations"
            description="This idea scored above the attention threshold, so there is nothing to fix."
            action={{ label: "View the evaluation", to: "/ideas/demo-idea/evaluation" }}
            renderLink={renderLink}
          />
          <ErrorState
            title="Could not load the analysis"
            description="The analysis service did not respond."
            onRetry={() => undefined}
            escapeTo={{ label: "Back to ideas", to: "/ideas" }}
            requestId="req_01J8Z3X"
            renderLink={renderLink}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-500 font-semibold">Elevation</h2>
        <div className="flex gap-4">
          <div className="h-16 w-24 rounded-lg bg-card shadow-e1" />
          <div className="h-16 w-24 rounded-lg bg-card shadow-e2" />
          <div className="h-16 w-24 rounded-lg bg-card shadow-e3" />
          <div className="h-16 w-24 rounded-lg bg-card shadow-e4" />
        </div>
      </section>
    </div>
  );
}

/** Route rendered at /_boom to prove the route boundary catches a crash. */
export function CrashTest() { return <Boom />; }
