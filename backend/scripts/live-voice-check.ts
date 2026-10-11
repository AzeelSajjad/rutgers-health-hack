/** Exercise real Polly and Transcribe using a generated educational question. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {PollyClient,SynthesizeSpeechCommand} from '@aws-sdk/client-polly';
import {PollyTts} from '../src/speech/polly.js';
import {TranscribeStt} from '../src/speech/transcribe.js';
const region=process.env.AWS_REGION||'us-west-2';
const text='Hello. How are you feeling today?';
for(const voice of ['Matthew','Joanna']) {
  const mp3=await new PollyTts(region).synthesize(text,voice);
  assert.ok(mp3.length>100);console.log(`PASS: real Polly MP3 output for ${voice} (${mp3.length} bytes)`);
}
const result=await new PollyClient({region}).send(new SynthesizeSpeechCommand({Text:text,VoiceId:'Joanna',Engine:'neural',OutputFormat:'pcm',SampleRate:'16000'}));
const pcm=Buffer.from(await result.AudioStream!.transformToByteArray());
let stream:ReturnType<TranscribeStt['start']>|undefined;
const captions:string[]=[];
await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{stream?.cancel();reject(new Error('Live Transcribe timed out'));},30000);
  stream=new TranscribeStt(region).start((caption,isFinal)=>{if(isFinal)captions.push(caption);},()=>{clearTimeout(timer);resolve();},error=>{clearTimeout(timer);reject(error);});
  for(let offset=0;offset<pcm.length;offset+=3200)stream.push(pcm.subarray(offset,offset+3200));
  stream.push(Buffer.alloc(16000));stream.end();
});
assert.ok(captions.join(' ').trim());
console.log(`PASS: real Transcribe completed final captions: ${captions.join(' ')}`);
