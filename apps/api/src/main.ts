import { ApiEnv, loadEnv } from "@iep/contracts/env";
import { buildServer } from "./server.js";

/**
 * Entry point. Kept separate from server.ts so tests can build a server
 * without binding a port or installing signal handlers.
 */

const env = loadEnv(ApiEnv, process.env);
const app = buildServer();

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`iep-api listening on :${env.PORT}`);
  } catch (error) {
    app.log.error(error, "failed to start");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, closing`);
    void app.close().then(() => process.exit(0));
  });
}

void start();
