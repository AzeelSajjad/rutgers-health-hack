import {createHash} from 'node:crypto';
import {parse} from 'csv-parse/sync';
import {PatientCaseSchema, type PatientCase} from '@casecoach/shared';

export const DEMO_URL = 'https://physionet.org/files/mimic-iv-demo/2.2/';
export const DEMO_CITATION = 'https://doi.org/10.13026/dp1f-ex47';
type Row = Record<string, string>;
export interface DemoTables {patients: Row[]; admissions: Row[]; diagnoses: Row[]; dictionary: Row[];}
export function parseTable(csv: string, required: string[]): Row[] {
  const rows = parse(csv, {columns: true, bom: true, skip_empty_lines: true}) as Row[];
  if (!rows.length || required.some(key => !(key in rows[0]))) throw new Error('Missing required MIMIC demo CSV columns');
  return rows;
}
export function buildDemoCases(tables: DemoTables, limit = 5): PatientCase[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Limit must be 1–20');
  const people = new Map(tables.patients.map(row => [row.subject_id, row]));
  if (people.size !== tables.patients.length) throw new Error('Duplicate patient identifiers');
  const dictionary = new Map(tables.dictionary.map(row => [`${row.icd_version}:${row.icd_code}`, row.long_title]));
  const diagnoses = new Map<string, Row[]>();
  for (const row of tables.diagnoses) {
    const key = `${row.subject_id}:${row.hadm_id}`;
    diagnoses.set(key, [...(diagnoses.get(key) || []), row]);
  }
  const cases: PatientCase[] = [], included = new Set<string>();
  // Deterministic: first eligible completed admission per subject, never combine stays.
  const admissions = [...tables.admissions].sort((a,b) => a.subject_id.localeCompare(b.subject_id) || a.admittime.localeCompare(b.admittime) || a.hadm_id.localeCompare(b.hadm_id));
  for (const admission of admissions) {
    if (cases.length >= limit) break;
    const person = people.get(admission.subject_id);
    if (!person || included.has(admission.subject_id) || admission.hospital_expire_flag !== '0' || admission.deathtime?.trim() || !admission.dischtime?.trim()) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(admission.admittime) || !/^\d+$/.test(person.anchor_age) || !/^\d{4}$/.test(person.anchor_year)) continue;
    // anchor_age=91 represents an obscured age >89, not an exact age. Exclude it.
    if (Number(person.anchor_age) > 89) continue;
    const age = Number(person.anchor_age) + Number(admission.admittime.slice(0,4)) - Number(person.anchor_year);
    if (age < 18 || age > 89 || !['M','F'].includes(person.gender)) continue;
    const rows = (diagnoses.get(`${person.subject_id}:${admission.hadm_id}`) || []).filter(row => /^[1-9]\d*$/.test(row.seq_num)).sort((a,b) => Number(a.seq_num)-Number(b.seq_num));
    // Require the first diagnosis to have a dictionary match, rather than inventing it.
    if (!rows.length || !dictionary.get(`${rows[0].icd_version}:${rows[0].icd_code}`)?.trim()) continue;
    const titles = [...new Set(rows.map(row => dictionary.get(`${row.icd_version}:${row.icd_code}`)?.trim()).filter((title): title is string => !!title))].slice(0,3);
    const id = `mimic-demo-${createHash('sha256').update(`${person.subject_id}:${admission.hadm_id}`).digest('hex').slice(0,16)}`;
    const patientName = `Practice Patient ${String(cases.length+1).padStart(2,'0')}`;
    const candidate = PatientCaseSchema.parse({
      id, patientName, age, sex: person.gender === 'F' ? 'female' : 'male',
      visitReason: 'Practice discussion of a completed hospital record', voiceId: 'Joanna',
      persona: 'Educational role-play using an invented name. The follow-up setting, dialogue and response styles are authored simulation choices, not recorded patient testimony. Diagnoses are hospital-record coding, not present symptoms or the reason for admission. Age is an approximate admission-year age. Missing current symptoms, medication use, allergies, lifestyle, occupation and family history are unknown, not absent. Do not invent them. Do not infer personality or behavior from sex, age or diagnosis. Keep the encounter a hypothetical discussion of a completed stay, not an acute-care assessment.',
      facts: [{id:'record-context',topic:'reason for visit',content:'This practice discussion refers to a completed hospital record. Current symptoms and treatments are not supplied.',disclosure:'atStart'},
        ...titles.map((title,index) => ({id:`record-diagnosis-${index+1}`,topic:`hospital history diagnosis ${index+1}`,content:`The completed hospital record lists: ${title}. This does not establish current symptoms or treatment.`,disclosure:'onRequest'}))],
      pertinentNegatives: [],
      learningObjectives: ['Explore recorded hospital history without assuming current symptoms.', 'Ask clear questions and acknowledge when the available record does not contain an answer.'],
      styles: [{id:'neutral',label:'Neutral',description:'Answer briefly and clearly. This style is authored, not derived from the source patient.',mayMinimize:false}, {id:'engaged',label:'Engaged',description:'Respond with a little more engagement after an empathetic question, without adding clinical details.',mayMinimize:false}],
      initialStyleId:'neutral', transitions:[{from:'neutral',cue:'acknowledged_concern',to:'engaged'}],
      caseOrigin: {kind:'mimic_iv_demo',version:'2.2',citation:DEMO_CITATION,license:'ODbL-1.0',clinicalReviewStatus:'not_reviewed',sourceSubjectId:person.subject_id,sourceAdmissionId:admission.hadm_id},
    });
    cases.push(candidate); included.add(person.subject_id);
  }
  if (!cases.length) throw new Error('No eligible adult completed admissions with matching diagnosis codes');
  return cases;
}
