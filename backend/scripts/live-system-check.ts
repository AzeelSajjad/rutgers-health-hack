/** Full HTTP/WS/speech/AI/storage integration using real AWS and short-lived signed test identities.
 * Auth0 tenant login is intentionally separate; the test signer exists only in this loopback process.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {PollyClient,SynthesizeSpeechCommand} from '@aws-sdk/client-polly';
import {createDeps} from '../src/deps.js';
import {createEncounterServer} from '../src/serverFactory.js';
import {createTokenVerifier} from '../src/security/auth.js';
import {parseServerEvent,type ServerEvent} from '../../frontend/src/experience/protocol.js';
assert.notEqual(process.env.FAKE_AWS,'1');
const pair=await generateKeyPair('RS256'),publicKey=await exportJWK(pair.publicKey);
const issuer='https://isolated-integration-check.invalid/',audience='casecoach-integration-check';
const token=async(sub:string,faculty=false)=>new SignJWT({sub,permissions:faculty?['review:encounters']:[]}).setProtectedHeader({alg:'RS256',kid:'isolated-check'}).setIssuer(issuer).setAudience(audience).setExpirationTime('10m').sign(pair.privateKey);
const subject=`system-check-${randomUUID()}`;
const student=await token(subject),faculty=await token('system-check-faculty',true),other=await token('system-check-other');
const origin='http://127.0.0.1:5174';
const app=createEncounterServer(createDeps(),{allowedOrigins:[origin],verifyAccessToken:createTokenVerifier({issuer,audience},createLocalJWKSet({keys:[{...publicKey,kid:'isolated-check'}]}))});
const sockets=new Set<WebSocket>();
await app.listen({host:'127.0.0.1',port:0});
const address=app.server.address();assert.ok(address&&typeof address!=='string');
const base=`http://127.0.0.1:${address.port}`;
const headers=(t:string)=>({Authorization:`Bearer ${t}`,Origin:origin});
const connect=async(accessToken:string)=>{
  const socket=new WebSocket(base.replace(/^http/,'ws')+'/ws',{origin});sockets.add(socket);
  const events:ServerEvent[]=[],finalCaptions:string[]=[];socket.on('message',data=>{const event=parseServerEvent(data.toString());events.push(event);if(event.type==='caption'&&event.isFinal)finalCaptions.push(event.text);});
  await once(socket,'open');
  const send=(message:object)=>socket.send(JSON.stringify(message));
  const wait=async(type:ServerEvent['type'])=>{
    const deadline=Date.now()+90_000;
    while(Date.now()<deadline){
      const index=events.findIndex(event=>event.type===type||event.type==='error');
      if(index>=0){const event=events.splice(index,1)[0];assert.equal(event.type,type,JSON.stringify(event));return event;}
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw new Error(`Timed out awaiting ${type}`);
  };
  send({type:'authenticate',token:accessToken});await wait('authenticated');return {socket,send,wait,finalCaptions};
};
try {
  assert.equal((await fetch(base+'/api/faculty/sessions',{headers:headers(student)})).status,403);
  assert.deepEqual(await (await fetch(base+'/api/me',{headers:headers(faculty)})).json(),{role:'faculty'});
  const response=await fetch(base+'/api/cases/random',{method:'POST',headers:headers(student)});assert.equal(response.status,200);
  const random=await response.json() as {caseId:string;patient:{name:string}};
  const polly=new PollyClient({region:process.env.AWS_REGION||'us-west-2'});
  const spokenQuestion='Could you tell me what you would like to discuss today?';
  const pcmResponse=await polly.send(new SynthesizeSpeechCommand({Text:spokenQuestion,VoiceId:'Joanna',Engine:'neural',OutputFormat:'pcm',SampleRate:'16000'}));
  const pcm=Buffer.from(await pcmResponse.AudioStream!.transformToByteArray());
  for(const patientId of ['4d619156-3250-4212-8399-129f3280fab1','6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8',random.caseId]) {
    let client=await connect(student);client.send({type:'start_session',caseId:patientId});
    const opened=await client.wait('session_started');assert.ok(opened.type==='session_started');
    assert.equal(opened.chart?.patient_id,patientId);
    assert.ok(opened.chart?.items.every(item=>opened.disclosedFacts.some(f=>f.id===item.item_id)));
    client.send({type:'caption_start'});
    for(let offset=0;offset<pcm.length;offset+=3200)client.socket.send(pcm.subarray(offset,offset+3200));
    client.socket.send(Buffer.alloc(16000));client.send({type:'caption_stop'});
    await client.wait('caption_done');
    const reviewedQuestion=client.finalCaptions.join(' ').trim();assert.ok(reviewedQuestion.length>5,'No final Transcribe captions received.');
    client.send({type:'student_turn',text:reviewedQuestion});
    const reply=await client.wait('patient_turn');assert.ok(reply.type==='patient_turn');
    assert.ok(reply.audioBase64&&Buffer.from(reply.audioBase64,'base64').length>100);
    assert.ok(reply.chart?.items.every(item=>reply.disclosedFacts.some(f=>f.id===item.item_id)));
    client.socket.close();await once(client.socket,'close');
    const intruder=await connect(other);intruder.send({type:'resume_session',sessionId:opened.sessionId});
    assert.ok((await intruder.wait('error')).type==='error');intruder.socket.close();
    client=await connect(student);client.send({type:'resume_session',sessionId:opened.sessionId});
    const resumed=await client.wait('session_started');assert.ok(resumed.type==='session_started'&&resumed.resumed&&resumed.transcript.length===2);
    assert.deepEqual(resumed.chart,reply.chart);
    client.send({type:'end_session'});await client.wait('session_ended');
    const denied=await fetch(`${base}/api/faculty/sessions/${opened.sessionId}/transcript`,{headers:headers(student)});assert.equal(denied.status,403);
    const archived=await fetch(`${base}/api/faculty/sessions/${opened.sessionId}/transcript`,{headers:headers(faculty)});assert.equal(archived.status,200);
    const archive=await archived.json() as {session:{status:string};messages:{text:string}[]};
    assert.equal(archive.session.status,'completed');assert.equal(archive.messages.length,2);assert.equal(archive.messages[1].text,reply.patientTurn.text);
    console.log(`PASS: signed HTTP/WS identity -> ${opened.patient.name} -> real Transcribe -> Bedrock -> Polly -> reconnect/chart -> DynamoDB/S3 -> protected faculty HTTP transcript (${opened.sessionId})`);
    client.socket.close();await once(client.socket,'close');
  }
  const listed=await fetch(base+'/api/faculty/sessions',{headers:headers(faculty)});assert.equal(listed.status,200);
  const page=await listed.json() as {sessions:{owner_sub:string}[]};assert.ok(page.sessions.filter(s=>s.owner_sub===subject).length===3);
  console.log('Full live service integration passed. Auth0 hosted login and physical microphone playback remain separate browser checks.');
}finally{for(const socket of sockets)socket.terminate();await app.close();}
