import {randomInt, randomUUID} from 'node:crypto';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {buildDemoCases, parseTable} from '../imports/mimicDemo.js';
import {readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import { loadPatientProfile, PROFILE_DIRECTORY } from '../../app/profiles.js';
import { profileToCase } from './profileCase.js';
import {PatientCaseSchema, type PatientCase} from '@casecoach/shared';

export interface PracticeCaseCard {
  id: string; name: string; age: number; visitReason: string;
  origin: 'default' | 'mimic_iv_demo'; clinicalReviewStatus: 'not_reviewed' | 'reviewed'; citation?: string;
}
export interface CaseRepository {
  get(id: string): Promise<PatientCase | null>;
  generateRandom?(): Promise<PatientCase>;
  listCards?(): Promise<PracticeCaseCard[]>;
}
const unzip = promisify(gunzip);
const SOURCE_FILES = ["patients", "admissions", "diagnoses_icd", "d_icd_diagnoses"];
const SAFE_ID=/^[a-z0-9-]+$/;
const DEFAULT_IDS=new Set(['4d619156-3250-4212-8399-129f3280fab1','6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8']);
export class FileCaseRepository implements CaseRepository {
  private readonly generated = new Map<string, PatientCase>();
  private sourcePool?: { fingerprint: string; promise: Promise<PatientCase[]> };
  private lastSourceId: string | undefined;
  private readonly directories: string[];
  constructor(dir: string | string[], private readonly profilesDir = PROFILE_DIRECTORY, private readonly demoSource?: string) {this.directories=typeof dir === 'string' ? [dir] : dir;}
  async get(id: string): Promise<PatientCase | null> {
    if (!SAFE_ID.test(id)) return null;
    if (this.generated.has(id)) return this.generated.get(id)!;
    for (const dir of this.directories) {
      let raw: string;
      try {raw=await readFile(join(dir,`${id}.json`),'utf8');}
      catch(err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        try { raw=await readFile(join(dir,`${id}.simulation.json`),'utf8'); }
        catch(e) {if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;throw e;}
        return profileToCase(loadPatientProfile(id,this.profilesDir),JSON.parse(raw));
      }
      const patient=PatientCaseSchema.parse(JSON.parse(raw));
      if (patient.id !== id) throw new Error('Case filename and id do not match');
      return patient;
    }
    return null;
  }
  private async loadSourcePool(): Promise<PatientCase[]> {
    if (!this.demoSource) throw new Error('Demo source unavailable');
    const stats = await Promise.all(SOURCE_FILES.map(name => stat(join(this.demoSource!, `hosp-${name}.csv.gz`))));
    const fingerprint = stats.map(file => `${file.size}:${file.mtimeMs}:${file.ctimeMs}`).join('|');
    if (this.sourcePool?.fingerprint === fingerprint) return this.sourcePool.promise;
    const promise = this.readSourcePool();
    const entry = { fingerprint, promise };
    this.sourcePool = entry;
    try { return await promise; }
    catch (error) { if (this.sourcePool === entry) this.sourcePool = undefined; throw error; }
  }
  private async readSourcePool(): Promise<PatientCase[]> {
    const read = async (name: string, columns: string[]) => parseTable((await unzip(await readFile(join(this.demoSource!, `hosp-${name}.csv.gz`)), {maxOutputLength: 100_000_000})).toString('utf8'), columns);
    const [patients, admissions, diagnoses, dictionary] = await Promise.all([
      read('patients',['subject_id','gender','anchor_age','anchor_year']),
      read('admissions',['subject_id','hadm_id','admittime','dischtime','hospital_expire_flag','deathtime']),
      read('diagnoses_icd',['subject_id','hadm_id','seq_num','icd_code','icd_version']),
      read('d_icd_diagnoses',['icd_code','icd_version','long_title']),
    ]);
    const pool = buildDemoCases({patients, admissions, diagnoses, dictionary}, 100);
    if (!pool.length) throw new Error('No eligible demo patients');
    return pool;
  }
  async generateRandom(): Promise<PatientCase> {
    const pool = await this.loadSourcePool();
    const choices = pool.filter(patient => patient.id !== this.lastSourceId);
    const source = (choices.length ? choices : pool)[randomInt(choices.length || pool.length)];
    this.lastSourceId = source.id;
    const firstNames = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Sam', 'Avery', 'Quinn', 'Cameron', 'Robin'];
    const lastNames = ['Bennett', 'Rivera', 'Chen', 'Patel', 'Brooks', 'Reed', 'Parker', 'Ellis', 'Hayes', 'Kim', 'Santos', 'Lane'];
    const patientName = `${firstNames[randomInt(firstNames.length)]} ${lastNames[randomInt(lastNames.length)]}`;
    const patient = {...structuredClone(source), id: `random-${randomUUID()}`, patientName};
    this.generated.set(patient.id, patient);
    // Keep generated encounters bounded; existing sessions retain their own case.
    if (this.generated.size > 200) this.generated.delete(this.generated.keys().next().value!);
    return patient;
  }
  async listCards(): Promise<PracticeCaseCard[]> {
    const ids=new Set<string>();
    for(const dir of this.directories){
      let names:string[];
      try {names=await readdir(dir);}catch(err){if((err as NodeJS.ErrnoException).code==='ENOENT')continue;throw err;}
      for(const name of names) { const id=name.endsWith('.simulation.json')?name.slice(0,-16):name.endsWith('.json')?name.slice(0,-5):''; if(SAFE_ID.test(id))ids.add(id); }
    }
    const cards:PracticeCaseCard[]=[];
    for(const id of ids){
      const patient=await this.get(id);
      if(!patient || (!DEFAULT_IDS.has(id) && !patient.caseOrigin))continue;
      // Allowlist: no diagnoses, persona, source identifiers, or hidden facts in the catalog.
      cards.push({id,name:patient.patientName,age:patient.age,visitReason:patient.visitReason,
        origin:DEFAULT_IDS.has(id)?'default':'mimic_iv_demo',
        clinicalReviewStatus:patient.caseOrigin?.clinicalReviewStatus || 'not_reviewed',
        ...(patient.caseOrigin ? {citation:patient.caseOrigin.citation}:{}),
      });
    }
    return cards.sort((a,b)=>Number(b.origin==='default')-Number(a.origin==='default')||a.name.localeCompare(b.name));
  }
}
