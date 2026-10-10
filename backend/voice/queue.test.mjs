import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioQueue} from './queue.mjs';
test('stop drains final audio before ending',async()=>{
  const q=audioQueue();q.push(Buffer.from([1,2]));q.push(Buffer.from([3,4]));q.end();const chunks=[];
  for await(const event of q)chunks.push([...event.AudioEvent.AudioChunk]);assert.deepEqual(chunks,[[1,2],[3,4]]);
});
test('waiting consumer wakes for audio and disconnect',async()=>{
  const q=audioQueue(),iterator=q[Symbol.asyncIterator](),next=iterator.next();q.push(Buffer.from([0,1]));assert.deepEqual([...(await next).value.AudioEvent.AudioChunk],[0,1]);
  const end=iterator.next();q.end();assert.equal((await end).done,true);
});
test('bounds buffered audio',()=>{const q=audioQueue(2);q.push(Buffer.from([0,1]));assert.throws(()=>q.push(Buffer.from([2,3])),/too slow/);});
