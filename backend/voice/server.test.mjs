import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createVoiceServer} from './server.mjs';
async function fixture(t, transcribe) {
  const texts=[];
  const server=createVoiceServer({port:0,
    polly:{async send(command){texts.push(command.input.Text);return {AudioStream:{async transformToByteArray(){return new Uint8Array([1,2,3]);}}};}},
    transcribe:transcribe || {async send(){throw new Error('Unexpected AWS call');}}
  });
  const connections=new Set();
  server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{for(const socket of connections)socket.destroy();server.closeAllConnections();server.close(resolve);}));
  return {server,texts,base:`http://127.0.0.1:${server.address().port}`};
}
async function connect(t,base){
  const ws=new WebSocket(base.replace('http:','ws:')+'/api/transcribe',{origin:'http://localhost:5173'});
  t.after(()=>ws.terminate());await once(ws,'open');return ws;
}
test('malformed controls close only offending socket and preserve health', {timeout:10000},async t=>{
  const {base}=await fixture(t),other=await connect(t,base);
  for(const frame of ['{"type":"stop"}','null','[]','42','true','"start"','{}','{','{"type":"start","sampleRate":"16000"}','{"type":"unknown"}']){
    const ws=await connect(t,base),message=once(ws,'message'),closed=once(ws,'close');ws.send(frame);
    assert.equal(JSON.parse((await message)[0]).type,'error');await closed;
    assert.equal((await fetch(base+'/health')).status,200);assert.equal(other.readyState,WebSocket.OPEN);
  }
});
test('split UTF-8 bytes reach Polly unchanged', {timeout:10000},async t=>{
  const {server,base,texts}=await fixture(t),body=Buffer.from(JSON.stringify({text:'Café 🐱'}));
  const split=body.indexOf(Buffer.from('é'))+1,observed=[];let received;
  const first=new Promise(resolve=>{received=resolve;});
  server.prependListener('request',req=>req.on('data',chunk=>{observed.push(chunk);received();}));
  const req=http.request(base+'/api/speech',{method:'POST',headers:{'Content-Type':'application/json'}});
  const responsePromise=once(req,'response');req.flushHeaders();req.write(body.subarray(0,split));
  await first;await new Promise(resolve=>setTimeout(resolve,20));req.end(body.subarray(split));
  const [response]=await responsePromise,output=[];for await(const chunk of response)output.push(chunk);
  assert.equal(response.statusCode,200);assert.equal(observed.length,2);
  assert.equal(observed[0].at(-1),0xc3);assert.equal(observed[1][0],0xa9);
  assert.deepEqual(texts,['Café 🐱']);assert.deepEqual([...Buffer.concat(output)],[1,2,3]);
});
test('body byte limit is retained without calling Polly',{timeout:10000},async t=>{
  const {base,texts}=await fixture(t);
  const response=await fetch(base+'/api/speech',{method:'POST',body:JSON.stringify({text:'x'.repeat(16000)})});
  assert.equal(response.status,413);assert.deepEqual(texts,[]);
});

test('valid recording drains audio, returns final transcript and closes cleanly',{timeout:10000},async t=>{
  const chunks=[];
  const {base}=await fixture(t,{async send(command){
    assert.equal(command.input.MediaSampleRateHertz,16000);
    return {TranscriptResultStream:(async function*(){
      for await(const event of command.input.AudioStream)chunks.push([...event.AudioEvent.AudioChunk]);
      yield {TranscriptEvent:{Transcript:{Results:[{ResultId:'turn-1',IsPartial:false,Alternatives:[{Transcript:'How are you?'}]}]}}};
    })()};
  }});
  const ws=await connect(t,base),events=[];
  ws.on('message',data=>events.push(JSON.parse(data)));
  const closed=once(ws,'close');
  ws.send(JSON.stringify({type:'start',sampleRate:16000}));
  ws.send(Buffer.from([1,2,3,4]));ws.send(JSON.stringify({type:'stop'}));
  await closed;
  assert.deepEqual(chunks,[[1,2,3,4]]);
  assert.deepEqual(events,[{type:'transcript',id:'turn-1',text:'How are you?',isPartial:false},{type:'done'}]);
  assert.equal((await fetch(base+'/health')).status,200);
});
