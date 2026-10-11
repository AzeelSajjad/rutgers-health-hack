import { describe, expect, it } from 'vitest';
import { loadPatientProfile } from '../app/profiles.js';
import { profileToCase } from '../src/cases/profileCase.js';
import { readFile } from 'node:fs/promises';
import { buildPatientSystemPrompt } from '../src/engine/patientPrompt.js';

const id = '4d619156-3250-4212-8399-129f3280fab1';
async function simulation() {
  return JSON.parse(await readFile(new URL(`../cases/${id}.simulation.json`, import.meta.url), 'utf8'));
}

describe('canonical profile to engine case conversion', () => {
  it('takes identity, clinical facts, objectives and disclosure from the current profile', async () => {
    const profile = loadPatientProfile(id);
    profile.identity.age = 19;
    profile.facts[0]!.text = 'Updated faculty-reviewed BMI fact.';
    profile.facts[0]!.visibility = 'on_question';
    const c = profileToCase(profile, await simulation());
    expect(c.age).toBe(19);
    expect(c.facts[0]).toMatchObject({ content: 'Updated faculty-reviewed BMI fact.', disclosure: 'onRequest' });
    expect(c.learningObjectives).toEqual(profile.learning_objectives);
    expect(c.facts.map(f => f.id)).toEqual(profile.facts.map(f => f.id));
    expect(c.pertinentNegatives).toEqual([]);
  });

  it('keeps hidden clinical text and source records out of the unconditional persona', async () => {
    const profile = loadPatientProfile(id);
    profile.facts.find(f => f.id === 'constipation')!.text = 'UNRELEASED_TEST_FACT';
    profile.behavior.openness = 'UNRELEASED_TEST_FACT';
    const c = profileToCase(profile, await simulation());
    const initial = c.facts.filter(f => f.disclosure === 'atStart').map(f => f.id);
    expect(buildPatientSystemPrompt(c, c.initialStyleId, initial)).not.toContain('UNRELEASED_TEST_FACT');
    expect(c).not.toHaveProperty('source_record');
  });

  it('rejects stale clinical/identity overrides in simulation metadata', async () => {
    const metadata = await simulation();
    expect(() => profileToCase(loadPatientProfile(id), { ...metadata, facts: [] })).toThrow();
    expect(() => profileToCase(loadPatientProfile(id), { ...metadata, age: 21 })).toThrow();
  });
});
