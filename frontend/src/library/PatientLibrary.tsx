import {useEffect,useState} from 'react';
import './library.css';
import {parseLibrary,type LibraryCard as Card} from './catalog';
export function PatientLibrary(){
  const [generating,setGenerating]=useState(false),[generationError,setGenerationError]=useState('');
  async function generate(){
    setGenerating(true);setGenerationError('');
    try {
      const response=await fetch('/api/cases/random',{method:'POST'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error || 'Could not generate a patient. Try again.');
      if(typeof data.caseId!=='string'||!/^random-[a-z0-9-]+$/.test(data.caseId))throw new Error('Invalid generated patient response.');
      window.location.assign(`/practice?case=${encodeURIComponent(data.caseId)}`);
    }catch(err){setGenerationError(err instanceof Error?err.message:'Could not generate a patient.');setGenerating(false);}
  }
  const [cards,setCards]=useState<Card[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch('/api/cases',{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('The case library is unavailable. Check that the backend is running.');return response.json();})
      .then(data=>setCards(parseLibrary(data)))
      .catch(err=>{if(err.name!=='AbortError')setError(err.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[retry]);
  function group(origin:Card['origin'],title:string){
    const patients=cards.filter(card=>card.origin===origin);
    return <section><h2>{title}<span>{patients.length} cases</span></h2><div className="library-cards">{patients.map(card=><article key={card.id}><span className="library-avatar">{card.origin==='mimic_iv_demo'?`P${card.name.split(' ').at(-1)}`:card.name.split(' ').map(word=>word[0]).slice(0,2).join('')}</span><h3>{card.name}</h3><p>{card.age} years · {card.visitReason}</p><small>{card.origin==='default'?'Default case':'MIMIC-IV public demo · invented name'}</small>{card.clinicalReviewStatus==='not_reviewed'&&<small>Clinical review pending</small>}<a href={`/practice?case=${encodeURIComponent(card.id)}`}>Start encounter <span aria-hidden="true">→</span></a>{card.citation&&<a className="library-source" href={card.citation} target="_blank" rel="noreferrer">Dataset source ↗</a>}</article>)}</div>{!patients.length&&<p className="library-empty">No imported cases are available yet. Your team can add them with the MIMIC demo import command.</p>}</section>;
  }
  return <main className="patient-library"><header><a href="/">casecoach<span>.</span></a><small>CLINICAL PRACTICE</small></header><p className="library-eyebrow">PRACTICE CASES</p><h1>Choose a patient</h1><p className="library-intro">Start with a familiar case, or explore an additional patient based on a hospital record.</p>{loading&&<p role="status">Loading cases…</p>}{error&&<div role="alert"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>Try again</button></div>}{!loading&&!error&&<>{group('default','Default patients')}<section><h2>Try someone new</h2><div className="library-cards"><article><span className="library-avatar">↻</span><h3>Random patient</h3><p>Meet a different patient drawn from a MIMIC-IV demo hospital record. Each click creates a new encounter.</p><small>Simulated dialogue · clinical review pending</small><button disabled={generating} onClick={generate}>{generating?'Creating patient…':'Generate random patient'}</button>{generationError&&<p role="alert">{generationError}</p>}<a className="library-source" href="https://doi.org/10.13026/dp1f-ex47" target="_blank" rel="noreferrer">Dataset source ↗</a></article></div></section></>}</main>;
}
