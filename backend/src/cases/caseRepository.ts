import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {PatientCaseSchema, type PatientCase} from '@casecoach/shared';

export interface PracticeCaseCard {
  id: string; name: string; age: number; visitReason: string;
  origin: 'default' | 'mimic_iv_demo'; clinicalReviewStatus: 'not_reviewed' | 'reviewed'; citation?: string;
}
export interface CaseRepository {
  get(id: string): Promise<PatientCase | null>;
  listCards?(): Promise<PracticeCaseCard[]>;
}
const SAFE_ID=/^[a-z0-9-]+$/;
const DEFAULT_IDS=new Set(['4d619156-3250-4212-8399-129f3280fab1','6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8']);
export class FileCaseRepository implements CaseRepository {
  private readonly directories: string[];
  constructor(dir: string | string[]) {this.directories=typeof dir === 'string' ? [dir] : dir;}
  async get(id: string): Promise<PatientCase | null> {
    if (!SAFE_ID.test(id)) return null;
    for (const dir of this.directories) {
      let raw: string;
      try {raw=await readFile(join(dir,`${id}.json`),'utf8');}
      catch(err) {if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;throw err;}
      const patient=PatientCaseSchema.parse(JSON.parse(raw));
      if (patient.id !== id) throw new Error('Case filename and id do not match');
      return patient;
    }
    return null;
  }
  async listCards(): Promise<PracticeCaseCard[]> {
    const ids=new Set<string>();
    for(const dir of this.directories){
      let names:string[];
      try {names=await readdir(dir);}catch(err){if((err as NodeJS.ErrnoException).code==='ENOENT')continue;throw err;}
      for(const name of names)if(name.endsWith('.json')&&SAFE_ID.test(name.slice(0,-5)))ids.add(name.slice(0,-5));
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
