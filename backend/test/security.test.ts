import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { WebSocket } from 'ws';
import { createEncounterServer } from '../src/serverFactory.js';
import { createTokenVerifier, authSettings, sessionsForOwner } from '../src/security/auth.js';
import { createFakeDeps } from '../src/fake/fakeDeps.js';
import { InMemorySessionStore } from '../src/sessions/sessionStore.js';
import { makeCase } from './fixtures.js';
import type { EncounterState } from '@casecoach/shared';

const issuer = 'https://school.example.auth0.com/';
const audience = 'https://casecoach.example/api';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

describe('JWT verification and session ownership', () => {
  it('allows explicit local live demo only on loopback and never grants faculty permissions', async () => {
    expect(() => authSettings({LOCAL_DEMO_AUTH:'1'}, '0.0.0.0')).toThrow(/loopback/);
    expect(() => authSettings({LOCAL_DEMO_AUTH:'1',NODE_ENV:'production'}, '127.0.0.1')).toThrow(/production/);
    const local=authSettings({LOCAL_DEMO_AUTH:'1',AUTH0_AUDIENCE:audience,FACULTY_SUBJECTS:'local-development'},'127.0.0.1');
    await expect(local.verifyAccessToken('casecoach-local-development','127.0.0.1')).resolves.toMatchObject({role:'student'});
    await expect(local.verifyAccessToken('casecoach-local-development','192.0.2.1')).rejects.toThrow();
    await expect(local.verifyAccessToken('wrong','127.0.0.1')).rejects.toThrow();
  });
  it('requires signed, unexpired RS256 access tokens with the configured issuer, audience and subject', async () => {
    const pair = await generateKeyPair('RS256');
    const publicKey = await exportJWK(pair.publicKey);
    const verifier = createTokenVerifier({ issuer, audience }, createLocalJWKSet({ keys: [{ ...publicKey, kid: 'school' }] }));
    const token = (claims = {}, algorithm = 'RS256') => new SignJWT({ sub: 'auth0|student', ...claims })
      .setProtectedHeader({ alg: algorithm, kid: 'school' }).setIssuer(issuer).setAudience(audience)
      .setExpirationTime('5m').sign(pair.privateKey);
    await expect(verifier(await token())).resolves.toMatchObject({ sub: 'auth0|student' });
    for (const overrides of [{ iss: 'https://attacker/' }, { aud: 'other' }, { sub: '' }, { exp: 1 }]) {
      const invalid = await new SignJWT({ sub: 'auth0|student', iss: issuer, aud: audience, exp: Math.floor(Date.now()/1000)+300, ...overrides })
        .setProtectedHeader({ alg: 'RS256', kid: 'school' }).sign(pair.privateKey);
      await expect(verifier(invalid)).rejects.toThrow();
    }
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: 'auth0|student' }).setProtectedHeader({ alg: 'RS256', kid: 'school' })
      .setIssuer(issuer).setAudience(audience).setExpirationTime('5m').sign(other.privateKey);
    await expect(verifier(forged)).rejects.toThrow();
    await expect(verifier('not-a-token')).rejects.toThrow();
  });

  it('fails closed without Auth0 configuration and limits fake AWS access to loopback binding and peers', async () => {
    expect(() => authSettings({}, '0.0.0.0')).toThrow(/AUTH0/);
    expect(() => authSettings({ FAKE_AWS: '1' }, '0.0.0.0')).toThrow(/loopback/);
    expect(() => authSettings({ FAKE_AWS: '1', NODE_ENV: 'production' }, '127.0.0.1')).toThrow(/production/);
    expect(() => authSettings({ FAKE_AWS: '1', AUTH0_AUDIENCE: audience }, '127.0.0.1')).toThrow(/AUTH0/);
    const local = authSettings({ FAKE_AWS: '1' }, '127.0.0.1');
    await expect(local.verifyAccessToken('casecoach-local-development', '127.0.0.1')).resolves.toMatchObject({ sub: 'local-development' });
    await expect(local.verifyAccessToken('casecoach-local-development', '192.0.2.1')).rejects.toThrow();
    await expect(local.verifyAccessToken('anything-else', '127.0.0.1')).rejects.toThrow();
  });

  it('stamps verified ownership and prevents cross-user or legacy reads and writes', async () => {
    const store = new InMemorySessionStore();
    const alice = sessionsForOwner(store, { sub: 'alice', expiresAt: Date.now()+60_000 });
    const bob = sessionsForOwner(store, { sub: 'bob', expiresAt: Date.now()+60_000 });
    const state: EncounterState = { sessionId: 'session', caseId: 'case', status: 'active', styleId: 'style', disclosedFactIds: [], turns: [], createdAt: 'now' };
    await alice.create(state);
    expect(state.ownerSub).toBe('alice');
    await expect(bob.get('session')).resolves.toBeNull();
    await expect(bob.save({ ...state, ownerSub: 'bob' })).rejects.toThrow();
    await expect(alice.save({ ...state, ownerSub: 'bob' })).rejects.toThrow();
    await alice.save({ ...state, status: 'ended' });
    expect((await alice.get('session'))?.status).toBe('ended');
    await store.create({ ...state, sessionId: 'legacy', ownerSub: undefined });
    await expect(alice.get('legacy')).resolves.toBeNull();
    await expect(sessionsForOwner(store, { sub: 'alice', expiresAt: 1 }).get('session')).rejects.toThrow();
  });

  it('forwards pinned patient profiles and pending archival only after checking ownership', async () => {
    const state: EncounterState = { sessionId: 'session', caseId: 'case', ownerSub: 'alice', status: 'ended', styleId: 'style', disclosedFactIds: [], turns: [], createdAt: 'now' };
    const patient = makeCase();
    const store = { create: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(state), save: vi.fn(), getPatientCase: vi.fn().mockResolvedValue(patient), finalizePending: vi.fn().mockResolvedValue(undefined) };
    const alice = sessionsForOwner(store, { sub: 'alice', expiresAt: Date.now()+60_000 });
    const bob = sessionsForOwner(store, { sub: 'bob', expiresAt: Date.now()+60_000 });
    await alice.create(state, patient);
    expect(store.create).toHaveBeenCalledWith(state, patient);
    await expect(alice.getPatientCase!('session')).resolves.toEqual(patient);
    await alice.finalizePending!('session');
    expect(store.finalizePending).toHaveBeenCalledWith('session');
    store.getPatientCase.mockClear();
    store.finalizePending.mockClear();
    await expect(bob.getPatientCase!('session')).resolves.toBeNull();
    await expect(bob.finalizePending!('session')).rejects.toThrow();
    expect(store.getPatientCase).not.toHaveBeenCalled();
    expect(store.finalizePending).not.toHaveBeenCalled();
  });

  it('does not release data if token expires while a persistence read is pending', async () => {
    const store = new InMemorySessionStore();
    const identity = { sub: 'alice', expiresAt: Date.now()+60_000 };
    const state: EncounterState = { sessionId: 'session', caseId: 'case', ownerSub: 'alice', status: 'active', styleId: 'style', disclosedFactIds: [], turns: [], createdAt: 'now' };
    store.get = async () => { identity.expiresAt = 1; return state; };
    await expect(sessionsForOwner(store, identity).get('session')).rejects.toThrow(/expired/);
  });
});

async function setup(options: { authTimeoutMs?: number; expiresAt?: number } = {}) {
  const c = makeCase();
  const deps = createFakeDeps({ get: async id => id === c.id ? c : null });
  const app = createEncounterServer(deps, {
    allowedOrigins: ['http://localhost:5173'], authTimeoutMs: options.authTimeoutMs ?? 200,
    verifyAccessToken: async token => {
      if (!['alice', 'bob'].includes(token)) throw new Error('secret verifier details');
      return { sub: token, expiresAt: options.expiresAt ?? Date.now()+60_000 };
    },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  cleanup.push(() => app.close());
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { origin: 'http://localhost:5173' });
    const received: any[] = [];
    ws.on('message', data => received.push(JSON.parse(data.toString())));
    await once(ws, 'open');
    return { ws, received, next: async () => { const [data] = await once(ws, 'message'); return JSON.parse(data.toString()); } };
  };
  return { connect, deps };
}

describe('authenticated WebSocket boundary', () => {
  it.each([JSON.stringify({ type: 'start_session', caseId: 'test-case' }), Buffer.from([1,2])])('blocks anonymous application frames and audio', async frame => {
    const { connect, deps } = await setup();
    const { ws, received } = await connect();
    ws.send(frame);
    await once(ws, 'close');
    expect(received).toContainEqual({ type: 'error', code: 'AUTH_REQUIRED', message: 'Sign in is required.' });
    expect((await deps.sessions.get('s1'))).toBeNull();
  });

  it('rejects invalid credentials without returning verifier details', async () => {
    const { connect } = await setup();
    const { ws, received } = await connect();
    ws.send(JSON.stringify({ type: 'authenticate', token: 'bad-token' }));
    await once(ws, 'close');
    expect(received).toEqual([{ type: 'error', code: 'AUTH_FAILED', message: 'Sign in could not be verified.' }]);
  });

  it('closes idle unauthenticated sockets at a bounded deadline', async () => {
    const { connect } = await setup({ authTimeoutMs: 20 });
    const { ws } = await connect();
    const [code] = await once(ws, 'close');
    expect(code).toBe(1008);
  });

  it('authenticates before starting and only permits the owner to resume', async () => {
    const { connect } = await setup();
    const alice = await connect();
    alice.ws.send(JSON.stringify({ type: 'authenticate', token: 'alice' }));
    expect(await alice.next()).toEqual({ type: 'authenticated' });
    alice.ws.send(JSON.stringify({ type: 'start_session', caseId: 'test-case' }));
    const started = await alice.next();
    expect(started.type).toBe('session_started');
    const bob = await connect();
    bob.ws.send(JSON.stringify({ type: 'authenticate', token: 'bob' }));
    await bob.next();
    bob.ws.send(JSON.stringify({ type: 'resume_session', sessionId: started.sessionId }));
    expect(await bob.next()).toMatchObject({ type: 'error', code: 'RESUME_FAILED' });
    const reconnected = await connect();
    reconnected.ws.send(JSON.stringify({ type: 'authenticate', token: 'alice' }));
    await reconnected.next();
    reconnected.ws.send(JSON.stringify({ type: 'resume_session', sessionId: started.sessionId }));
    expect(await reconnected.next()).toMatchObject({ type: 'session_started', resumed: true });
  });

  it('expires an open connection and cancels its caption stream', async () => {
    const { connect, deps } = await setup({ expiresAt: Date.now()+150 });
    const { ws, next, received } = await connect();
    ws.send(JSON.stringify({ type: 'authenticate', token: 'alice' }));
    await next();
    ws.send(JSON.stringify({ type: 'start_session', caseId: 'test-case' }));
    await next();
    ws.send(JSON.stringify({ type: 'caption_start' }));
    await once(ws, 'close');
    expect(received.at(-1)).toMatchObject({ type: 'error', code: 'AUTH_EXPIRED' });
  });
});


it('protects the catalog and random generation with the same verified identity as encounters', async () => {
  const patient = makeCase();
  const generateRandom = vi.fn(async () => patient);
  const app = createEncounterServer(createFakeDeps({get: async () => patient, listCards: async () => [], generateRandom}), {
    allowedOrigins: ['http://localhost:5173'],
    verifyAccessToken: async token => { if (token !== 'valid') throw new Error(); return {sub:'student',expiresAt:Date.now()+60_000}; },
  });
  try {
    for (const url of ['/api/cases', '/api/cases/random']) {
      const method = url.endsWith('random') ? 'POST' : 'GET';
      expect((await app.inject({method,url})).statusCode).toBe(401);
      expect((await app.inject({method,url,headers:{authorization:'Bearer invalid'}})).statusCode).toBe(401);
      expect((await app.inject({method,url,headers:{authorization:'Bearer valid',origin:'https://untrusted.example'}})).statusCode).toBe(403);
      expect((await app.inject({method,url,headers:{authorization:'Bearer valid',origin:'http://localhost:5173'}})).statusCode).toBe(200);
    }
    expect(generateRandom).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});
