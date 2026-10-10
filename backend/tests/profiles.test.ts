import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPatientCard, listPatientCards, loadPatientProfile, validateProfile, ProfileValidationError, PatientNotFoundError } from '../app/profiles.js';
import { buildProfile, importProfiles } from '../scripts/import-sample-profiles.js';
const WYATT = '4d619156-3250-4212-8399-129f3280fab1';
const YVETTE = '6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8';
test('library cards omit hidden facts and instructions', () => {
  const cards = listPatientCards();
  assert.equal(cards.length, 2);
  assert.deepEqual(new Set(cards.map(card => card.id)), new Set([WYATT, YVETTE]));
  for (const card of cards) for (const key of ['facts', 'behavior', 'conversation_rules', 'learning_objectives', 'source_record']) assert.ok(!Object.hasOwn(card, key));
});
test('mutations cannot change later catalog reads', () => {
  getPatientCard(WYATT).identity.name = 'Changed';
  loadPatientProfile(WYATT).facts.length = 0;
  assert.equal(loadPatientProfile(WYATT).identity.name, 'Wyatt Nelson');
  assert.ok(loadPatientProfile(WYATT).facts.length);
});
test('missing patients throw instead of selecting another patient', () => {
  assert.throws(() => loadPatientProfile('missing'), PatientNotFoundError);
});
test('unknown sources and duplicate fact/source ids are rejected', () => {
  for (const change of ['unknown', 'fact', 'source']) {
    const profile = loadPatientProfile(WYATT);
    if (change === 'unknown') profile.facts[0].source_id = 'missing';
    if (change === 'fact') profile.facts[1].id = profile.facts[0].id;
    if (change === 'source') profile.sources[1].id = profile.sources[0].id;
    assert.throws(() => validateProfile(profile), ProfileValidationError);
  }
});
test('malformed JSON profiles fail runtime validation', () => {
  for (const [key, value] of [['behavior', {}], ['facts', []], ['schema_version', 2], ['identity', { name: 'Test', age: true }], ['source_record', null], ['version', 1.5]]) {
    assert.throws(() => validateProfile({ ...loadPatientProfile(WYATT), [key as string]: value }), ProfileValidationError);
  }
  assert.throws(() => validateProfile(null), ProfileValidationError);
});
test('generic catalog supports new cases and rejects duplicate ids or an empty library', () => {
  const directory = mkdtempSync(join(tmpdir(), 'casecoach-catalog-'));
  try {
    assert.throws(() => listPatientCards(directory), ProfileValidationError);
    const profile = loadPatientProfile(WYATT);
    profile.id = 'another-case'; profile.identity.name = 'Another Patient';
    writeFileSync(join(directory, 'case.json'), JSON.stringify(profile));
    assert.equal(getPatientCard('another-case', directory).identity.name, 'Another Patient');
    writeFileSync(join(directory, 'duplicate.json'), JSON.stringify(profile));
    assert.throws(() => listPatientCards(directory), ProfileValidationError);
  } finally { rmSync(directory, { recursive: true }); }
});
test('CSV identity, portraits and personality remain intact', () => {
  for (const id of [WYATT, YVETTE]) {
    const profile = loadPatientProfile(id), row = profile.source_record;
    assert.equal(profile.id, row['patient-uuid']);
    assert.equal(profile.identity.name, row['patient-name']);
    assert.equal(profile.identity.age, Number(row.age));
    assert.equal(profile.identity.avatar.uri, row['patient-img']);
    assert.equal(profile.behavior.personality, row.personality.replace(/^"+|"+$/g, ''));
  }
});
test('distinct clinical facts, disclosure and unknown units remain intact', () => {
  const wyatt = new Map(loadPatientProfile(WYATT).facts.map(f => [f.id, f]));
  assert.equal(wyatt.get('constipation')!.visibility, 'on_question');
  assert.deepEqual(wyatt.get('bmi')!.measurement, { value: 32, unit: 'kg/m^2' });
  assert.deepEqual(wyatt.get('ldl')!.measurement, { value: 145, unit: null });
  assert.deepEqual(wyatt.get('total-cholesterol')!.measurement, { value: 235, unit: null });
  const yvette = new Map(loadPatientProfile(YVETTE).facts.map(f => [f.id, f]));
  assert.deepEqual(yvette.get('blood-pressure')!.measurement, { systolic: 155, diastolic: 110, unit: 'mmHg' });
  assert.deepEqual(yvette.get('bmi')!.measurement, { value: 34, unit: 'kg/m^2' });
  assert.match(yvette.get('hypertension')!.text, /Stage II/);
});
test('import reproduces cases and rejects changed clinical notes or personality', () => {
  for (const id of [WYATT, YVETTE]) {
    const original = loadPatientProfile(id);
    assert.deepEqual(buildProfile(original.source_record), original);
    assert.throws(() => buildProfile({ ...original.source_record, notes: 'Different medical facts' }), /notes changed/);
    assert.throws(() => buildProfile({ ...original.source_record, personality: 'Different personality' }), /personality changed/);
  }
});
test('CSV parsing preserves quotes, BOM, multiline fields and detects missing/duplicate rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'casecoach-import-'));
  try {
    const rows = [loadPatientProfile(WYATT).source_record, loadPatientProfile(YVETTE).source_record];
    const fields = Object.keys(rows[0]);
    const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    const csv = '\ufeff' + [fields, ...rows.map(row => fields.map(field => row[field]))].map(row => row.map(quote).join(',')).join('\r\n');
    const path = join(directory, 'input.csv');
    writeFileSync(path, csv);
    assert.deepEqual(importProfiles(path, join(directory, 'output')).map(p => p.source_record), rows);
    writeFileSync(path, csv + '\r\n' + fields.map(field => quote(rows[0][field])).join(','));
    assert.throws(() => importProfiles(path, join(directory, 'output')), /Duplicate/);
    writeFileSync(path, fields.join(',') + '\n');
    assert.throws(() => importProfiles(path, join(directory, 'output')), /both Wyatt/);
    const unrelated: Record<string, string> = { ...rows[0], 'patient-name': 'Unselected', notes: 'line one\nline two, quoted' };
    writeFileSync(path, csv + '\r\n' + fields.map(field => quote(unrelated[field])).join(','));
    assert.equal(importProfiles(path, join(directory, 'output')).length, 2);
  } finally { rmSync(directory, { recursive: true }); }
});

const enumFields = [
  { name: 'avatar type', valid: 's3_reference', target: (p: ReturnType<typeof loadPatientProfile>) => p.identity.avatar, key: 'type' },
  { name: 'source kind', valid: 'provided_csv', target: (p: ReturnType<typeof loadPatientProfile>) => p.sources[0], key: 'kind' },
  { name: 'fact visibility', valid: 'initial', target: (p: ReturnType<typeof loadPatientProfile>) => p.facts[0], key: 'visibility' },
  { name: 'clinical review status', valid: 'not_reviewed', target: (p: ReturnType<typeof loadPatientProfile>) => p.provenance, key: 'clinical_review_status' },
];
for (const field of enumFields) {
  test(`${field.name} rejects arrays and other non-string enum inputs`, () => {
    for (const value of [[field.valid], null, 1, true, {}]) {
      const profile = loadPatientProfile(WYATT);
      Object.assign(field.target(profile), { [field.key]: value });
      assert.throws(() => validateProfile(profile), ProfileValidationError);
    }
  });
}
test('S3 avatars require a valid URI even when their enum value is valid', () => {
  for (const uri of [undefined, '', 'https://example.com/avatar.png', 's3://bucket', 's3:///image.png']) {
    const profile = loadPatientProfile(WYATT);
    if (uri === undefined) delete profile.identity.avatar.uri;
    else profile.identity.avatar.uri = uri;
    assert.throws(() => validateProfile(profile), ProfileValidationError);
  }
});
