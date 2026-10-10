import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
async function recorder(sampleRate=16000){
  let Processor;const messages=[];
  vm.runInNewContext(await readFile(new URL('./public/pcm-worklet.js',import.meta.url),'utf8'),{
    sampleRate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)};}},
    registerProcessor:(_name,constructor)=>{Processor=constructor;}
  });
  return {node:new Processor(),messages};
}
test('microphone audio is clipped signed little-endian PCM and final samples flush before stop',async()=>{
  const {node,messages}=await recorder();
  node.process([[new Float32Array([-2,-1,0,.5,1,2])]]);
  assert.equal(messages.length,0);node.port.onmessage();
  const view=new DataView(messages[0]);
  assert.deepEqual(Array.from({length:6},(_,i)=>view.getInt16(i*2,true)),[-32768,-32768,0,16384,32767,32767]);
  assert.equal(messages[1].stopped,true);assert.equal(node.process([]),false);
});
test('worklet emits 100ms chunks at the actual sample rate and mixes stereo to mono',async()=>{
  for(const rate of [16000,48000]){
    const {node,messages}=await recorder(rate);
    node.process([[new Float32Array(rate/10).fill(1),new Float32Array(rate/10).fill(-1)]]);
    assert.equal(messages.length,1);assert.equal(messages[0].byteLength,rate/10*2);
    assert.ok(new Uint8Array(messages[0]).every(v=>v===0));
  }
});
