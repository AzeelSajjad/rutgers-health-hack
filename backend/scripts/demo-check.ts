/** Smoke test the running loopback demo through Vite's HTTP/WS proxy; --live exercises AWS. */
import 'dotenv/config';
import {PollyClient,SynthesizeSpeechCommand} from '@aws-sdk/client-polly';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { serverEvent as ServerMessageSchema, type ServerEvent as ServerMessage } from '../../frontend/src/experience/protocol.js';

const origin = process.env.DEMO_ORIGIN || 'http://127.0.0.1:5173';
const live = process.argv.includes('--live');
const url = new URL(origin);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'This fixture test must target loopback.');
const headers = { Authorization: 'Bearer casecoach-local-development', Origin: origin };
const sockets = new Set<WebSocket>();
async function connect(authenticate = true) {
  const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws`, { origin });
  sockets.add(ws);
  const events: ServerMessage[] = [];
  const finalCaptions: string[] = [];
  ws.on('message', data => {
    const event=ServerMessageSchema.parse(JSON.parse(data.toString()));
    events.push(event);
    if(event.type==='caption' && event.isFinal)finalCaptions.push(event.text);
  });
  await once(ws, 'open');
  const wait = async (type: ServerMessage['type']) => {
    const deadline = Date.now() + (live ? 90_000 : 10_000);
    while (Date.now() < deadline) {
      const index = events.findIndex(event => event.type === type || event.type === 'error');
      if (index !== -1) {
        const event = events.splice(index, 1)[0];
        assert.equal(event.type, type, JSON.stringify(event));
        return event;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type}`);
  };
  const send = (message: object) => ws.send(JSON.stringify(message));
  if (authenticate) { send({type:'authenticate', token:'casecoach-local-development'}); await wait('authenticated'); }
  return {ws,wait,send,finalCaptions};
}
try {
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await fetch(`${origin}/api/cases`)).status, 401);
  assert.equal((await fetch(`${origin}/api/cases/random`, {method:'POST'})).status, 401);
  const unauthorized = await connect(false);
  unauthorized.send({type:'start_session', caseId:'4d619156-3250-4212-8399-129f3280fab1'});
  const rejected = await unauthorized.wait('error');
  assert.ok(rejected.type === 'error' && rejected.code === 'AUTH_REQUIRED');
  console.log('PASS: frontend, proxy and unauthenticated HTTP/WebSocket rejection');

  const catalog = await fetch(`${origin}/api/cases`, {headers});
  assert.equal(catalog.status, 200);
  const cards = (await catalog.json() as {cases: {id:string;name:string}[]}).cases;
  assert.ok(cards.some(card => card.name === 'Wyatt Nelson'));
  assert.ok(cards.some(card => card.name === 'Yvette Armstrong'));
  const random = await fetch(`${origin}/api/cases/random`, {method:'POST',headers});
  assert.equal(random.status, 200, 'Run import:mimic-demo before this check.');
  const generated = await random.json() as {caseId:string;patient:{name:string}};
  assert.deepEqual(Object.keys(generated).sort(), ['caseId','patient']);
  assert.deepEqual(Object.keys(generated.patient).sort(), ['age','name','visitReason']);
  console.log(`PASS: catalog defaults and generated patient (${generated.patient.name})`);

  let pcm=Buffer.alloc(3200);
  if(live) {
    const result=await new PollyClient({region:process.env.AWS_REGION||'us-west-2'}).send(new SynthesizeSpeechCommand({Text:'What would you like to discuss today?',VoiceId:'Joanna',Engine:'neural',OutputFormat:'pcm',SampleRate:'16000'}));
    pcm=Buffer.from(await result.AudioStream!.transformToByteArray());
    assert.equal((await fetch(`${origin}/api/faculty/sessions`,{headers})).status,403);
    assert.deepEqual(await (await fetch(`${origin}/api/me`,{headers})).json(),{role:'student'});
  }

  for (const patient of [...cards.filter(card => ['Wyatt Nelson','Yvette Armstrong'].includes(card.name)), {id:generated.caseId,name:generated.patient.name}]) {
    let client = await connect();
    client.send({type:'start_session',caseId:patient.id});
    const started = await client.wait('session_started');
    assert.ok(started.type === 'session_started');
    assert.equal(started.patient.name, patient.name);
    client.send({type:'caption_start'});
    for(let offset=0;offset<pcm.length;offset+=3200)client.ws.send(pcm.subarray(offset,offset+3200));
    if(live)client.ws.send(Buffer.alloc(16000));
    client.send({type:'caption_stop'});
    await client.wait('caption_done');
    assert.ok(client.finalCaptions.join(' ').trim(),'No final captions received.');
    client.send({type:'student_turn',text:'What would you like to discuss about your diet and medical history?'});
    const turn = await client.wait('patient_turn');
    assert.ok(turn.type === 'patient_turn' && turn.patientTurn.text.length > 0);
    if(live)assert.ok(turn.audioBase64 && Buffer.from(turn.audioBase64,'base64').length>100);
    client.ws.close(); await once(client.ws,'close');
    client = await connect();
    client.send({type:'resume_session',sessionId:started.sessionId});
    const resumed = await client.wait('session_started');
    assert.ok(resumed.type === 'session_started' && resumed.resumed);
    assert.equal(resumed.patient.name,patient.name);
    assert.ok(resumed.transcript.some(entry => entry.text === turn.studentTurn.text));
    assert.ok(resumed.transcript.some(entry => entry.text === turn.patientTurn.text));
    client.send({type:'end_session'});
    const ended = await client.wait('session_ended');
    assert.ok(ended.type === 'session_ended' && ended.sessionId === started.sessionId);
    client.ws.close(); await once(client.ws,'close');
    console.log(`PASS: ${patient.name} — start, PCM captions, reply, reconnect/transcript, end`);
  }
  console.log(live?'Local website live AWS check passed; Auth0 disabled. Physical microphone/playback remains a manual check.':'Demo smoke test passed. Scripted fixtures only; live AWS/Auth0 were not exercised.');
} finally { for (const socket of sockets) socket.terminate(); }
