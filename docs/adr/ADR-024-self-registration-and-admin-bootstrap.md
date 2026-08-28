# ADR-024 — Self-registration, and how the first administrator is created

- **Status:** Accepted
- **Date:** 2026-08-28
- **Amends:** ADR-023 (email + password authentication). Does not supersede it.
- **Requirements:** requirements.md §22 (Security and Privacy), §29 (MVP)

## Context

ADR-023 decided that accounts are created by an administrator, with no self-service path.
That was the right call for a seeded demo and the wrong one for a pilot: an internal
platform that a colleague cannot join without filing a request is a platform that gets
tried by the four seeded accounts and nobody else.

Two things had to be decided together, because deciding them apart is how privilege
escalation gets built by accident:

1. **Can a person create their own account?**
2. **How does the first administrator exist on a fresh installation** — the one that has
   no administrator to create one?

Question 2 is the awkward one. The seed creates an admin, which is fine for development
and useless for a real deployment, where the seed is not run.

## Decision

**Anyone may create their own account. It is always an ordinary employee, and there is no
field on the request that could say otherwise.**

Not "the handler ignores a role field" — the field does not exist in `SignupRequest`. Zod
strips it, the handler cannot read it, and no future refactor can accidentally honour it.
A flow test posts `roles: ["ADMIN"]` at the endpoint and asserts the account comes back as
`["EMPLOYEE"]`.

**The first administrator is created with a one-off invite code, and that window closes
permanently.**

`ADMIN_INVITE_CODE` grants ADMIN at signup only while the database contains **no active
administrator**. The check runs twice — once before the transaction and once inside it —
so two people racing to bootstrap produce one administrator and one rejection, not two
administrators. After that the code is inert: presenting it is refused outright rather
than quietly downgraded, because somebody holding a code that no longer works needs to be
told.

Every administrator after the first is promoted by an existing one, through
`PATCH /admin/users/:id`, which writes an audit row naming who did it.

**Two switches, because "who may join" is a deployment decision, not a code decision.**

- `SIGNUP_ALLOWED_EMAIL_DOMAINS` — a comma-separated allowlist. **Empty means any domain.**
- `SIGNUP_ENABLED` — turns self-registration off entirely.

## Options considered

**A. Keep it administrator-only (ADR-023 as written).**
Safest, and the reason it was rejected is not convenience: a pilot whose first step is
"email someone for an account" measures the patience of volunteers rather than the
usefulness of the product. It also leaves the fresh-deployment problem unsolved — there
would still have to be some bootstrap path, so the hard question is not avoided, only
postponed.

**B. Self-registration with a role picker, and an approval queue.**
Rejected. It puts "make me an admin" in front of the person least equipped to evaluate it
and creates a queue somebody has to remember to check. An unread approval queue approves
by exhaustion.

**C. Self-registration as EMPLOYEE only, plus a bootstrap code that expires on first use.**
Chosen. The privileged path is a shared secret, which is a weak credential — so it is
scoped to the one moment when there is nothing to protect: an installation with no
administrator has no accounts and no ideas. The strength of the guardrail is not the
secrecy of the code, it is that the code is only live against an empty building.

**D. Bootstrap through a CLI command instead of a code.**
Genuinely good, and better on a machine you can SSH into. Rejected because this deploys as
a container where running a one-off command is a different and less reliable operation
than filling in a field, and because the code path is testable through the same HTTP
surface as everything else.

## Consequences

**Good**

- A colleague with the link can be submitting an idea in a minute.
- The escalation path is a contract-level impossibility, not a handler-level check.
- A fresh deployment has a first administrator without a seeded password in a repo.
- The domain allowlist gives an organisation one line of configuration for "who is us".

**Bad, and accepted**

- **The empty default is the risky one.** With no allowlist, anyone who can reach the URL
  can register and read every submitted idea. `.env.example` says so in capitals and the
  sign-up page shows the allowlist when one is set — but the default is open, because the
  alternative default locks out every organisation whose mail domain we cannot know.
  **Set `SIGNUP_ALLOWED_EMAIL_DOMAINS` before this is reachable from the internet.**
- **Self-registered people have no department**, so they do not appear in department
  filters or the management dashboard until an administrator sets one. Self-declaring it
  would put a guess into leadership's reporting as fact.
- **`GET /auth/signup-options` is public** — the third public endpoint, after `getHealth`
  and `login`. It returns two booleans and the allowlist: no accounts, no names, no counts.
  `adminBootstrapAvailable` is true only on an installation with nothing yet to protect.
  The contract test asserts that no public endpoint's response schema contains a
  person-shaped field, so the next convenience field added here fails the build.
- **There is still no password reset.** An administrator sets a new one, which also clears
  the lockout. Self-service reset needs email delivery, which this deployment does not have.

## Note on the audit trail

An ordinary self-registration is **not** written to the audit log. The account row and its
`createdAt` already record it, and a governance trail full of "someone signed up" buries
the decisions it exists for — the same argument that keeps thumbs up and down out of it.

Creating the **first administrator** is audited, because that one is a decision somebody
took.

This is not only an editorial judgement. `audit_log` is append-only by trigger and its
actor foreign key is `Restrict`, so **an audited account can never be deleted**. That is
correct for an administrator and wrong as a blanket rule for everyone who ever filled in
the sign-up form.
