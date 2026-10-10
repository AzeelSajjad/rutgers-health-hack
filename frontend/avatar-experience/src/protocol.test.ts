import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendTurns, parseServerEvent } from './protocol';
import { patients, previewReply } from './patients';
const studentTurn = { index: 0, speaker: 'student' as const, text: 'Hello', at: '2026-10-10T20:00:00Z' };
const patientTurn = { index: 1, speaker: 'patient' as const, text: 'Hello back', at: '2026-10-10T20:00:00Z' };
test('engine events accept the current contract and discard hidden teaching fields', () => {
  const event = parseServerEvent(JSON.stringify({ type: 'patient_turn', studentTurn: { ...studentTurn, cues: ['open_ended_question'] }, patientTurn, audioBase64: null, styleLabel: 'Reserved', disclosedFacts: [], privateCase: { facts: ['hidden'] } }));
  assert.equal(event.type, 'patient_turn');
  assert.ok(!Object.hasOwn(event, 'privateCase'));
  if (event.type === 'patient_turn') assert.ok(!Object.hasOwn(event.studentTurn, 'cues'));
});
test('malformed or coerced enum inputs never reach the experience UI', () => {
  for (const raw of ['null', '{', JSON.stringify({ type: ['patient_thinking'] }), JSON.stringify({ type: 'caption', text: 'hello', isFinal: 'true' })]) assert.throws(() => parseServerEvent(raw));
});
test('transcript upserts replayed turns and sorts by backend index', () => {
  assert.deepEqual(appendTurns([patientTurn], [studentTurn, patientTurn]), [studentTurn, patientTurn]);
  assert.equal(appendTurns([patientTurn], [{ ...patientTurn, text: 'Updated' }])[0].text, 'Updated');
});
test('both selectable patients map to independently authored backend cases', () => {
  assert.equal(new Set(patients.map(p => p.caseId)).size, 2);
  for (const patient of patients) {
    const source = JSON.parse(readFileSync(new URL(`../../../backend/experience-cases/${patient.caseId}.json`, import.meta.url), 'utf8'));
    assert.equal(source.id, patient.caseId);
    assert.equal(source.patientName, patient.name);
    assert.equal(source.age, patient.age);
    assert.deepEqual(source.pertinentNegatives, []);
    assert.equal(source.source.clinicalReviewStatus, 'not_reviewed');
    assert.ok(!Object.hasOwn(patient, 'facts'));
    assert.ok(!Object.hasOwn(patient, 'styles'));
  }
});
test('preview preserves Wyatt’s reluctance and does not invent missing clinical history', () => {
  const wyatt = patients[0];
  assert.ok(!wyatt.previewOpening.includes('constipation'));
  assert.match(previewReply(wyatt, 'Any bowel concerns?'), /take this a little slowly/);
  assert.match(previewReply(wyatt, 'What foods do you like?'), /little awkward/);
  assert.match(previewReply(wyatt, 'Do you take medications?'), /isn't part of this sample/);
});
test('preview supports clear communication without shipping hidden clinical measurements', () => {
  const yvette = patients[1];
  assert.match(previewReply(yvette, 'What about sodium?'), /everyday language/);
  assert.match(previewReply(yvette, 'What was your blood pressure?'), /actual case facts/);
  assert.match(previewReply(yvette, 'Any allergies?'), /isn't part of this sample/);
});
