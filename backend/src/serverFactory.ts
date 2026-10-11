import { registerCatalogRoute } from './cases/catalogRoute.js';
import Fastify, { LogController } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket, type VerifyClientCallbackSync } from 'ws';
import type { ServerMessage } from '@casecoach/shared';
import { sessionsForOwner, type Identity, type TokenVerifier } from './security/auth.js';
import { createSessionHandler, type HandlerDeps } from './ws/sessionHandler.js';

interface ServerOptions {
  allowedOrigins: string[];
  verifyAccessToken: TokenVerifier;
  authTimeoutMs?: number;
}
const toBuffer = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);

export function createEncounterServer(deps: HandlerDeps, options: ServerOptions) {
  // Never log request URLs, including rejected upgrades with credentials in their query.
  const app = Fastify({ logger: true, logController: new LogController({ disableRequestLogging: true }) });
  app.get('/health', async () => ({ ok: true }));
  const origins = new Set(options.allowedOrigins);
  registerCatalogRoute(app, deps.cases, origins, options.verifyAccessToken);
  const verifyClient: VerifyClientCallbackSync = ({ origin, req }) => origins.has(origin) && req.url === '/ws';
  const wss = new WebSocketServer({
    server: app.server, path: '/ws', maxPayload: 64 * 1024,
    verifyClient,
  });
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 25_000);
  heartbeat.unref();
  app.addHook('preClose', async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  });

  wss.on('connection', (ws, request) => {
    let identity: Identity | undefined;
    let authenticating = false;
    let closed = false;
    let handler: ReturnType<typeof createSessionHandler> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const send = (message: ServerMessage) => { if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message)); };
    const reject = (code: 'AUTH_REQUIRED' | 'AUTH_FAILED' | 'AUTH_EXPIRED') => {
      if (closed) return;
      send({ type: 'error', code, message: code === 'AUTH_REQUIRED' ? 'Sign in is required.' : code === 'AUTH_EXPIRED' ? 'Your sign in expired. Reconnect to continue.' : 'Sign in could not be verified.' });
      closed = true;
      clearTimeout(authTimer);
      clearTimeout(expiryTimer);
      handler?.onClose();
      ws.close(1008, 'Authentication required');
    };
    const authTimer = setTimeout(() => reject('AUTH_REQUIRED'), options.authTimeoutMs ?? 10_000);
    authTimer.unref();
    const scheduleExpiry = () => {
      const remaining = identity!.expiresAt - Date.now();
      if (remaining <= 0) { reject('AUTH_EXPIRED'); return; }
      expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
      expiryTimer.unref();
    };
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      if (closed) return;
      if (!identity) {
        const buffer = toBuffer(data);
        if (isBinary || authenticating || buffer.length > 16 * 1024) { reject('AUTH_REQUIRED'); return; }
        let message: unknown;
        try { message = JSON.parse(buffer.toString('utf8')); } catch { reject('AUTH_REQUIRED'); return; }
        if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'authenticate' || !('token' in message) || typeof message.token !== 'string' || !message.token || message.token.length > 16_000) { reject('AUTH_REQUIRED'); return; }
        authenticating = true;
        void options.verifyAccessToken(message.token, request.socket.remoteAddress).then(verified => {
          if (closed) return;
          if (!verified.sub || !Number.isFinite(verified.expiresAt) || verified.expiresAt <= Date.now()) { reject('AUTH_EXPIRED'); return; }
          identity = verified;
          clearTimeout(authTimer);
          handler = createSessionHandler({ ...deps, sessions: sessionsForOwner(deps.sessions, verified) }, message => {
            if (verified.expiresAt <= Date.now()) { reject('AUTH_EXPIRED'); return; }
            send(message);
          });
          scheduleExpiry();
          send({ type: 'authenticated' });
        }).catch(() => reject('AUTH_FAILED'));
        return;
      }
      if (identity.expiresAt <= Date.now()) { reject('AUTH_EXPIRED'); return; }
      if (isBinary) {
        try { handler!.onAudio(toBuffer(data)); } catch { app.log.error('Audio processing failed'); }
      } else {
        void handler!.onMessage(toBuffer(data).toString('utf8')).catch(() => app.log.error('Encounter message failed'));
      }
    });
    ws.on('close', () => { closed = true; clearTimeout(authTimer); clearTimeout(expiryTimer); handler?.onClose(); });
    ws.on('error', () => app.log.warn('WebSocket connection failed'));
  });
  return app;
}
