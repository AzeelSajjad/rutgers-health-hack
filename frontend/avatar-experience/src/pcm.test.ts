import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';
import { runInNewContext } from 'node:vm';
function processor() {
  const chunks: (ArrayBuffer | { finished: true })[] = [];
  const source = readFileSync(new URL('./encounter-pcm.ts', import.meta.url), 'utf8');
  const code = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  class Base { port = { onmessage: null as null | ((event: { data: string }) => void), postMessage: (data: ArrayBuffer | { finished: true }) => { chunks.push(data); } }; }
  let Constructor: (new () => Base & { process(inputs: Float32Array[][]): boolean }) | undefined;
  runInNewContext(code, { AudioWorkletProcessor: Base, registerProcessor: (_name: string, implementation: typeof Constructor) => { Constructor = implementation; } });
  return { instance: new Constructor!(), chunks };
}
test('PCM uses signed little-endian encoding, clamps peaks and flushes the final partial frame', () => {
  const { instance, chunks } = processor();
  instance.process([[new Float32Array([-2, -1, 0, 1, 2])]]);
  assert.equal(chunks.length, 0);
  instance.port.onmessage!({ data: 'finish' });
  const view = new DataView(chunks[0] as ArrayBuffer);
  assert.equal(view.byteLength, 10);
  assert.deepEqual([0, 2, 4, 6, 8].map(offset => view.getInt16(offset, true)), [-32768, -32768, 0, 32767, 32767]);
  assert.equal((chunks[1] as { finished: true }).finished, true);
  assert.equal(instance.process([[new Float32Array([1])]]), false);
});
test('PCM emits 100 ms frames and no duplicated final frames on repeated stops', () => {
  const { instance, chunks } = processor();
  instance.process([[new Float32Array(1601)]]);
  assert.equal((chunks[0] as ArrayBuffer).byteLength, 3200);
  instance.port.onmessage!({ data: 'finish' });
  assert.equal((chunks[1] as ArrayBuffer).byteLength, 2);
  instance.port.onmessage!({ data: 'finish' });
  assert.equal(chunks.length, 3);
});
