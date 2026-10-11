/** Live AWS lifecycle smoke test using only the educational default/public-demo cases. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDeps} from '../src/deps.js';
import {sessionsForOwner} from '../src/security/auth.js';
import {startEncounter,runTurn,endEncounter} from '../src/engine/encounter.js';
assert.notEqual(process.env.FAKE_AWS,'1','Disable FAKE_AWS for a live check.');
const services=createDeps();
const subject=`live-demo-check-${randomUUID()}`;
const deps={...services,sessions:sessionsForOwner(services.sessions,{sub:subject,expiresAt:Date.now()+600_000})};
const generated=await deps.cases.generateRandom!();
const steps=[
  {id:'4d619156-3250-4212-8399-129f3280fab1',question:'What would you like to discuss about your eating habits today?'},
  {id:'6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8',question:'Could you tell me what you understand about sodium?'},
  {id:generated.id,question:'Could you tell me about the diagnoses in your hospital record?'},
];
for(const step of steps) {
  const opened=await startEncounter(deps,step.id);
  const result=await runTurn(deps,opened.state.sessionId,step.question);
  assert.ok(result.patientTurn.text.trim());
  assert.ok(result.audio && result.audio.length>100,'Polly audio was unavailable.');
  assert.equal((await deps.sessions.get(opened.state.sessionId))!.turns.length,2);
  await endEncounter(deps,opened.state.sessionId);
  const archive=JSON.parse(await services.review!.getFacultyTranscript({subject:'live-demo-check-faculty',role:'faculty'},opened.state.sessionId));
  assert.equal(archive.messages.length,2);
  console.log(JSON.stringify({patient:opened.patientCase.patientName,sessionId:opened.state.sessionId,validation:result.patientTurn.validation,reply:result.patientTurn.text,audioBytes:result.audio.length,storage:'DynamoDB + versioned S3',facultyRead:'passed'}));
}
console.log('Live AI, Polly, durable sessions and faculty archive reads passed. Browser Auth0 sign-in is verified separately.');
