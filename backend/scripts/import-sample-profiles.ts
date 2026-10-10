/** Rebuild selected cases using bundled reviewed fact mappings and authored rules. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';
import { listPatientCards, loadPatientProfile, validateProfile, PROFILE_DIRECTORY, type PatientProfile } from '../app/profiles.js';
import { prepareChartItems } from '../app/chart.js';

export const SELECTED_NAMES = ['Wyatt Nelson', 'Yvette Armstrong'] as const;
function clean(value: string): string { return value.trim().replace(/^"+|"+$/g, '').trim(); }
/** The bundled profiles are the reviewed mappings, not inferred clinical data. */
export function buildProfile(row: Record<string, string>): PatientProfile {
  const templateCard = listPatientCards().find(card => card.identity.name === row['patient-name']);
  if (!templateCard || !SELECTED_NAMES.some(name => name === row['patient-name'])) throw new Error('Unsupported selected patient');
  const profile = loadPatientProfile(templateCard.id);
  if (typeof row.notes !== 'string' || clean(row.notes) !== clean(profile.source_record.notes)) throw new Error(`Source notes changed for ${row['patient-name']}; review fact mappings before importing`);
  for (const field of Object.keys(profile.source_record)) if (typeof row[field] !== 'string') throw new Error(`Missing CSV field: ${field}`);
  if (!/^\d+$/.test(row.age)) throw new Error('CSV age must be an integer');
  profile.id = row['patient-uuid'];
  profile.identity = {
    name: row['patient-name'], age: Number(row.age), background: clean(row.background),
    gender: clean(row.gender), race_ethnicity: clean(row['race/ethinicity']),
    avatar: { type: 's3_reference', uri: row['patient-img'], initials: row['patient-name'].split(' ').map(part => part[0]).join('') },
  };
  profile.title = profile.summary = clean(row.summary);
  // Authored dialogue/rules also depend on the supplied personality.
  if (clean(row.personality) !== clean(profile.source_record.personality)) throw new Error('Source personality changed; review simulation rules before importing');
  profile.behavior.personality = clean(row.personality);
  profile.source_record = { ...row };
  for (const source of profile.sources) if (source.kind === 'provided_csv') source.patient_uuid = profile.id;
  validateProfile(profile);
  prepareChartItems(profile);
  return profile;
}
export function importProfiles(csvPath: string, outputDirectory = PROFILE_DIRECTORY): PatientProfile[] {
  const rows = parse(readFileSync(csvPath, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  const selected = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (!SELECTED_NAMES.some(name => name === row['patient-name'])) continue;
    if (selected.has(row['patient-name'])) throw new Error('Duplicate selected patient in CSV');
    selected.set(row['patient-name'], row);
  }
  if (selected.size !== SELECTED_NAMES.length) throw new Error('CSV must include both Wyatt Nelson and Yvette Armstrong');
  const profiles = SELECTED_NAMES.map(name => buildProfile(selected.get(name)!));
  mkdirSync(outputDirectory, { recursive: true });
  for (const profile of profiles) writeFileSync(join(outputDirectory, `${profile.slug}.json`), JSON.stringify(profile, null, 2) + '\n', 'utf8');
  return profiles;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args[0] || (args.length !== 1 && !(args.length === 3 && args[1] === '--output-directory'))) throw new Error('Usage: npm run import:profiles -- <csv_path> [--output-directory <directory>]');
  for (const profile of importProfiles(args[0], args[2])) console.log(`Built ${profile.identity.name}: ${profile.slug}.json`);
}
