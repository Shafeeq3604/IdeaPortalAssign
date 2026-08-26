import type { Role } from "@iep/contracts";

/**
 * Authentication provider seam (P1, assumption A1).
 *
 * A1 — "one OIDC identity provider exists" — is still unanswered, so P1 ships two
 * implementations behind one interface:
 *
 *   DevAuthProvider   — picks a seeded user. Local development only; REFUSES to construct
 *                       when NODE_ENV is production. No password, no token, no pretence
 *                       of being real auth.
 *   OidcAuthProvider  — the real thing. Throws a clear, actionable error until an issuer
 *                       is configured, rather than half-working.
 *
 * Everything downstream (sessions, policy, routes) depends on this interface, so
 * answering A1 is a provider swap, not a rewrite.
 */

export interface AuthenticatedIdentity {
  /** Stable subject from the IdP. Maps to users.external_subject. */
  readonly externalSubject: string;
  readonly email: string;
  readonly displayName: string;
  /** Group claims, mapped to roles by the identity module. */
  readonly groups: readonly string[];
}

export interface AuthProvider {
  readonly kind: "dev" | "oidc";
  /** Where to send the browser to begin sign-in. */
  authorizationUrl(state: string): string;
  /** Exchange whatever came back for an identity. */
  completeLogin(input: Readonly<Record<string, string>>): Promise<AuthenticatedIdentity>;
}

export class DevAuthProvider implements AuthProvider {
  readonly kind = "dev" as const;

  constructor(nodeEnv: string) {
    if (nodeEnv === "production") {
      // Never let the dev bypass exist in production, even by misconfiguration.
      throw new Error("DevAuthProvider must not be constructed in production (SPEC §4.1)");
    }
  }

  authorizationUrl(): string {
    return "/auth/dev/login";
  }

  completeLogin(input: Readonly<Record<string, string>>): Promise<AuthenticatedIdentity> {
    const email = input["email"];
    if (!email) throw new Error("dev login requires an email of a seeded user");
    return Promise.resolve({
      externalSubject: `dev|${email}`,
      email,
      displayName: email,
      groups: [],
    });
  }
}

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export class OidcAuthProvider implements AuthProvider {
  readonly kind = "oidc" as const;

  constructor(private readonly config: OidcConfig) {}

  authorizationUrl(state: string): string {
    const url = new URL(`${this.config.issuer}/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", "openid email profile groups");
    url.searchParams.set("state", state);
    return url.toString();
  }

  completeLogin(): Promise<AuthenticatedIdentity> {
    // Authorization Code + PKCE token exchange and JWKS validation land when A1 is
    // answered and a real issuer exists to test against. Failing loudly beats a
    // half-implemented exchange that appears to work against a mock.
    throw new Error(
      "OIDC login is not wired yet: assumption A1 (SPEC §17.10) is unanswered. " +
        "Set AUTH_PROVIDER=dev for local development, or provide a real issuer.",
    );
  }
}

/**
 * Group-claim → role mapping. Deliberately explicit and deny-by-default: an unrecognised
 * group grants nothing, and every user gets EMPLOYEE so nobody is left without a role.
 */
export function rolesFromGroups(groups: readonly string[]): readonly Role[] {
  const map: Record<string, Role> = {
    "iep-reviewers": "REVIEWER",
    "iep-admins": "ADMIN",
    "iep-management": "MANAGEMENT",
  };
  const roles = new Set<Role>(["EMPLOYEE"]);
  for (const g of groups) {
    const role = map[g.toLowerCase()];
    if (role) roles.add(role);
  }
  return [...roles];
}
