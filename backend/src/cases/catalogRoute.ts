import { LocalResourceLimits, type ResourceLimits } from "../security/resourceLimits.js";
import type {FastifyInstance, FastifyRequest, FastifyReply} from 'fastify';
import type { TokenVerifier } from '../security/auth.js';
import type {CaseRepository} from './caseRepository.js';
export function registerCatalogRoute(app: FastifyInstance, cases: CaseRepository, allowedOrigins: Set<string>, verifyAccessToken?: TokenVerifier, limits: ResourceLimits = new LocalResourceLimits()) {
  const subjects = new WeakMap<FastifyRequest, string>();
  const authorize = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAccessToken) { subjects.set(request, `local:${request.socket.remoteAddress ?? "unknown"}`); return; }
    try {
      const header = request.headers.authorization;
      if (typeof header !== "string" || !header.startsWith("Bearer ")) throw new Error();
      const identity = await verifyAccessToken(header.slice(7), request.socket.remoteAddress);
      if (!identity.sub || !Number.isFinite(identity.expiresAt) || identity.expiresAt <= Date.now()) throw new Error();
      subjects.set(request, identity.sub);
    } catch { return reply.code(401).send({ error: "Sign in is required." }); }
  };
  app.post('/api/cases/random', { preHandler: authorize }, async(request,reply)=>{
    const origin=request.headers.origin;
    if(origin && !allowedOrigins.has(origin))return reply.code(403).send({error:'Origin not allowed'});
    if(origin)reply.header('Access-Control-Allow-Origin',origin).header('Vary','Origin');
    reply.header('Cache-Control','no-store');
    if(!cases.generateRandom)return reply.code(503).send({error:'Random patients unavailable'});
    if (!limits.take(subjects.get(request)!, "generation")) return reply.header("Retry-After", "60").code(429).send({error:"Patient generation limit reached. Please wait one minute and retry."});
    try {
      const patient=await cases.generateRandom();
      return {caseId:patient.id, patient:{name:patient.patientName,age:patient.age,visitReason:patient.visitReason}};
    } catch {
      return reply.code(503).send({error:'Random patients are unavailable. Run the MIMIC demo import first.'});
    }
  });
  app.get('/api/cases', { preHandler: authorize }, async(request,reply)=>{
    const origin=request.headers.origin;
    if(origin && !allowedOrigins.has(origin))return reply.code(403).send({error:'Origin not allowed'});
    if(origin)reply.header('Access-Control-Allow-Origin',origin).header('Vary','Origin');
    reply.header('Cache-Control','no-store');
    if(!cases.listCards)return reply.code(503).send({error:'Case library unavailable'});
    return {cases:await cases.listCards()};
  });
}
