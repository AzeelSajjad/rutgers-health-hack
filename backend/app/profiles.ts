/** Predefined case catalog. Full profiles belong only on the server. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ChartCategory } from '../docs/chart-contract.js';

export interface PatientIdentity {
  name: string;
  age: number;
  background: string;
  gender: string;
  race_ethnicity: string;
  avatar: { type: 'initials' | 's3_reference'; initials: string; uri?: string };
}
export type Visibility = 'initial' | 'on_question';
export type Measurement = { value: number; unit: string | null }
  | { systolic: number; diastolic: number; unit: 'mmHg' };
export interface PatientFact {
  id: string;
  text: string;
  visibility: Visibility;
  topics: string[];
  source_id: string;
  source_field?: string;
  chart?: { label: string; category: ChartCategory };
  measurement?: Measurement;
}
export interface PatientSource {
  id: string;
  kind: 'simulation_design' | 'research_reference' | 'provided_csv';
  description: string;
  patient_uuid?: string;
}
export interface PatientProvenance {
  case_origin: 'faculty_provided_sample';
  clinical_review_status: 'not_reviewed' | 'reviewed';
  dataset_usage: string;
  source_filename: string;
}
export interface PatientProfile {
  schema_version: 1;
  id: string;
  slug: string;
  version: number;
  kind: 'predefined';
  identity: PatientIdentity;
  title: string;
  summary: string;
  opening_statement: string;
  behavior: { personality: string; trust: string; openness: string; treatment_concerns: string; response_style: string };
  conversation_rules: string[];
  learning_objectives: string[];
  unknowns: string[];
  sources: PatientSource[];
  facts: PatientFact[];
  provenance: PatientProvenance;
  source_record: Record<string, string>;
}
export type PatientCard = Pick<PatientProfile, 'id' | 'version' | 'identity' | 'title' | 'summary' | 'provenance'>;
export class ProfileValidationError extends Error {}
export class PatientNotFoundError extends Error {}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function requireProfile(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProfileValidationError(message);
}
function textList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isText);
}
/** Validate structure, not clinical correctness. Input JSON remains untrusted. */
export function validateProfile(profile: unknown): asserts profile is PatientProfile {
  requireProfile(isRecord(profile), 'Profile must be an object');
  requireProfile(profile.schema_version === 1, 'Unsupported schema_version');
  requireProfile(isText(profile.id) && isText(profile.slug), 'Profile needs an id and slug');
  requireProfile(typeof profile.version === 'number' && Number.isInteger(profile.version) && profile.version > 0, 'Profile version must be a positive integer');
  requireProfile(profile.kind === 'predefined', 'Only predefined profiles are supported');
  const identity = profile.identity;
  requireProfile(isRecord(identity), 'Profile needs identity');
  requireProfile(isText(identity.name), 'Identity needs a name');
  requireProfile(typeof identity.age === 'number' && Number.isInteger(identity.age) && identity.age >= 18, 'This case library supports adult patients');
  for (const key of ['background', 'gender', 'race_ethnicity']) requireProfile(isText(identity[key]), `Identity needs ${key}`);
  const avatar = identity.avatar;
  requireProfile(isRecord(avatar), 'Identity needs avatar metadata');
  requireProfile(typeof avatar.type === 'string' && ['initials', 's3_reference'].includes(avatar.type), 'Unsupported avatar type');
  requireProfile(isText(avatar.initials), 'Avatar needs fallback initials');
  if (avatar.type === 's3_reference') requireProfile(isText(avatar.uri) && /^s3:\/\/[^/]+\/.+/.test(avatar.uri), 'Avatar needs an S3 image reference');
  for (const key of ['title', 'summary', 'opening_statement']) requireProfile(isText(profile[key]), `Profile needs ${key}`);
  requireProfile(isRecord(profile.behavior), 'Profile needs behavior');
  for (const key of ['personality', 'trust', 'openness', 'treatment_concerns', 'response_style']) requireProfile(isText(profile.behavior[key]), `Behavior needs ${key}`);
  for (const key of ['conversation_rules', 'learning_objectives', 'unknowns']) requireProfile(textList(profile[key]), `${key} must contain nonempty strings`);
  requireProfile(Array.isArray(profile.sources) && profile.sources.length > 0, 'Profile needs sources');
  const sourceIds = new Set<string>();
  for (const source of profile.sources) {
    requireProfile(isRecord(source), 'Source must be an object');
    requireProfile(isText(source.id) && !sourceIds.has(source.id), 'Source ids must be nonempty and unique');
    requireProfile(typeof source.kind === 'string' && ['simulation_design', 'research_reference', 'provided_csv'].includes(source.kind), 'Unsupported source kind');
    requireProfile(isText(source.description), 'Source needs a description');
    sourceIds.add(source.id);
  }
  requireProfile(Array.isArray(profile.facts) && profile.facts.length > 0, 'Profile needs facts');
  const factIds = new Set<string>();
  for (const fact of profile.facts) {
    requireProfile(isRecord(fact), 'Fact must be an object');
    requireProfile(isText(fact.id) && !factIds.has(fact.id), 'Fact ids must be nonempty and unique');
    requireProfile(isText(fact.text), 'Fact needs text');
    requireProfile(typeof fact.visibility === 'string' && ['initial', 'on_question'].includes(fact.visibility), 'Unsupported fact visibility');
    requireProfile(textList(fact.topics), 'Fact needs question topics');
    requireProfile(isText(fact.source_id) && sourceIds.has(fact.source_id), 'Fact references an unknown source');
    factIds.add(fact.id);
  }
  const provenance = profile.provenance;
  requireProfile(isRecord(provenance) && provenance.case_origin === 'faculty_provided_sample', 'This library requires faculty-provided sample provenance');
  requireProfile(typeof provenance.clinical_review_status === 'string' && ['not_reviewed', 'reviewed'].includes(provenance.clinical_review_status), 'Profile needs a clinical review status');
  requireProfile(isText(provenance.dataset_usage) && isText(provenance.source_filename), 'Profile needs dataset usage and source filename');
  requireProfile(isRecord(profile.source_record) && Object.values(profile.source_record).every(v => typeof v === 'string'), 'Profile needs a string-valued source record');
}

// Both source execution and compiled dist/app execution locate the same data.
const sourceDirectory = fileURLToPath(new URL('../data/profiles/', import.meta.url));
export const PROFILE_DIRECTORY = existsSync(sourceDirectory) ? sourceDirectory
  : fileURLToPath(new URL('../../data/profiles/', import.meta.url));
function loadProfiles(directory: string): Map<string, PatientProfile> {
  const profiles = new Map<string, PatientProfile>();
  for (const filename of readdirSync(directory).filter(name => name.endsWith('.json')).sort()) {
    const profile: unknown = JSON.parse(readFileSync(join(directory, filename), 'utf8'));
    validateProfile(profile);
    if (profiles.has(profile.id)) throw new ProfileValidationError(`Duplicate profile id: ${profile.id}`);
    profiles.set(profile.id, profile);
  }
  if (!profiles.size) throw new ProfileValidationError('No predefined profiles found');
  return profiles;
}
/** Return fresh server-only case data; never return full profiles to students. */
export function loadPatientProfile(profileId: string, directory = PROFILE_DIRECTORY): PatientProfile {
  const profile = loadProfiles(directory).get(profileId);
  if (!profile) throw new PatientNotFoundError(`Unknown patient: ${profileId}`);
  return profile;
}
function patientCard(profile: PatientProfile): PatientCard {
  const { id, version, identity, title, summary, provenance } = profile;
  return { id, version, identity, title, summary, provenance };
}
export function listPatientCards(directory = PROFILE_DIRECTORY): PatientCard[] {
  return [...loadProfiles(directory).values()].map(patientCard);
}
export function getPatientCard(profileId: string, directory = PROFILE_DIRECTORY): PatientCard {
  return patientCard(loadPatientProfile(profileId, directory));
}
