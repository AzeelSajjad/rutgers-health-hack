import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SessionAccessError, SessionConflictError, type SessionActor, type SessionMetadata } from '../../app/sessions.js';
import type { TokenVerifier, Identity } from '../security/auth.js';
export interface FacultyReviewStore {
  listFacultySessions(actor: SessionActor, cursor?: Record<string, unknown>): Promise<{sessions:SessionMetadata[];nextCursor:Record<string,unknown>|null}>;
  getFacultyTranscript(actor: SessionActor, sessionId: string): Promise<string>;
}
export function registerFacultyRoutes(app:FastifyInstance, verify:TokenVerifier, origins:Set<string>, store?:FacultyReviewStore) {
  const identities=new WeakMap<FastifyRequest,Identity>();
  const authenticate=async(request:FastifyRequest,reply:FastifyReply)=>{
    reply.header('Cache-Control','no-store');
    const origin=request.headers.origin;
    if(origin && !origins.has(origin))return reply.code(403).send({error:'Origin not allowed'});
    try {
      const auth=request.headers.authorization;
      if(typeof auth!=='string' || !auth.startsWith('Bearer '))throw new Error();
      const identity=await verify(auth.slice(7),request.socket.remoteAddress);
      if(!identity.sub || !Number.isFinite(identity.expiresAt) || identity.expiresAt<=Date.now())throw new Error();
      identities.set(request,identity);
    }catch{return reply.code(401).send({error:'Sign in is required.'});}
  };
  const faculty=async(request:FastifyRequest,reply:FastifyReply)=>{
    await authenticate(request,reply);
    if(reply.sent)return;
    if(identities.get(request)?.role!=='faculty')return reply.code(403).send({error:'Verified faculty access is required.'});
    if(!store)return reply.code(503).send({error:'Session review storage is unavailable.'});
  };
  app.get('/api/me',{preHandler:authenticate},async request=>({role:identities.get(request)!.role==='faculty'?'faculty':'student'}));
  app.get<{Querystring:{cursor?:string}}>('/api/faculty/sessions',{preHandler:faculty},async(request,reply)=>{
    let cursor:Record<string,unknown>|undefined;
    if(request.query.cursor) {
      try {
        if(request.query.cursor.length>4096 || !/^[a-zA-Z0-9_-]+$/.test(request.query.cursor))throw new Error();
        const parsed:unknown=JSON.parse(Buffer.from(request.query.cursor,'base64url').toString('utf8'));
        if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error();
        const entries=Object.entries(parsed);
        if(!entries.length || entries.some(([key,value])=>!['pk','sk','list_pk','list_sk','offset'].includes(key) || (key==='offset' ? !Number.isSafeInteger(value)||Number(value)<0 : typeof value!=='string'||value.length>2048)))throw new Error();
        cursor=parsed as Record<string,unknown>;
      }catch{return reply.code(400).send({error:'Invalid page cursor.'});}
    }
    try {
      const identity=identities.get(request)!;
      if(identity.expiresAt<=Date.now())return reply.code(401).send({error:'Sign in expired.'});
      const page=await store!.listFacultySessions({subject:identity.sub,role:'faculty'},cursor);
      return {sessions:page.sessions,nextCursor:page.nextCursor?Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url'):null};
    }catch{return reply.code(503).send({error:'Sessions could not be loaded. Try again.'});}
  });
  app.get<{Params:{sessionId:string}}>('/api/faculty/sessions/:sessionId/transcript',{preHandler:faculty},async(request,reply)=>{
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(request.params.sessionId))return reply.code(400).send({error:'Invalid session ID.'});
    try {
      const identity=identities.get(request)!;
      if(identity.expiresAt<=Date.now())return reply.code(401).send({error:'Sign in expired.'});
      const body=await store!.getFacultyTranscript({subject:identity.sub,role:'faculty'},request.params.sessionId);
      return reply.type('application/json').send(body);
    }catch(error){
      if(error instanceof SessionAccessError)return reply.code(404).send({error:'Session not found.'});
      if(error instanceof SessionConflictError)return reply.code(409).send({error:'This session has not finished archiving yet.'});
      return reply.code(503).send({error:'Transcript could not be loaded. Try again.'});
    }
  });
}
