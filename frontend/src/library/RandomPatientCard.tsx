import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { PatientPresentation } from '../experience/patients';
export function RandomPatientCard({ disabled, onCreated, getAccessToken }: { getAccessToken?: () => Promise<string>; disabled: boolean; onCreated: (patient: PatientPresentation) => void }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function generate() {
    setBusy(true);setError('');
    try {
      const token = getAccessToken ? await getAccessToken() : undefined;
      const response=await fetch('/api/cases/random',{method:'POST', ...(token ? {headers:{Authorization:`Bearer ${token}`}} : {})}), data=await response.json();
      if(!response.ok)throw new Error(data.error || 'Patient generation is unavailable. Try again.');
      if(typeof data.caseId!=='string'||!/^random-[a-z0-9-]+$/.test(data.caseId)||typeof data.patient?.name!=='string'||!data.patient.name.trim()||!Number.isInteger(data.patient.age)||data.patient.age<18||typeof data.patient.visitReason!=='string')throw new Error('Invalid generated patient response.');
      onCreated({key:data.caseId,caseId:data.caseId,name:data.patient.name,age:data.patient.age,visit:data.patient.visitReason,initials:data.patient.name.split(' ').map((word:string)=>word[0]).slice(0,2).join(''),subtitle:'MIMIC-IV public demo · invented name',accent:'sage',previewOpening:'',prompts:['What would you like to discuss about your hospital history?']});
    } catch(err) {setError(err instanceof Error?err.message:'Could not generate a patient.');}
    finally {setBusy(false);}
  }
  return <article className="patient-card"><div className="case-card-top"><span className="patient-initials yvette">↻</span><span>TRY SOMEONE NEW</span></div><h2>Random patient</h2><p className="case-summary">Explore a completed hospital record from the MIMIC-IV public demo.</p><div className="case-details"><span className="detail-label">EDUCATIONAL SIMULATION</span><p>Fictional name and authored avatar. Clinical review pending.</p><a href="https://doi.org/10.13026/dp1f-ex47" target="_blank" rel="noreferrer">Dataset source ↗</a></div><button className="case-start" disabled={disabled||busy} onClick={() => void generate()}>{busy?'Creating patient…':'Generate random patient'}<ArrowRight size={18}/></button>{disabled&&<p className="case-summary">Finish the current encounter before generating another patient.</p>}{error&&<p role="alert">{error}</p>}</article>;
}
