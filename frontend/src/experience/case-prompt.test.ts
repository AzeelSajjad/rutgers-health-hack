import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PatientCaseSchema } from '@casecoach/shared';
import { buildPatientSystemPrompt } from '../../../backend/src/engine/patientPrompt';
import { patients } from './patients';
for (const patient of patients) test(`${patient.name} initial engine prompt excludes gated details until released`, () => {
  const c = PatientCaseSchema.parse(JSON.parse(readFileSync(new URL(`../../../backend/cases/${patient.caseId}.json`, import.meta.url), 'utf8')));
  const initialIds = c.facts.filter(f => f.disclosure === 'atStart').map(f => f.id);
  const initial = buildPatientSystemPrompt(c, c.initialStyleId, initialIds);
  for (const fact of c.facts.filter(f => f.disclosure !== 'atStart')) {
    assert.ok(!initial.includes(fact.content), `${fact.id} leaked before release`);
    assert.ok(buildPatientSystemPrompt(c, c.initialStyleId, [...initialIds, fact.id]).includes(fact.content));
  }
  if (patient.key === 'wyatt') assert.doesNotMatch(initial, /constipat|avoids talking about it/i);
  else assert.doesNotMatch(initial, /confused about sodium|medical explanations are difficult|struggles to understand medical explanations|overwhelmed by medical explanations/i);
});
