import nodemailer from "nodemailer";
import type { PrismaClient } from "@iep/db";
import type { WorkerEnv } from "@iep/contracts/env";
import { drainEmailOutbox, type EmailMessage, type EmailTransport } from "@iep/evaluation";
import { captureException } from "./error-tracking.js";

/**
 * P13 email — the worker's half of the notification outbox (packages/evaluation's
 * `drainEmailOutbox` does the claiming and bookkeeping; this file only picks a transport
 * and runs the drain on a timer).
 */

/** Writes the email to the log and sends nothing. The default everywhere. */
class LogEmailTransport implements EmailTransport {
  readonly name = "log" as const;
  send(message: EmailMessage): Promise<void> {
    // The address is MASKED: this transport is also the production default until SMTP is
    // configured, and a full address in a log store is personal data (SPEC §4.4 spirit).
    console.log(`[email:log] to=${maskAddress(message.to)} subject="${message.subject}"\n${message.text}`);
    return Promise.resolve();
  }
}

class SmtpEmailTransport implements EmailTransport {
  readonly name = "smtp" as const;
  private readonly transporter;
  constructor(url: string, private readonly from: string) {
    this.transporter = nodemailer.createTransport(url);
  }
  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
  }
}

export function makeEmailTransport(env: WorkerEnv): EmailTransport {
  if (env.EMAIL_TRANSPORT === "smtp") {
    if (!env.SMTP_URL || !env.EMAIL_FROM) {
      console.error(
        "[worker] EMAIL_TRANSPORT=smtp needs both SMTP_URL and EMAIL_FROM — falling back to the " +
          "log transport, so no email will actually be sent.",
      );
      return new LogEmailTransport();
    }
    return new SmtpEmailTransport(env.SMTP_URL, env.EMAIL_FROM);
  }
  return new LogEmailTransport();
}

/**
 * How often the outbox is drained. An operational polling cadence, not a product SLA —
 * a notification email arriving within half a minute of its event is well inside what
 * anyone would call prompt, and one indexed query every 30s is negligible load.
 */
const DRAIN_INTERVAL_MS = 30_000;

/** Starts the drain loop. Never overlaps itself; a failed pass is logged and retried next tick. */
export function startEmailOutbox(db: PrismaClient, transport: EmailTransport, webOrigin: string): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await drainEmailOutbox(db, transport, { webOrigin });
      if (result.sent + result.failed + result.skipped > 0) {
        console.log(`[email] outbox: sent=${result.sent} failed=${result.failed} skipped=${result.skipped} via ${transport.name}`);
      }
    } catch (error) {
      console.error("[email] outbox drain failed — will retry on the next tick:", error);
      captureException(error, { kind: "email-outbox" });
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), DRAIN_INTERVAL_MS);
  void tick(); // drain anything left from before a restart, straight away
  return () => clearInterval(handle);
}

/** `erin@example.invalid` → `e***@example.invalid`. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address[0] ?? ""}***${address.slice(at)}`;
}
