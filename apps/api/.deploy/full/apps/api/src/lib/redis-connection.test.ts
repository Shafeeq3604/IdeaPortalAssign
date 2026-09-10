import { describe, expect, it } from "vitest";
import { makeQueueConnection } from "./redis-connection.js";

/**
 * No `lazyConnect` (see the comment in redis-connection.ts): constructing a client here
 * starts a real background connection attempt against these bogus test hosts/ports, which
 * fails harmlessly since nothing awaits it — `conn()` silences the error event before it
 * can become an unhandled rejection.
 */
function conn(url: string) {
  const client = makeQueueConnection(url);
  client.on("error", () => undefined);
  return client;
}

describe("makeQueueConnection", () => {
  it("parses host and an explicit port from a redis URL", () => {
    const c = conn("redis://localhost:6380");
    expect(c.options.host).toBe("localhost");
    expect(c.options.port).toBe(6380);
    c.disconnect();
  });

  it("defaults to port 6379 when the URL has none", () => {
    const c = conn("redis://localhost");
    expect(c.options.port).toBe(6379);
    c.disconnect();
  });

  it("carries a password when the URL has one", () => {
    const c = conn("redis://:s3cret@localhost:6379");
    expect(c.options.password).toBe("s3cret");
    c.disconnect();
  });

  it("carries a username when the URL has one (Azure Cache for Redis ACL-style auth)", () => {
    const c = conn("redis://myuser:s3cret@localhost:6379");
    expect(c.options.username).toBe("myuser");
    expect(c.options.password).toBe("s3cret");
    c.disconnect();
  });

  it("enables TLS for a rediss: URL", () => {
    const c = conn("rediss://localhost:6380");
    expect(c.options.tls).toBeTruthy();
    c.disconnect();
  });

  it("never retries a request forever at the ioredis level, leaving BullMQ in charge", () => {
    const c = conn("redis://localhost:6379");
    expect(c.options.maxRetriesPerRequest).toBeNull();
    c.disconnect();
  });
});
