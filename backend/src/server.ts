import Fastify from "fastify";
import { WebSocketServer, type RawData } from "ws";
import type { ServerMessage } from "@casecoach/shared";
import { config } from "./config.js";
import { createDeps } from "./deps.js";
import { createSessionHandler } from "./ws/sessionHandler.js";

const app = Fastify({ logger: true });
app.get("/health", async () => ({ ok: true }));

const deps = createDeps();
const allowedOrigins = new Set(config.allowedOrigins);
const wss = new WebSocketServer({
  server: app.server,
  path: "/ws",
  maxPayload: 64 * 1024,
  verifyClient: ({ origin }: { origin: string }) => allowedOrigins.has(origin),
});

// Keeps idle connections alive through proxies and load balancers (e.g. ALB's 60 s idle timeout).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.ping();
}, 25_000);
wss.on("close", () => clearInterval(heartbeat));

const toBuffer = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);

wss.on("connection", (ws) => {
  const handler = createSessionHandler(deps, (m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  });
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      try {
        handler.onAudio(toBuffer(data));
      } catch (err) {
        app.log.error(err);
      }
    } else {
      handler.onMessage(toBuffer(data).toString("utf8")).catch((err: unknown) => app.log.error(err));
    }
  });
  ws.on("close", handler.onClose);
  ws.on("error", (err) => app.log.error(err));
});

await app.listen({ port: config.port, host: "0.0.0.0" });
