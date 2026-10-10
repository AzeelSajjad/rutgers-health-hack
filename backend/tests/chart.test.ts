import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildChartResponse, prepareChartItems, ChartValidationError } from '../app/chart.js';
import { loadPatientProfile } from '../app/profiles.js';
const WYATT = '4d619156-3250-4212-8399-129f3280fab1';
const YVETTE = '6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8';
test('initial charts contain only initial facts without disclosure metadata', () => {
  for (const [id, count] of [[WYATT, 4], [YVETTE, 3]] as const) {
    const profile = loadPatientProfile(id), response = buildChartResponse(profile);
    assert.equal(response.items.length, count);
    assert.equal(response.patient_id, id); assert.equal(response.patient_version, profile.version);
    assert.deepEqual(new Set(response.items.map(i => i.item_id)), new Set(profile.facts.filter(f => f.visibility === 'initial').map(f => f.id)));
    assert.ok(!Object.hasOwn(response, 'source_record'));
    for (const item of response.items) for (const key of ['visibility', 'topics']) assert.ok(!Object.hasOwn(item, key));
  }
});
test('release is explicit, deduplicated and isolated between projections', () => {
  const profile = loadPatientProfile(WYATT), response = buildChartResponse(profile, ['constipation', 'constipation']);
  assert.equal(response.items.length, 5);
  assert.ok(!response.items.some(i => i.item_id === 'food-preferences'));
  assert.equal(buildChartResponse(profile).items.length, 4);
});
test('unknown and malformed release inputs fail', () => {
  for (const ids of [['nonexistent'], 'constipation', [false], null, {}]) {
    assert.throws(() => buildChartResponse(loadPatientProfile(WYATT), ids as Iterable<string>), ChartValidationError);
  }
});
test('clinical numbers and explicit missing units are preserved', () => {
  const wyatt = new Map(prepareChartItems(loadPatientProfile(WYATT)).map(i => [i.item_id, i]));
  assert.equal(wyatt.get('total-cholesterol')!.value, 235);
  assert.equal(wyatt.get('ldl')!.display_value, '145'); assert.equal(wyatt.get('ldl')!.unit, null);
  const bp = prepareChartItems(loadPatientProfile(YVETTE)).find(i => i.item_id === 'blood-pressure')!;
  assert.deepEqual(bp.value, { systolic: 155, diastolic: 110 });
  assert.equal(bp.display_value, '155/110'); assert.equal(bp.unit, 'mmHg');
});
test('malformed categories, measurements and source fields fail at runtime', () => {
  for (const change of [
    { chart: { label: 'BMI', category: 'other' } }, { chart: null },
    { measurement: { value: true, unit: null } }, { measurement: { value: NaN, unit: null } },
    { measurement: { value: Infinity, unit: null } }, { measurement: { value: 32 } },
    { measurement: { value: 32, unit: null, unexpected: 123 } },
    { measurement: { systolic: 155, diastolic: 110, unit: 'wrong' } }, { source_field: 'missing-field' },
  ]) {
    const profile = loadPatientProfile(WYATT); Object.assign(profile.facts[0], change);
    assert.throws(() => prepareChartItems(profile), ChartValidationError);
  }
});
test('projection derives current fact values without mutating the profile', () => {
  const profile = loadPatientProfile(WYATT); profile.facts[0].measurement = { value: 33, unit: 'kg/m^2' };
  const result = buildChartResponse(profile); assert.equal(result.items[0].value, 33);
  result.items[0].source_reference.field = 'changed'; assert.equal(profile.facts[0].source_field, 'notes');
});
test('both patients share consistent item keys and provenance', () => {
  let keys: string[] | undefined;
  for (const id of [WYATT, YVETTE]) {
    const profile = loadPatientProfile(id);
    for (const item of buildChartResponse(profile, profile.facts.map(f => f.id)).items) {
      keys ??= Object.keys(item).sort(); assert.deepEqual(Object.keys(item).sort(), keys);
      assert.equal(item.source_reference.patient_uuid, id);
    }
  }
});
test('frontend JSON fixtures match TypeScript projections exactly', () => {
  for (const [id, slug, released] of [[WYATT, 'wyatt', ['constipation']], [YVETTE, 'yvette', ['sodium-confusion']]] as const) {
    for (const [label, ids] of [['initial', []], ['after-disclosure', released]] as const) {
      const fixture = JSON.parse(readFileSync(new URL(`../docs/examples/${slug}-chart-${label}.json`, import.meta.url), 'utf8'));
      assert.deepEqual(buildChartResponse(loadPatientProfile(id), ids), fixture);
    }
  }
});
test('non-chart releases add no items; empty chart catalogs fail', () => {
  const profile = loadPatientProfile(WYATT); delete profile.facts[4].chart;
  assert.equal(buildChartResponse(profile, new Set(['constipation'])).items.length, 4);
  for (const fact of profile.facts) delete fact.chart;
  assert.throws(() => prepareChartItems(profile), ChartValidationError);
});
