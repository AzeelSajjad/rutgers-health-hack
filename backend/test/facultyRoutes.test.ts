import {describe,it,expect} from 'vitest';
import {createEncounterServer} from '../src/serverFactory.js';
import {createFakeDeps} from '../src/fake/fakeDeps.js';
import {startEncounter,runTurn,endEncounter} from '../src/engine/encounter.js';
import {FileCaseRepository} from '../src/cases/caseRepository.js';
import {sessionsForOwner,createTokenVerifier} from '../src/security/auth.js';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {fileURLToPath} from 'node:url';
const origin='http://localhost:5173';
const header=(token:string)=>({authorization:`Bearer ${token}`,origin});
describe('faculty review integrated with encounters',()=>{
  it('enforces verified faculty roles, pagination, completion and private transcripts',async()=>{
    const deps=createFakeDeps(new FileCaseRepository(fileURLToPath(new URL('../cases/',import.meta.url))));
    const app=createEncounterServer(deps,{allowedOrigins:[origin],verifyAccessToken:async token=>{
      if(!['faculty','student'].includes(token))throw new Error();
      return {sub:token,role:token as 'faculty'|'student',expiresAt:Date.now()+60_000};
    }});
    const learner={...deps,sessions:sessionsForOwner(deps.sessions,{sub:'student',expiresAt:Date.now()+60_000})};
    const opened=await startEncounter(learner,'4d619156-3250-4212-8399-129f3280fab1');
    try {
      for(const url of ['/api/faculty/sessions',`/api/faculty/sessions/${opened.state.sessionId}/transcript`]) {
        expect((await app.inject({url})).statusCode).toBe(401);
        expect((await app.inject({url,headers:header('student')})).statusCode).toBe(403);
        expect((await app.inject({url,headers:header('invalid')})).statusCode).toBe(401);
        expect((await app.inject({url,headers:{...header('faculty'),origin:'https://untrusted.example'}})).statusCode).toBe(403);
      }
      expect((await app.inject({url:'/api/me',headers:header('student')})).json()).toEqual({role:'student'});
      expect((await app.inject({url:'/api/me',headers:header('faculty')})).json()).toEqual({role:'faculty'});
      const active=await app.inject({url:'/api/faculty/sessions',headers:header('faculty')});
      expect(active.headers['cache-control']).toBe('no-store');
      expect(active.json().sessions[0]).toMatchObject({owner_sub:'student',status:'active'});
      expect(JSON.stringify(active.json())).not.toMatch(/persona|profile_snapshot|encounter_case/);
      expect((await app.inject({url:`/api/faculty/sessions/${opened.state.sessionId}/transcript`,headers:header('faculty')})).statusCode).toBe(409);
      await runTurn(learner,opened.state.sessionId,'What is your diet like?');
      await endEncounter(learner,opened.state.sessionId);
      const archived=await app.inject({url:`/api/faculty/sessions/${opened.state.sessionId}/transcript`,headers:header('faculty')});
      expect(archived.statusCode).toBe(200);expect(archived.json().messages).toHaveLength(2);
      expect(archived.json().profile.patientName).toBe('Wyatt Nelson');
      expect((await app.inject({url:'/api/faculty/sessions/missing/transcript',headers:header('faculty')})).statusCode).toBe(404);
      expect((await app.inject({url:'/api/faculty/sessions?cursor=bad',headers:header('faculty')})).statusCode).toBe(400);
      for(let i=0;i<26;i++)await startEncounter(learner,'6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8');
      const first=(await app.inject({url:'/api/faculty/sessions',headers:header('faculty')})).json();
      expect(first.sessions).toHaveLength(25);expect(first.nextCursor).toBeTruthy();
      const second=(await app.inject({url:`/api/faculty/sessions?cursor=${first.nextCursor}`,headers:header('faculty')})).json();
      expect(second.sessions).toHaveLength(2);expect(second.nextCursor).toBeNull();
    }finally{await app.close();}
  });
  it('derives faculty only from signed API permissions or the trusted subject allowlist',async()=>{
    const pair=await generateKeyPair('RS256'),publicKey=await exportJWK(pair.publicKey);
    const verify=createTokenVerifier({issuer:'https://school.auth0.com/',audience:'api',facultySubjects:new Set(['approved'])},createLocalJWKSet({keys:[{...publicKey,kid:'school'}]}));
    const token=(claims:Record<string,unknown>)=>new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'school'}).setIssuer('https://school.auth0.com/').setAudience('api').setExpirationTime('5m').sign(pair.privateKey);
    expect((await verify(await token({sub:'student',role:'faculty',user_metadata:{role:'faculty'}}))).role).toBe('student');
    expect((await verify(await token({sub:'approved'}))).role).toBe('faculty');
    expect((await verify(await token({sub:'faculty',permissions:['review:encounters']}))).role).toBe('faculty');
    expect((await verify(await token({sub:'student',permissions:'review:encounters'}))).role).toBe('student');
  });
});
