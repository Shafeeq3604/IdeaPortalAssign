import { hash, verify } from "@node-rs/argon2";
import { timingSafeEqual } from "node:crypto";

/**
 * Password hashing and verification (ADR-023, NFR-01).
 *
 * Argon2id, at the reference parameters for a server doing interactive logins. Nothing
 * here is configurable at runtime on purpose: hashing parameters are a security decision,
 * and a security decision that can be weakened by an environment variable will be.
 */

/**
 * OWASP's current reference for Argon2id: 19 MiB, 2 iterations, 1 degree of parallelism.
 * Memory cost is the parameter that actually resists GPU attack, so it is the one not to
 * economise on.
 */
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * A real Argon2id hash of a value nobody knows, used to burn the same CPU on an unknown
 * email as on a known one.
 *
 * Without it, "no such user" returns in microseconds and "wrong password" takes ~50ms,
 * which tells an attacker which emails are registered. Generated once at module load.
 */
const decoyHash = await hash("account-enumeration-decoy", PARAMS);

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PARAMS);
}

/**
 * Verify a password, in constant-ish time whether or not the account exists.
 *
 * Pass `null` when there is no user: the decoy is still verified, so the timing of a
 * failed sign-in does not disclose whether the email is registered.
 */
export async function verifyPassword(
  storedHash: string | null,
  plaintext: string,
): Promise<boolean> {
  if (storedHash === null) {
    await verify(decoyHash, plaintext).catch(() => false);
    return false;
  }
  try {
    return await verify(storedHash, plaintext);
  } catch {
    // A malformed hash in the database is a failed login, never a thrown 500 that tells
    // the caller something about the stored value.
    return false;
  }
}

/**
 * Password rules (NFR-01).
 *
 * Length only. Composition rules — a digit, a symbol, mixed case — measurably push people
 * towards `Password1!` and towards reuse, and NIST dropped them for that reason. Twelve
 * characters with no other constraint is both stronger in practice and easier to comply
 * with honestly.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(plaintext: string): string | null {
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase works well.`;
  }
  if (plaintext.length > 200) {
    // Argon2 costs scale with input; an unbounded password is a cheap way to make the
    // server do expensive work.
    return "That is longer than 200 characters.";
  }
  return null;
}

/** Constant-time compare for opaque tokens. Not for passwords — those go through Argon2. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
