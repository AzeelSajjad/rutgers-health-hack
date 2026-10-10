// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PatientLibrary} from './PatientLibrary';
import {parseLibrary} from './catalog';
const defaults=[{id:'wyatt',name:'Wyatt Nelson',age:18,visitReason:'Nutrition',origin:'default',clinicalReviewStatus:'not_reviewed'}, {id:'yvette',name:'Yvette Armstrong',age:64,visitReason:'Blood pressure',origin:'default',clinicalReviewStatus:'not_reviewed'}];
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shows defaults separately from imported cases and uses the correct encounter ID',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({cases:[...defaults,{id:'mimic-demo-abc',name:'Practice Patient 01',age:62,visitReason:'Hospital record discussion',origin:'mimic_iv_demo',clinicalReviewStatus:'not_reviewed',citation:'https://doi.org/10.13026/dp1f-ex47'}]})}));
  render(<PatientLibrary/>);await screen.findByText('Practice Patient 01');
  expect(screen.getByRole('heading',{name:/Default patients/})).toBeTruthy();
  expect(screen.getByRole('heading',{name:/Additional practice/})).toBeTruthy();
  expect(screen.getAllByRole('link',{name:/Start encounter/}).map(link=>link.getAttribute('href'))).toEqual(['/practice?case=wyatt','/practice?case=yvette','/practice?case=mimic-demo-abc']);
});
it('offers retry when backend is unavailable',async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ok:true,json:async()=>({cases:defaults})});vi.stubGlobal('fetch',fetchMock);
  render(<PatientLibrary/>);await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await screen.findByText('Wyatt Nelson');expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('rejects malformed cards and duplicate IDs',()=>{
  for(const value of [null,{cases:[null]},{cases:[defaults[0],defaults[0]]},{cases:[{...defaults[0],id:'../escape'}]}])expect(()=>parseLibrary(value)).toThrow();
});
