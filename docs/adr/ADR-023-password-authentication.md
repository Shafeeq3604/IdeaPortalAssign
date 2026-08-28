---
kind: adr
id: ADR-023
status: accepted
spec_ref: IEP-SPEC.md §4.1 · requirements.md FR-01 (NFR-01)
covered: [FR-01, NFR-01]
supersedes: none
amends: IEP-SPEC.md §4.1 (authentication mechanism)
---

# ADR-023 — Admin-managed email and password authentication

## Context

SPEC §4.1 specifies OIDC. It was chosen at P0 on the reasonable assumption that an
organisation deploying this already has an identity provider, and that reusing it is
better than owning credentials.

That assumption has been blocked since P1. Assumption **A1** — issuer URL, client id,
client secret, redirect URI — was never answered, so no OIDC flow could be built or
tested. P1 shipped a development stand-in instead: a sign-in page listing four seeded
users as buttons, with no credential at all.

The stand-in was never replaced, and it is the first screen anyone sees. Shown to the
project's sponsors it read as an unfinished internal tool rather than a product, which is
what forced this decision. The problem is not cosmetic: there is genuinely no
authentication in the build today. Any visitor can become an administrator by clicking
"Ash Admin".

Constraints that shape the choice:

- The product must stand up on its own, without a dependency nobody has supplied.
- Whatever is built must not have to be thrown away when SSO does arrive.
- FR-01 requires roles to govern access; something has to create accounts and assign them,
  and today that is only the seed script.
- NFR-01 applies regardless of mechanism: credentials at rest, session handling, and
  lockout are our problem the moment we own passwords.

## Options

### Option 1: Wait for OIDC

Keep the development picker until the provider details arrive, then build §4.1 as written.

**For.** No deviation from SPEC. No password storage, so no hashing, no reset flow, no
lockout policy, and no credential breach surface. Least total work if the details arrive
soon.

**Against.** Unbounded wait on an answer already outstanding for several phases. The
product cannot be demonstrated credibly or piloted in the meantime, and "click a name to
become an admin" is not a state to leave a build in. It also defers every question about
account lifecycle — who creates users, who assigns roles — which FR-01 needs answered
whatever the mechanism.

### Option 2: Admin-managed email and password

A real sign-in form. Administrators create accounts and assign roles; passwords are hashed
with a memory-hard KDF; sessions continue to work exactly as they do now.

**For.** Self-contained — no external dependency, so the product can be demonstrated,
piloted and used. Forces the account-lifecycle work FR-01 implies. The session, role and
policy layers are untouched, because they were already built behind an `AuthProvider`
interface rather than against OIDC directly.

**Against.** We now own credentials, and everything that follows: hashing parameters,
rate limiting, lockout, and eventually reset. It is a deviation from SPEC §4.1 and needs
this record. Password auth is also weaker in practice than a corporate IdP with MFA
behind it.

### Option 3: Both, with OIDC added later

Build Option 2 now, behind the same `AuthProvider` interface the development stand-in
already uses, so an OIDC provider becomes a third implementation rather than a rewrite.

**For.** Everything from Option 2, plus nothing is discarded when A1 is answered. The
interface already exists and already has two implementations, so the shape is proven.
Organisations that want SSO and organisations that want local accounts are both served.

**Against.** Two mechanisms to keep working, and the account model has to tolerate a user
who has one and not the other. Marginally more work than Option 2 alone — though most of
that cost is paid whenever OIDC lands, not avoided by delaying.

## Decision

**Option 3.** Build admin-managed email and password now as a third `AuthProvider`
implementation, alongside the existing `dev` and the future `oidc`, selected by
`AUTH_PROVIDER`.

Specifically:

- **Argon2id** for password hashing. Memory-hard, and the current default recommendation;
  bcrypt's 72-byte truncation is a footgun we do not need to inherit.
- **The password never leaves the API.** No hash reaches a response, no hash is logged,
  and `AdminUser` in the contract has no password field to accidentally populate.
- **Sessions are unchanged.** Redis-backed, rotated on sign-in, same cookie flags. This
  ADR changes how identity is *established*, not how it is *carried*.
- **Administrators own the account lifecycle**: create, assign and change roles,
  deactivate. Deactivate rather than delete, because `audit_log` references users and is
  append-only.
- **The development provider stays** for local work and tests, and is refused outside
  development by the same guard that already refuses a provider key on the API process.

`AUTH_PROVIDER=password` becomes the default for anything demonstrable. `dev` remains
available and clearly labelled.

## Consequences

**Good.**

- The product authenticates. Today it does not, and that is the honest framing.
- FR-01's role model becomes operable by an administrator instead of a seed script.
- SSO is additive when A1 is answered — a third implementation of an interface that
  already has two.
- The sign-in screen stops advertising that this is a prototype.

**Bad, and accepted.**

- We own credential security: hashing parameters, rate limiting on sign-in, and lockout.
  Rate limiting already exists at the route layer and will be tightened for this endpoint.
- No password reset in this round. An administrator sets a new password for someone who is
  locked out. Self-service reset needs email delivery, which the platform does not have
  and which belongs with P13 (Notifications).
- No MFA. If that matters before SSO arrives, it is a separate decision.
- SPEC §4.1 no longer describes what is built. This ADR amends it; SPEC §16 gets an entry
  pointing here, and §4.1 gains a line saying the mechanism is ADR-023 with OIDC deferred
  to A1.

**Neutral.**

- The seeded demo users gain passwords so the demo still works in one step. They are
  seeded credentials in a development database, documented in RUNNING.md, and the seed
  refuses to run against `NODE_ENV=production`.
