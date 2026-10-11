/** Verify deployed DynamoDB/S3 with educational encounters; never prints credentials or tokens. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {FileCaseRepository} from '../src/cases/caseRepository.js';
import {createFakeDeps} from '../src/fake/fakeDeps.js';
import {DynamoSessionStore} from '../src/sessions/sessionStore.js';
import {sessionsForOwner} from '../src/security/auth.js';
import {startEncounter,runTurn,endEncounter} from '../src/engine/encounter.js';
import {readStorageConfig} from '../src/config.js';
const settings=readStorageConfig({...process.env,FAKE_AWS:'0'});
const cases=new FileCaseRepository(fileURLToPath(new URL('../cases/',import.meta.url)),undefined,fileURLToPath(new URL('../work/mimic-demo/source/',import.meta.url)));
const store=new DynamoSessionStore(process.env.AWS_REGION||'us-west-2',settings.sessionsTable,settings.transcriptBucket);
const subject=`integration-check-${randomUUID()}`;
const identity={sub:subject,expiresAt:Date.now()+300_000};
const deps={...createFakeDeps(cases),sessions:sessionsForOwner(store,identity)};
const generated=await cases.generateRandom();
for(const patientId of ['4d619156-3250-4212-8399-129f3280fab1','6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8',generated.id]) {
  const opened=await startEncounter(deps,patientId);
  const exchange=await runTurn(deps,opened.state.sessionId,'What is your diet and hospital history?');
  assert.equal((await deps.sessions.get(opened.state.sessionId))!.turns.length,2);
  assert.equal(await sessionsForOwner(store,{sub:'another-student',expiresAt:identity.expiresAt}).get(opened.state.sessionId),null);
  await endEncounter(deps,opened.state.sessionId);
  const transcript=JSON.parse(await store.getFacultyTranscript({subject:'integration-check-faculty',role:'faculty'},opened.state.sessionId));
  assert.equal(transcript.session.status,'completed');
  assert.deepEqual(transcript.messages.map((m:{text:string})=>m.text),[exchange.studentTurn.text,exchange.patientTurn.text]);
  if(patientId===generated.id)assert.equal(transcript.profile.kind,'generated');
  await assert.rejects(store.getFacultyTranscript({subject,role:'student'},opened.state.sessionId));
  console.log(`PASS: real DynamoDB persistence, owner isolation, versioned S3 archive and faculty read — ${opened.patientCase.patientName} (${opened.state.sessionId})`);
}
const listing=await store.listFacultySessions({subject:'integration-check-faculty',role:'faculty'});
assert.ok(listing.sessions.some(s=>s.owner_sub===subject));
console.log('Live storage check passed. These educational test sessions remain available for faculty review; AI replies were scripted.');
