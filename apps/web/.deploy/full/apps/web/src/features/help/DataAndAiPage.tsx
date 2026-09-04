import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@iep/ui";

/**
 * Data & AI notice (P9 — SPEC §4.5, NFR-02).
 *
 * Linked from the submission form, because that is the moment somebody decides how much
 * to write. Two things it must do and does:
 *
 *  - say plainly what leaves the building, and what does not
 *  - say what the AI is NOT allowed to do, because the product's whole claim is that a
 *    machine describes and a person decides
 *
 * Written to be read by whoever is submitting, not by a lawyer. Where a number is stated
 * it matches what the code enforces; if one changes, this page changes with it.
 */
export function DataAndAiPage() {
  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  Data &amp; AI notice
      </nav>
      <h1>How your idea is handled</h1>
      <p className="muted">
        Plain version: your idea text is analysed by an AI service outside this network.
        Your name, email and employee id are not sent with it. No AI decides anything.
      </p>

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader><CardTitle>What is sent for analysis</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-200">
              The words you write — the title, the problem, the description, who would use
              it, what would change, and any optional fields you fill in. That text is sent
              to Anthropic, which analyses it and sends back a structured description.
            </p>
            <p className="text-200">
              <strong>Not sent:</strong> your name, your email address, your employee id,
              or your department. The analysis does not know whose idea it is.
            </p>
            <p className="text-200">
              Before the text is sent, an automatic pass removes anything that looks like
              an email address, a phone number, or an identifier — even if you typed it
              into the description. Whether that pass changed anything is recorded against
              the analysis.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>What the AI is not allowed to do</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-200">
              It never produces a score, a rank or a percentage. It describes your idea in
              bands — low, moderate, high — and a separate, deterministic engine turns
              those into numbers using{" "}
              <Link to="/config/criteria">published criteria</Link> and{" "}
              <Link to="/config/profiles">published weights</Link>. Run the same analysis
              twice and you get the same number, because the number is arithmetic.
            </p>
            <p className="text-200">
              It never approves, rejects or prioritises anything. Every decision on this
              platform is made by a person, recorded with their name and their reason.
            </p>
            <p className="text-200">
              Anything an AI wrote is marked as such wherever it appears, and stays marked
              until a human has checked it.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>What is stored, and for how long</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-200">
              <li>Your idea and every version of it, while you are here and for 24 months after.</li>
              <li>Evaluations, reviews and decisions, alongside the idea.</li>
              <li>The audit trail of who did what: 7 years. It cannot be edited or deleted.</li>
              <li>
                The raw request and response exchanged with the AI service: 90 days, then
                reduced to metadata — which model, how many tokens, what it cost.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Who can see your idea</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-200">
              Your drafts are yours alone. Once submitted, an idea is visible to
              colleagues, reviewers and management — that is the point of the platform.
              Reviewers cannot review their own ideas, and any adjustment a reviewer makes
              to a score carries their name and their reason, visible to you.
            </p>
            <p className="text-200">
              You can see every decision made about your idea on its Review tab, and every
              recorded action in the <Link to="/admin/audit">audit log</Link> if your role
              allows.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>If something looks wrong</CardTitle></CardHeader>
          <CardContent>
            <p className="text-200">
              The analysis can be wrong — it is a description written by a machine from
              what you wrote. If it has misunderstood your idea, the most effective fix is
              usually to{" "}
              <Link to="/ideas">revise the idea</Link> and say the missing part
              explicitly; the Improve tab lists what the platform thinks is missing. If a
              score looks wrong rather than the description, a reviewer can adjust it, and
              their reason is recorded next to the change.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
