import {gzipSync} from 'node:zlib';
import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Fastify from 'fastify';
import {buildDemoCases,parseTable,type DemoTables} from '../src/imports/mimicDemo.js';
import {FileCaseRepository} from '../src/cases/caseRepository.js';
import {registerCatalogRoute} from '../src/cases/catalogRoute.js';
import {createSessionHandler} from '../src/ws/sessionHandler.js';
import {createFakeDeps} from '../src/fake/fakeDeps.js';
import type {ServerMessage} from '@casecoach/shared';
function tables():DemoTables{return {
  patients:[{subject_id:'1',gender:'F',anchor_age:'60',anchor_year:'2150'}],
  admissions:[{subject_id:'1',hadm_id:'10',admittime:'2152-02-01 12:00:00',dischtime:'2152-02-03 12:00:00',hospital_expire_flag:'0',deathtime:''}],
  diagnoses:[{subject_id:'1',hadm_id:'10',seq_num:'1',icd_code:'001',icd_version:'9'}],
  dictionary:[{icd_code:'001',icd_version:'9',long_title:'Synthetic fixture diagnosis'},{icd_code:'001',icd_version:'10',long_title:'Wrong ICD version'}],
};}
describe('MIMIC demo transformation',()=>{
  it('joins ICD version and leading-zero codes without inventing negative findings',()=>{
    const cases=buildDemoCases(tables());expect(cases).toHaveLength(1);
    expect(cases[0].age).toBe(62);expect(cases[0].patientName).toBe('Practice Patient 01');
    expect(cases[0].facts[1].content).toContain('Synthetic fixture diagnosis');
    expect(cases[0].facts[1].content).not.toContain('Wrong ICD version');
    expect(cases[0].pertinentNegatives).toEqual([]);expect(cases[0].caseOrigin?.clinicalReviewStatus).toBe('not_reviewed');
    expect(cases[0].facts[1].disclosure).toBe('onRequest');
  });
  it('does not merge diagnoses across admissions or subjects',()=>{
    const data=tables();data.diagnoses.push({subject_id:'1',hadm_id:'11',seq_num:'1',icd_code:'002',icd_version:'9'},{subject_id:'2',hadm_id:'10',seq_num:'1',icd_code:'002',icd_version:'9'});
    data.dictionary.push({icd_code:'002',icd_version:'9',long_title:'Other admission only'});
    expect(JSON.stringify(buildDemoCases(data))).not.toContain('Other admission only');
  });
  it('rejects capped ages, minors, expired or incomplete stays, and unmatched dictionaries',()=>{
    for(const mutate of [
      (d:DemoTables)=>{d.patients[0].anchor_age='91';},
      (d:DemoTables)=>{d.patients[0].anchor_age='12';},
      (d:DemoTables)=>{d.admissions[0].hospital_expire_flag='1';},
      (d:DemoTables)=>{d.admissions[0].dischtime='';},
      (d:DemoTables)=>{d.admissions[0].deathtime='2152-02-03';},
      (d:DemoTables)=>{d.dictionary=[];},
    ]){const data=tables();mutate(data);expect(()=>buildDemoCases(data)).toThrow(/No eligible/);}
  });
  it('is deterministic and emits no ethnicity-based behavior',()=>{
    const data=tables();expect(buildDemoCases(data)).toEqual(buildDemoCases(data));
    const first=buildDemoCases(data)[0];data.patients[0].gender='M';
    const second=buildDemoCases(data)[0];expect(second.persona).toBe(first.persona);expect(second.styles).toEqual(first.styles);
    expect(()=>buildDemoCases(data,0)).toThrow(/Limit/);
  });
  it('parses RFC4180 titles and verifies required CSV fields',()=>{
    expect(parseTable('icd_code,icd_version,long_title\n001,9,"Title, with comma"\n',['long_title'])[0].long_title).toBe('Title, with comma');
    expect(()=>parseTable('bad\nx\n',['long_title'])).toThrow();
  });
});
describe('case catalog and encounter integration',()=>{
  it('preserves defaults, exposes only safe cards, and starts a generated encounter',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'casecoach-demo-test-'));
    const app=Fastify();
    try{
      const patient=buildDemoCases(tables())[0];await writeFile(join(dir,patient.id+'.json'),JSON.stringify(patient));
      const repo=new FileCaseRepository([fileURLToPath(new URL('../experience-cases/',import.meta.url)),fileURLToPath(new URL('../cases/',import.meta.url)),dir]);
      const cards=await repo.listCards();expect(cards).toHaveLength(3);expect(cards.slice(0,2).map(c=>c.name)).toEqual(['Wyatt Nelson','Yvette Armstrong']);
      expect(cards[2].id).toBe(patient.id);
      const publicJson=JSON.stringify(cards);for(const privateValue of ['sourceSubjectId','sourceAdmissionId','Synthetic fixture diagnosis','persona','facts'])expect(publicJson).not.toContain(privateValue);
      registerCatalogRoute(app,repo,new Set(['http://localhost:5173']));
      const response=await app.inject({method:'GET',url:'/api/cases',headers:{origin:'http://localhost:5173'}});
      expect(response.statusCode).toBe(200);expect(response.json().cases).toHaveLength(3);
      expect((await app.inject({method:'GET',url:'/api/cases',headers:{origin:'https://unapproved.example'}})).statusCode).toBe(403);
      const events:ServerMessage[]=[];const handler=createSessionHandler(createFakeDeps(repo),event=>events.push(event));
      await handler.onMessage(JSON.stringify({type:'start_session',caseId:patient.id}));
      expect(events.some(event=>event.type==='session_started'&&event.patient.name===patient.patientName)).toBe(true);
      await handler.onMessage(JSON.stringify({type:'student_turn',text:'What is your hospital history?'}));
      expect(events.some(event=>event.type==='error')).toBe(false);
      handler.onClose();
      expect(await repo.get('../unsafe')).toBeNull();
    }finally{await app.close();await rm(dir,{recursive:true,force:true});}
  });
  it('still lists defaults when the optional imported directory does not exist',async()=>{
    const repo=new FileCaseRepository([fileURLToPath(new URL('../experience-cases/',import.meta.url)),join(tmpdir(),'nonexistent-casecoach-demo-directory')]);
    expect((await repo.listCards()).map(card=>card.origin)).toEqual(['default','default']);
  });
});

it('generates distinct encounter IDs, avoids consecutive source repeats, and keeps facts private',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'random-demo-'));
  try {
    const data=tables();data.patients.push({...data.patients[0],subject_id:'2'});data.admissions.push({...data.admissions[0],subject_id:'2',hadm_id:'20'});data.diagnoses.push({...data.diagnoses[0],subject_id:'2',hadm_id:'20'});
    for(const [name,rows] of Object.entries({patients:data.patients,admissions:data.admissions,diagnoses_icd:data.diagnoses,d_icd_diagnoses:data.dictionary})){
      const columns=Object.keys(rows[0]);await writeFile(join(dir,`hosp-${name}.csv.gz`),gzipSync(columns.join(',')+'\n'+rows.map(row=>columns.map(key=>row[key]).join(',')).join('\n')));
    }
    const repo=new FileCaseRepository([],dir),app=Fastify();registerCatalogRoute(app,repo,new Set(['http://localhost']));
    const first=await app.inject({method:'POST',url:'/api/cases/random',headers:{origin:'http://localhost'}});
    const second=await app.inject({method:'POST',url:'/api/cases/random',headers:{origin:'http://localhost'}});
    expect(first.statusCode).toBe(200);expect(Object.keys(first.json())).toEqual(['caseId']);
    const a=await repo.get(first.json().caseId),b=await repo.get(second.json().caseId);
    expect(a!.patientName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);expect(a!.patientName).not.toBe('New practice patient');expect((await repo.get(a!.id))!.patientName).toBe(a!.patientName);
    expect(a!.id).not.toBe(b!.id);expect(a!.caseOrigin!.sourceSubjectId).not.toBe(b!.caseOrigin!.sourceSubjectId);
    expect((await app.inject({method:'POST',url:'/api/cases/random',headers:{origin:'https://bad.example'}})).statusCode).toBe(403);
    await app.close();
    const unavailable=Fastify();registerCatalogRoute(unavailable,new FileCaseRepository([]),new Set());
    expect((await unavailable.inject({method:'POST',url:'/api/cases/random'})).statusCode).toBe(503);await unavailable.close();
  }finally{await rm(dir,{recursive:true,force:true});}
});
