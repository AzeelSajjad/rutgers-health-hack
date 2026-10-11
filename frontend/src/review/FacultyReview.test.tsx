// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {FacultyReview} from './FacultyReview';
import {App} from '../experience/App';
const getAccessToken=async()=> 'faculty-token';
const session={session_id:'s1',patient_id:'4d619156-3250-4212-8399-129f3280fab1',owner_sub:'auth0|student',status:'completed',turn_count:2,created_at:'2026-10-10T12:00:00Z'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('loads faculty sessions and renders an archived transcript with bearer authorization',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({sessions:[session],nextCursor:null})}).mockResolvedValueOnce({ok:true,json:async()=>({session,profile:{identity:{name:'Wyatt Nelson',age:18}},messages:[{sequence:1,role:'student',text:'How are you?',created_at:session.created_at},{sequence:2,role:'patient',text:'I am okay.',created_at:session.created_at}]})});
  vi.stubGlobal('fetch',fetcher);render(<FacultyReview getAccessToken={getAccessToken}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Review transcript'}));
  expect(await screen.findByText('I am okay.')).toBeTruthy();
  expect(fetcher).toHaveBeenLastCalledWith('/api/faculty/sessions/s1/transcript',expect.objectContaining({headers:{Authorization:'Bearer faculty-token'}}));
});
it('keeps unfinished archives unavailable and supports pagination',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({sessions:[{...session,status:'archiving'}],nextCursor:'page2'})}).mockResolvedValueOnce({ok:true,json:async()=>({sessions:[{...session,session_id:'s2'}],nextCursor:null})});
  vi.stubGlobal('fetch',fetcher);render(<FacultyReview getAccessToken={getAccessToken}/>);
  expect((await screen.findByRole('button',{name:'Review transcript'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Load more sessions'}));
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'Review transcript'})).toHaveLength(2));
  expect(fetcher).toHaveBeenLastCalledWith('/api/faculty/sessions?cursor=page2',expect.any(Object));
});
it('shows denied access without displaying a transcript',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:403,json:async()=>({})}));
  render(<FacultyReview getAccessToken={getAccessToken}/>);
  expect((await screen.findByRole('alert')).textContent).toContain('verified faculty');
  expect(screen.queryByRole('button',{name:'Review transcript'})).toBeNull();
});
it('connects faculty navigation to the backend role without exposing it in preview',async()=>{
  vi.stubGlobal('scrollTo',vi.fn());HTMLElement.prototype.scrollIntoView=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async(path:string)=>({ok:true,json:async()=>path==='/api/me'?{role:'faculty'}:{sessions:[],nextCursor:null}})));
  const {unmount}=render(<App getAccessToken={getAccessToken}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Faculty review'}));
  expect(await screen.findByRole('heading',{name:'Review clinical sessions'})).toBeTruthy();
  expect(await screen.findByText('No clinical sessions have been saved yet.')).toBeTruthy();
  unmount();render(<App previewOnly getAccessToken={getAccessToken}/>);
  expect(screen.queryByRole('button',{name:'Faculty review'})).toBeNull();
});
