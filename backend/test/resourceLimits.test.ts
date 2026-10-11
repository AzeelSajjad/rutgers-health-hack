import {describe,it,expect} from 'vitest';
import Fastify from 'fastify';
import {LocalResourceLimits} from '../src/security/resourceLimits.js';
import {registerCatalogRoute} from '../src/cases/catalogRoute.js';
import {makeCase} from './fixtures.js';

describe('resource admission', () => {
  it('limits starts across sockets by subject, releases idempotently, and recovers after the window', () => {
    let now = 100;
    const limits = new LocalResourceLimits(() => now);
    for (let i=0;i<6;i++) {
      const release = limits.acquireCaption('student')!;
      expect(release).toBeTypeOf('function');
      expect(limits.acquireCaption('student')).toBeNull();
      release();release();
    }
    expect(limits.acquireCaption('student')).toBeNull();
    expect(limits.acquireCaption('other')).not.toBeNull();
    now += 60_000;
    expect(limits.acquireCaption('student')).not.toBeNull();
  });
  it('bounds paid operations independently', () => {
    const limits = new LocalResourceLimits();
    for (let i=0;i<30;i++) expect(limits.take('student','turn')).toBe(true);
    expect(limits.take('student','turn')).toBe(false);
    expect(limits.take('student','generation')).toBe(true);
  });
  it('uses verified subject for HTTP generation instead of bearer strings or connections', async () => {
    const app = Fastify();
    let calls=0;
    registerCatalogRoute(app,{get:async()=>null,generateRandom:async()=>{calls++;return makeCase();}},new Set(),async()=>({sub:'same-student',expiresAt:Date.now()+60_000}));
    try {
      for (let index=0;index<6;index++) expect((await app.inject({method:'POST',url:'/api/cases/random',headers:{authorization:`Bearer token-${index}`}})).statusCode).toBe(200);
      const denied=await app.inject({method:'POST',url:'/api/cases/random',headers:{authorization:'Bearer refreshed-token'}});
      expect(denied.statusCode).toBe(429);
      expect(denied.headers['retry-after']).toBe('60');
      expect(calls).toBe(6);
    } finally { await app.close(); }
  });
});
