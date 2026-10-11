import {createHash} from 'node:crypto';
import {mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildDemoCases, DEMO_URL, parseTable} from '../src/imports/mimicDemo.js';

const args=process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--limit')) throw new Error('Usage: npm run import:mimic-demo -- --limit 5');
const limit=args.length ? Number(args[1]) : 5;
if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Limit must be 1–20');
// No arbitrary source path or URL: this importer only fetches the open demo release.
const output=fileURLToPath(new URL('../work/mimic-demo/cases/',import.meta.url));
const raw=fileURLToPath(new URL('../work/mimic-demo/source/',import.meta.url));
await mkdir(raw,{recursive:true});
async function download(path:string) {
  const response=await fetch(new URL(path,DEMO_URL),{signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`Demo download failed for ${path}: ${response.status}`);
  const buffer=Buffer.from(await response.arrayBuffer());
  if (buffer.length > 25_000_000) throw new Error('Unexpectedly large demo file');
  return buffer;
}
const sums=(await download('SHA256SUMS.txt')).toString('utf8');
const checksums=new Map(sums.trim().split('\n').map(line=>{const [hash,...name]=line.trim().split(/\s+/);return [name.join(' ').replace(/^\*|^\.\//g,''),hash];}));
async function verified(path:string) {
  const bytes=await download(path),expected=checksums.get(path);
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Demo checksum mismatch: ${path}`);
  await writeFile(join(raw,path.replaceAll('/','-')),bytes);return bytes;
}
const names=['patients','admissions','diagnoses_icd','d_icd_diagnoses'] as const;
const tables=await Promise.all(names.map(async name=>gunzipSync(await verified(`hosp/${name}.csv.gz`)).toString('utf8')));
const cases=buildDemoCases({
  patients:parseTable(tables[0],['subject_id','gender','anchor_age','anchor_year']),
  admissions:parseTable(tables[1],['subject_id','hadm_id','admittime','dischtime','hospital_expire_flag','deathtime']),
  diagnoses:parseTable(tables[2],['subject_id','hadm_id','seq_num','icd_code','icd_version']),
  dictionary:parseTable(tables[3],['icd_code','icd_version','long_title']),
},limit);
const license=await verified('LICENSE.txt');
await writeFile(join(raw,'SHA256SUMS.txt'),sums);
// Replace the generated library only after every download and case validates.
const staging=`${output.replace(/\/$/,'')}-staging-${process.pid}`;
await mkdir(staging,{recursive:true});
try {
  for(const patient of cases) await writeFile(join(staging,`${patient.id}.json`),JSON.stringify(patient,null,2)+'\n');
  await writeFile(join(staging,'LICENSE.txt'),license);
  await writeFile(join(staging,'ATTRIBUTION.md'),'MIMIC-IV Clinical Database Demo v2.2. Johnson et al. (2023). https://doi.org/10.13026/dp1f-ex47\nDerived clinical database: Open Database License 1.0. Names, settings and behavior are authored simulation choices. Not clinically reviewed.\n');
  await rm(output,{recursive:true,force:true});await rename(staging,output);
} finally {await rm(staging,{recursive:true,force:true});}
console.log(`Generated ${cases.length} additional demo cases in backend/work/mimic-demo/cases. Wyatt and Yvette were not modified.`);
