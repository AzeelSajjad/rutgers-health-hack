// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RandomPatientCard } from './RandomPatientCard';
import { App } from '../experience/App';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('opens a generated patient inside the signed-in avatar experience without replacing the Auth0 route', async () => {
  vi.stubGlobal('scrollTo',vi.fn()); HTMLElement.prototype.scrollIntoView=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({caseId:'random-test',patient:{name:'Alex Reed',age:62,visitReason:'Hospital history'}})}));
  render(<App accountName="Test learner" getAccessToken={async () => "signed-in-token"}/>);
  fireEvent.click(screen.getByRole('button',{name:'Generate random patient'}));
  await screen.findByText('Alex Reed');
  expect(fetch).toHaveBeenCalledWith('/api/cases/random',expect.objectContaining({method:'POST',signal:expect.any(AbortSignal),headers:{Authorization:'Bearer signed-in-token'}}));
  expect(screen.getByText('Test learner')).toBeTruthy();
  expect((screen.getByRole('button',{name:'Preview'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button',{name:'Begin conversation'})).toBeTruthy();
});
it('does not offer random live patients in unauthenticated preview', () => {
  vi.stubGlobal('scrollTo',vi.fn());render(<App previewOnly/>);
  expect(screen.queryByRole('button',{name:'Generate random patient'})).toBeNull();
});
it('keeps generation disabled during an active encounter and shows errors without navigating away', async () => {
  const onCreated=vi.fn();
  const {rerender}=render(<RandomPatientCard disabled onCreated={onCreated}/>);
  expect((screen.getByRole('button',{name:'Generate random patient'}) as HTMLButtonElement).disabled).toBe(true);
  rerender(<RandomPatientCard disabled={false} onCreated={onCreated}/>);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'Import required'})}));
  fireEvent.click(screen.getByRole('button',{name:'Generate random patient'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('Import required'));
  expect(onCreated).not.toHaveBeenCalled();
});
it('ignores deferred generation after navigation and preserves a newer preview encounter', async () => {
  vi.stubGlobal('scrollTo',vi.fn()); HTMLElement.prototype.scrollIntoView=vi.fn();
  let resolve!: (value: unknown) => void;
  const pending = new Promise(resolveResponse => { resolve = resolveResponse; });
  vi.stubGlobal('fetch',vi.fn((url: string) => url === '/api/me' ? Promise.resolve({ok:true,json:async()=>({role:'student'})}) : pending));
  render(<App getAccessToken={async () => 'token'}/>);
  fireEvent.click(screen.getByRole('button',{name:'Generate random patient'}));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/cases/random',expect.objectContaining({signal:expect.any(AbortSignal)})));
  expect((screen.getAllByRole('button',{name:'Start encounter'})[0] as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole('button',{name:'Overview'})[0]!);
  fireEvent.click(screen.getByRole('button',{name:'Browse practice cases'}));
  fireEvent.click(screen.getAllByRole('button',{name:'Start encounter'})[0]!);
  fireEvent.click(screen.getByRole('button',{name:'Preview'}));
  fireEvent.click(screen.getByRole('button',{name:'Begin conversation'}));
  await import('@testing-library/react').then(({act}) => act(async () => { resolve({ok:true,json:async()=>({caseId:'random-late',patient:{name:'Late Patient',age:55,visitReason:'Hospital history'}})}); await pending; }));
  expect(screen.queryByText('Late Patient')).toBeNull();
  expect(screen.getByText('Preview conversation')).toBeTruthy();
  expect(screen.getByRole('log').textContent).toContain('Wyatt');
});
it('ignores generation responses after becoming disabled even if fetch ignores abort', async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal('fetch',vi.fn(() => new Promise(r => {resolve = r;})));
  const onCreated = vi.fn();
  const {rerender} = render(<RandomPatientCard disabled={false} onCreated={onCreated}/>);
  fireEvent.click(screen.getByRole('button',{name:'Generate random patient'}));
  rerender(<RandomPatientCard disabled onCreated={onCreated}/>);
  await import('@testing-library/react').then(({act}) => act(async () => {resolve({ok:true,json:async()=>({caseId:'random-stale',patient:{name:'Late Patient',age:55,visitReason:'Hospital history'}})});}));
  expect(onCreated).not.toHaveBeenCalled();
});
