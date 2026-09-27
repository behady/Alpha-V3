import pino from "pino";
import { config } from "./config.js";
import { createHttpServer } from "./http.js";
import { Registry } from "./registry.js";

const logger = pino({ level: config.logLevel });

const registry = new Registry({ dataDir: config.dataDir, logger });
await registry.loadAll();

const server = createHttpServer({ registry, logger });
server.listen(config.port, config.host, () => {
  logger.info({ port: config.port, publicUrl: config.publicUrl || "(GATEWAY_PUBLIC_URL unset — inbound media will not be fetchable)" }, "gateway listening");
});

// Inbound voice notes and photos are held only long enough for the web app to collect them.
const sweep = setInterval(() => registry.sweepMedia(config.mediaTtlMs), 60 * 60 * 1000);

/*
 * A code update is `docker compose up -d --build`: SIGTERM here, the sockets close cleanly,
 * the new container reloads every session from disk. Clinics see nothing.
 */
async function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  clearInterval(sweep);
  server.close();
  await registry.stopAll();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => logger.error({ err: e?.message || String(e) }, "unhandled rejection"));
