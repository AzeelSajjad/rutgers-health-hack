import Fastify from "fastify";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
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

// Standard ws heartbeat: pings keep idle connections alive through proxies and load balancers
// (e.g. ALB's 60 s idle timeout), and a socket that missed the previous pong is dead and gets terminated.
const alive = new WeakMap<WebSocket, boolean>();
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (alive.get(ws) === false) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 25_000);
wss.on("close", () => clearInterval(heartbeat));

const toBuffer = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);

wss.on("connection", (ws) => {
  alive.set(ws, true);
  ws.on("pong", () => alive.set(ws, true));
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
