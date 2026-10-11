import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { SessionStore } from '../sessions/sessionStore.js';

export interface Identity { sub: string; expiresAt: number; role?: 'student' | 'faculty' }
export type TokenVerifier = (token: string, remoteAddress?: string) => Promise<Identity>;
interface TokenSettings { issuer: string; audience: string; facultySubjects?: ReadonlySet<string>; facultyPermission?: string }

export function createTokenVerifier(settings: TokenSettings, key?: JWTVerifyGetKey): TokenVerifier {
  const resolver = key ?? createRemoteJWKSet(new URL('.well-known/jwks.json', settings.issuer), { timeoutDuration: 5_000 });
  return async token => {
    const { payload } = await jwtVerify(token, resolver, {
      issuer: settings.issuer, audience: settings.audience, algorithms: ['RS256'], requiredClaims: ['sub', 'exp'],
    });
    if (!payload.sub?.trim() || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) throw new Error('Invalid access token');
    const permission = settings.facultyPermission ?? 'review:encounters';
    const authorized = settings.facultySubjects?.has(payload.sub) || (Array.isArray(payload.permissions) && payload.permissions.includes(permission));
    return { sub: payload.sub, expiresAt: payload.exp * 1000, role: authorized ? 'faculty' : 'student' };
  };
}

const isLoopback = (address?: string) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

/** Development bypass can never listen on a public interface or accept a non-loopback peer. */
export function authSettings(env: NodeJS.ProcessEnv, host: string): { verifyAccessToken: TokenVerifier } {
  const configuredIssuer = env.AUTH0_ISSUER_BASE_URL || (env.AUTH0_DOMAIN ? `https://${env.AUTH0_DOMAIN}/` : '');
  const audience = env.AUTH0_AUDIENCE;
  if (!configuredIssuer && !audience && env.FAKE_AWS === '1') {
    if (env.NODE_ENV === 'production') throw new Error('FAKE_AWS authentication bypass is disabled in production');
    if (!isLoopback(host)) throw new Error('FAKE_AWS authentication bypass requires a loopback bind address');
    return { verifyAccessToken: async (token, remoteAddress) => {
      if (!isLoopback(remoteAddress) || token !== 'casecoach-local-development') throw new Error('Invalid development identity');
      return { sub: 'local-development', expiresAt: Date.now() + 60 * 60_000 };
    } };
  }
  if (!configuredIssuer || !audience) throw new Error('AUTH0_ISSUER_BASE_URL (or AUTH0_DOMAIN) and AUTH0_AUDIENCE are required');
  const issuer = new URL(configuredIssuer);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error('AUTH0 issuer must be an HTTPS URL');
  if (!issuer.pathname.endsWith('/')) issuer.pathname += '/';
  return { verifyAccessToken: createTokenVerifier({ issuer: issuer.href, audience, facultySubjects: new Set((env.FACULTY_SUBJECTS || '').split(',').map(s => s.trim()).filter(Boolean)), facultyPermission: env.FACULTY_PERMISSION || 'review:encounters' }) };
}

/** Check the verified identity and expiry before persistence operations; never trust caller-supplied ownership. */
export function sessionsForOwner(store: SessionStore, identity: Identity): SessionStore {
  const active = () => { if (identity.expiresAt <= Date.now()) throw new Error('Authentication expired'); };
  return {
    async create(state, patientCase) {
      active();
      state.ownerSub = identity.sub;
      await store.create(state, patientCase);
    },
    async get(id) {
      active();
      const state = await store.get(id);
      active();
      return state?.ownerSub === identity.sub ? state : null;
    },
    async save(state) {
      active();
      if (state.ownerSub !== identity.sub) throw new Error('Session unavailable');
      const current = await store.get(state.sessionId);
      active();
      if (current?.ownerSub !== identity.sub) throw new Error('Session unavailable');
      await store.save(state);
    },
    ...(store.getPatientCase ? { async getPatientCase(id: string) {
      active();
      const state = await store.get(id);
      active();
      if (state?.ownerSub !== identity.sub) return null;
      const patientCase = await store.getPatientCase!(id);
      active();
      return patientCase;
    } } : {}),
    ...(store.finalizePending ? { async finalizePending(id: string) {
      active();
      const state = await store.get(id);
      active();
      if (state?.ownerSub !== identity.sub) throw new Error('Session unavailable');
      await store.finalizePending!(id);
    } } : {}),
  };
}
