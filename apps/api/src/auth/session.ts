import { randomUUID, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import type { Role } from "@iep/contracts";

/**
 * Server-side sessions (SPEC §4.1).
 *
 * Server-side, not a stateless encrypted cookie, for one reason: **logout must revoke**.
 * A self-contained token cannot be withdrawn before it expires, and neither can a
 * privilege change take effect. The cookie carries an opaque id and nothing else.
 *
 * Idle timeout 8h, absolute 24h. The id rotates on login and on privilege change, so a
 * fixated session id is worthless.
 */

export const SESSION_COOKIE = "__Host-iep.sid";
const IDLE_TTL_SECONDS = 8 * 60 * 60;
const ABSOLUTE_TTL_SECONDS = 24 * 60 * 60;

export interface SessionData {
  readonly userId: string;
  readonly roles: readonly Role[];
  /** Epoch ms. Absolute expiry is measured from here and never extended. */
  readonly createdAt: number;
}

export interface SessionStore {
  create(data: SessionData): Promise<string>;
  read(id: string): Promise<SessionData | null>;
  /** Rotate the id, preserving createdAt — used on privilege change. */
  rotate(oldId: string, data: SessionData): Promise<string>;
  destroy(id: string): Promise<void>;
  destroyAllForUser(userId: string): Promise<void>;
}

const newId = (): string => `${randomUUID()}.${randomBytes(18).toString("base64url")}`;
const key = (id: string): string => `sess:${id}`;
const userKey = (userId: string): string => `sess:user:${userId}`;

function isExpired(data: SessionData): boolean {
  return Date.now() - data.createdAt > ABSOLUTE_TTL_SECONDS * 1000;
}

export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis) {}

  async create(data: SessionData): Promise<string> {
    const id = newId();
    await this.redis
      .multi()
      .set(key(id), JSON.stringify(data), "EX", IDLE_TTL_SECONDS)
      .sadd(userKey(data.userId), id)
      .expire(userKey(data.userId), ABSOLUTE_TTL_SECONDS)
      .exec();
    return id;
  }

  async read(id: string): Promise<SessionData | null> {
    const raw = await this.redis.get(key(id));
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;

    // Absolute expiry is enforced here, not by the TTL — the TTL slides on activity.
    if (isExpired(data)) {
      await this.destroy(id);
      return null;
    }
    await this.redis.expire(key(id), IDLE_TTL_SECONDS);
    return data;
  }

  async rotate(oldId: string, data: SessionData): Promise<string> {
    await this.destroy(oldId);
    return this.create(data);
  }

  async destroy(id: string): Promise<void> {
    const raw = await this.redis.get(key(id));
    if (raw) {
      const { userId } = JSON.parse(raw) as SessionData;
      await this.redis.srem(userKey(userId), id);
    }
    await this.redis.del(key(id));
  }

  async destroyAllForUser(userId: string): Promise<void> {
    const ids = await this.redis.smembers(userKey(userId));
    if (ids.length > 0) await this.redis.del(...ids.map(key));
    await this.redis.del(userKey(userId));
  }
}

/** For tests and for running the API before Redis is up. Never used in production. */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionData>();

  create(data: SessionData): Promise<string> {
    const id = newId();
    this.sessions.set(id, data);
    return Promise.resolve(id);
  }

  read(id: string): Promise<SessionData | null> {
    const data = this.sessions.get(id);
    if (!data) return Promise.resolve(null);
    if (isExpired(data)) {
      this.sessions.delete(id);
      return Promise.resolve(null);
    }
    return Promise.resolve(data);
  }

  async rotate(oldId: string, data: SessionData): Promise<string> {
    this.sessions.delete(oldId);
    return this.create(data);
  }

  destroy(id: string): Promise<void> {
    this.sessions.delete(id);
    return Promise.resolve();
  }

  destroyAllForUser(userId: string): Promise<void> {
    for (const [id, data] of this.sessions) if (data.userId === userId) this.sessions.delete(id);
    return Promise.resolve();
  }
}

/** Cookie attributes per SPEC §4.1. `__Host-` requires Secure + Path=/ + no Domain. */
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: IDLE_TTL_SECONDS,
    signed: false, // the id is opaque and server-validated; a signature adds nothing
  };
}

/** In dev over plain HTTP the `__Host-` prefix is invalid, so the name adapts. */
export function sessionCookieName(isProduction: boolean): string {
  return isProduction ? SESSION_COOKIE : "iep.sid";
}
