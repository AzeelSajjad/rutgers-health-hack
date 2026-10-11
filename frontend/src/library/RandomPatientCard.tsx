import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { PatientPresentation } from '../experience/patients';
export function RandomPatientCard({ disabled, onCreated, getAccessToken, onBusyChange }: { onBusyChange?: (busy: boolean) => void; getAccessToken?: () => Promise<string>; disabled: boolean; onCreated: (patient: PatientPresentation) => void }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request = useRef<{ id: number; controller: AbortController } | null>(null);
  const nextId = useRef(0), disabledRef = useRef(disabled), callbackRef = useRef(onCreated), busyCallback = useRef(onBusyChange);
  disabledRef.current = disabled; callbackRef.current = onCreated; busyCallback.current = onBusyChange;
  const cancel = () => { request.current?.controller.abort(); request.current = null; setBusy(false); busyCallback.current?.(false); };
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  useEffect(() => () => { request.current?.controller.abort(); request.current = null; busyCallback.current?.(false); }, []);
  async function generate() {
    if (disabledRef.current || request.current) return;
    const current = { id: ++nextId.current, controller: new AbortController() }; request.current = current;
    const valid = () => request.current?.id === current.id && !current.controller.signal.aborted && !disabledRef.current;
    setBusy(true); busyCallback.current?.(true); setError('');
    try {
      const token = getAccessToken ? await getAccessToken() : undefined;
      if (!valid()) return;
      const response=await fetch('/api/cases/random',{method:'POST', signal:current.controller.signal, ...(token ? {headers:{Authorization:`Bearer ${token}`}} : {})}), data=await response.json();
      if (!valid()) return;
      if(!response.ok)throw new Error(data.error || 'Patient generation is unavailable. Try again.');
      if(typeof data.caseId!=='string'||!/^random-[a-z0-9-]+$/.test(data.caseId)||typeof data.patient?.name!=='string'||!data.patient.name.trim()||!Number.isInteger(data.patient.age)||data.patient.age<18||typeof data.patient.visitReason!=='string')throw new Error('Invalid generated patient response.');
      callbackRef.current({key:data.caseId,caseId:data.caseId,name:data.patient.name,age:data.patient.age,visit:data.patient.visitReason,initials:data.patient.name.split(' ').map((word:string)=>word[0]).slice(0,2).join(''),subtitle:'MIMIC-IV public demo · invented name',accent:'sage',previewOpening:'',prompts:['What would you like to discuss about your hospital history?']});
    } catch(err) { if (valid()) setError(err instanceof Error?err.message:'Could not generate a patient.'); }
    finally { if (request.current?.id === current.id) { request.current = null; setBusy(false); busyCallback.current?.(false); } }
  }
  return <article className="patient-card"><div className="case-card-top"><span className="patient-initials yvette">↻</span><span>TRY SOMEONE NEW</span></div><h2>Random patient</h2><p className="case-summary">Explore a completed hospital record from the MIMIC-IV public demo.</p><div className="case-details"><span className="detail-label">EDUCATIONAL SIMULATION</span><p>Fictional name and authored avatar. Clinical review pending.</p><a href="https://doi.org/10.13026/dp1f-ex47" target="_blank" rel="noreferrer">Dataset source ↗</a></div><button className="case-start" disabled={disabled||busy} onClick={() => void generate()}>{busy?'Creating patient…':'Generate random patient'}<ArrowRight size={18}/></button>{disabled&&<p className="case-summary">Finish the current encounter before generating another patient.</p>}{error&&<p role="alert">{error}</p>}</article>;
}
