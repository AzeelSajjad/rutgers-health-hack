import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import './review.css';
const session = z.object({session_id:z.string(),patient_id:z.string(),owner_sub:z.string(),status:z.enum(['active','archiving','completed']),turn_count:z.number(),created_at:z.string()});
const pageSchema=z.object({sessions:z.array(session),nextCursor:z.string().nullable()});
const archiveSchema=z.object({session,profile:z.object({patientName:z.string().optional(),age:z.number().optional(),identity:z.object({name:z.string(),age:z.number()}).optional()}).passthrough(),messages:z.array(z.object({sequence:z.number(),role:z.enum(['student','patient']),text:z.string(),created_at:z.string()}))});
type Page=z.infer<typeof pageSchema>;type Archive=z.infer<typeof archiveSchema>;
export function FacultyReview({getAccessToken}:{getAccessToken:()=>Promise<string>}) {
  const [page,setPage]=useState<Page>({sessions:[],nextCursor:null});
  const [archive,setArchive]=useState<Archive|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(0),controller=useRef<AbortController|null>(null);
  const load=useCallback(async (path:string,kind:'page'|'archive',append=false)=>{
    const id=++request.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
    setBusy(true);setError('');
    if(kind==='archive')setArchive(null);
    try {
      const token=await getAccessToken();if(abort.signal.aborted)return;
      const response=await fetch(path,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});
      const data=await response.json();
      if(id!==request.current)return;
      if(!response.ok)throw new Error(response.status===403?'Your account does not have verified faculty access.':response.status===401?'Your sign-in expired. Sign in again.':data.error||'Could not load this session. Try again.');
      if(kind==='archive')setArchive(archiveSchema.parse(data));
      else {const next=pageSchema.parse(data);setPage(previous=>({sessions:append?[...previous.sessions,...next.sessions.filter(s=>!previous.sessions.some(p=>p.session_id===s.session_id))]:next.sessions,nextCursor:next.nextCursor}));}
    } catch(err) {if(id===request.current && !abort.signal.aborted)setError(err instanceof Error?err.message:'Could not load session review.');}
    finally {if(id===request.current)setBusy(false);}
  },[getAccessToken]);
  useEffect(()=>{void load('/api/faculty/sessions','page');return()=>{request.current++;controller.current?.abort();};},[load]);
  return <section className="faculty-review" aria-label="Faculty session review">
    <div className="review-toolbar"><p>Review completed student encounters across this app.</p><button disabled={busy} onClick={()=>{setArchive(null);void load('/api/faculty/sessions','page');}}>Refresh sessions</button></div>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Loading session review…</p>}
    {!page.sessions.length&&!busy&&!error&&<p>No clinical sessions have been saved yet.</p>}
    <div className="review-grid"><div className="review-list">{page.sessions.map(s=><article className="review-session" key={s.session_id}><h2>{s.patient_id==='4d619156-3250-4212-8399-129f3280fab1'?'Wyatt Nelson':s.patient_id==='6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8'?'Yvette Armstrong':'Generated patient'}</h2><p>{new Date(s.created_at).toLocaleString()}</p><p>Student: {s.owner_sub}</p><p>{s.status} · {s.turn_count} messages</p><small>Session: {s.session_id}</small><button disabled={busy||s.status!=='completed'} onClick={()=>void load(`/api/faculty/sessions/${encodeURIComponent(s.session_id)}/transcript`,'archive')}>Review transcript</button>{s.status!=='completed'&&<small>The transcript becomes available after the encounter finishes archiving.</small>}</article>)}{page.nextCursor&&<button disabled={busy} onClick={()=>void load(`/api/faculty/sessions?cursor=${encodeURIComponent(page.nextCursor!)}`,'page',true)}>Load more sessions</button>}</div>
    <div className="review-transcript" aria-label="Reviewed transcript">{archive?<><h2>{archive.profile.identity?.name||archive.profile.patientName||'Patient encounter'}</h2><p>Session {archive.session.session_id} · completed</p>{archive.messages.sort((a,b)=>a.sequence-b.sequence).map(message=><article className={`review-message ${message.role}`} key={message.sequence}><strong>{message.role==='student'?'Student':'Patient'}</strong><small>{new Date(message.created_at).toLocaleTimeString()}</small><p>{message.text}</p></article>)}</>:<p>Select a completed encounter to read its transcript.</p>}</div></div>
  </section>;
}
