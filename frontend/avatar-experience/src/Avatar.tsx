import type { PatientPresentation } from './patients';
/** Authored illustration: it does not reconstruct the supplied S3 portrait. */
export function Avatar({ patient, speaking, small = false }: { patient: PatientPresentation; speaking?: boolean; small?: boolean }) {
  const yvette = patient.key === 'yvette';
  return <svg className={`avatar-art ${speaking ? 'speaking' : ''} ${small ? 'small' : ''}`} viewBox="0 0 420 440" role="img" aria-label={`Illustrated avatar of ${patient.name}`}>
    <defs>
      <linearGradient id={`shirt-${patient.key}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={yvette ? '#849688' : '#617b9a'}/><stop offset="1" stopColor={yvette ? '#536d60' : '#3d5777'}/></linearGradient>
      <linearGradient id={`skin-${patient.key}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#edd2bb"/><stop offset="1" stopColor="#d4ae94"/></linearGradient>
    </defs>
    <ellipse cx="210" cy="426" rx="127" ry="12" fill="#29445c" opacity=".07"/>
    <path d="M73 423c4-80 28-110 95-121h84c67 11 91 41 95 121" fill={`url(#shirt-${patient.key})`}/>
    <path d="M176 272h68v44c-17 24-50 24-68 0z" fill="#d4ad93"/>
    <path d="M157 308l53 33 52-33-23 65-29-23-30 23z" fill={yvette ? '#d6ded3' : '#c1ccdc'}/>
    <path d="M119 179c-1-80 33-117 92-117 62 0 96 46 91 117l-4 69-29 37H154l-31-40z" fill={yvette ? '#7c7d78' : '#3a3836'}/>
    <ellipse cx="128" cy="207" rx="15" ry="24" fill="#d5ad91"/><ellipse cx="294" cy="207" rx="15" ry="24" fill="#d5ad91"/>
    <path d="M137 160c5-64 142-64 147 0l-4 71c-4 46-35 75-70 75s-66-29-70-75z" fill={`url(#skin-${patient.key})`}/>
    {yvette ? <path d="M119 175c-5-93 40-120 95-115 62 6 95 42 86 113-24-19-26-41-34-63-38 37-84 47-147 65z" fill="#979994"/> : <><path d="M120 174c-9-80 26-119 91-116 57 1 99 41 89 116l-23-39c-49 17-88-1-101-23-8 30-28 51-56 62z" fill="#3d3b38"/><path d="M158 70c-21-22-30 6-15 22m34-27c-11-27-33-12-23 11m36-17c-6-24-28-23-26 0m52 0c3-25-23-31-28-8m50 15c12-21-14-36-27-17m49 31c15-19-4-37-22-20" stroke="#3d3b38" strokeWidth="22" strokeLinecap="round" fill="none"/></>}
    <path d="M162 185q15-9 31 0M226 185q16-9 31 0" stroke={yvette ? '#7c7064' : '#605044'} strokeWidth="5" strokeLinecap="round" fill="none"/>
    <g className="avatar-eyes"><ellipse cx="178" cy="204" rx="5" ry="6" fill="#3b4142"/><ellipse cx="243" cy="204" rx="5" ry="6" fill="#3b4142"/></g>
    <path d="M211 206l-6 28q7 6 13 0" stroke="#bd927a" strokeWidth="3" fill="none" strokeLinecap="round"/>
    {yvette && <g fill="none" stroke="#65716b" strokeWidth="4"><rect x="149" y="192" width="51" height="33" rx="12"/><rect x="220" y="192" width="51" height="33" rx="12"/><path d="M200 204q10-7 20 0M137 197l12 4M271 201l12-4"/></g>}
    <path className="avatar-mouth" d="M191 257q19 9 38 0" fill="none" stroke="#a57466" strokeWidth="4" strokeLinecap="round"/>
    <ellipse className="avatar-speaking-mouth" cx="210" cy="262" rx="13" ry="6" fill="#95675e"/>
    <path d="M106 387l-3 34M315 387l4 34" stroke="#21374c" opacity=".18" strokeWidth="3"/>
  </svg>;
}
