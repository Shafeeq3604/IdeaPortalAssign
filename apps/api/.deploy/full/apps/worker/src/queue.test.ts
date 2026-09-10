import { describe, expect, it } from "vitest";
import { connectionFrom } from "./queue.js";

/**
 * `connectionFrom` used to reconstruct {host, port, password} from the URL by hand. That
 * silently dropped a `username`, which Azure Cache for Redis's ACL-style auth can require —
 * the connection would then hang forever (BullMQ's `maxRetriesPerRequest: null` means it
 * never throws, just retries quietly), while a URL-string-based connection elsewhere in the
 * same codebase (the API's session store) worked fine against the identical REDIS_URL. Now
 * it hands the whole URL string to ioredis and lets it parse everything, same as that
 * working path — these tests check the resulting client's parsed `.options`, not a
 * hand-built object.
 *
 * No `lazyConnect`: BullMQ expects a client handed to it to already be connecting on its
 * own (see the comment in queue.ts). That means constructing one here does start a real
 * background connection attempt against these bogus test hosts/ports, which will fail —
 * harmlessly, since nothing awaits it and `conn()` below silences the resulting error
 * event before it can become an unhandled rejection.
 */
function conn(url: string) {
  const client = connectionFrom(url);
  client.on("error", () => undefined);
  return client;
}

describe("connectionFrom", () => {
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
