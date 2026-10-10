import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';
import * as zod from 'zod';
import { patients } from './patients';
type Case = { facts: { id: string; content: string; disclosure: string }[]; initialStyleId: string };
/** Execute unchanged snapshots of the actual teammate engine, not a reimplemented prompt. */
function engineModule(name: string): Record<string, any> {
  const source = readFileSync(new URL(`../test-fixtures/encounter-engine/${name}.ts.txt`, import.meta.url), 'utf8');
  const code = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: (path: string) => {
    if (path === 'zod') return zod;
    if (path === './style.js') return engineModule('style');
    throw new Error(`Unexpected engine dependency ${path}`);
  } });
  return exports;
}
const { PatientCaseSchema } = engineModule('case');
const { buildPatientSystemPrompt } = engineModule('patientPrompt');
for (const patient of patients) test(`${patient.name} initial engine prompt excludes gated details until released`, () => {
  const c: Case = PatientCaseSchema.parse(JSON.parse(readFileSync(new URL(`../../../backend/experience-cases/${patient.caseId}.json`, import.meta.url), 'utf8')));
  const initialIds = c.facts.filter(f => f.disclosure === 'atStart').map(f => f.id);
  const initial: string = buildPatientSystemPrompt(c, c.initialStyleId, initialIds);
  for (const fact of c.facts.filter(f => f.disclosure !== 'atStart')) {
    assert.ok(!initial.includes(fact.content), `${fact.id} leaked before release`);
    const released: string = buildPatientSystemPrompt(c, c.initialStyleId, [...initialIds, fact.id]);
    assert.ok(released.includes(fact.content), `${fact.id} missing after release`);
  }
  if (patient.key === 'wyatt') assert.doesNotMatch(initial, /constipat|avoids talking about it/i);
  else assert.doesNotMatch(initial, /confused about sodium|medical explanations are difficult|struggles to understand medical explanations|overwhelmed by medical explanations/i);
});
