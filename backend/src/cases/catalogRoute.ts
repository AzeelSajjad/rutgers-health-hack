import type {FastifyInstance} from 'fastify';
import type {CaseRepository} from './caseRepository.js';
export function registerCatalogRoute(app: FastifyInstance, cases: CaseRepository, allowedOrigins: Set<string>) {
  app.post('/api/cases/random', async(request,reply)=>{
    const origin=request.headers.origin;
    if(origin && !allowedOrigins.has(origin))return reply.code(403).send({error:'Origin not allowed'});
    if(origin)reply.header('Access-Control-Allow-Origin',origin).header('Vary','Origin');
    reply.header('Cache-Control','no-store');
    if(!cases.generateRandom)return reply.code(503).send({error:'Random patients unavailable'});
    try {
      const patient=await cases.generateRandom();
      return {caseId:patient.id};
    } catch {
      return reply.code(503).send({error:'Random patients are unavailable. Run the MIMIC demo import first.'});
    }
  });
  app.get('/api/cases',async(request,reply)=>{
    const origin=request.headers.origin;
    if(origin && !allowedOrigins.has(origin))return reply.code(403).send({error:'Origin not allowed'});
    if(origin)reply.header('Access-Control-Allow-Origin',origin).header('Vary','Origin');
    reply.header('Cache-Control','no-store');
    if(!cases.listCards)return reply.code(503).send({error:'Case library unavailable'});
    return {cases:await cases.listCards()};
  });
}
