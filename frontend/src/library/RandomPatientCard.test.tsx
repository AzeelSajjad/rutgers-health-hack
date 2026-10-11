// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RandomPatientCard } from './RandomPatientCard';
import { App } from '../experience/App';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('opens a generated patient inside the signed-in avatar experience without replacing the Auth0 route', async () => {
  vi.stubGlobal('scrollTo',vi.fn()); HTMLElement.prototype.scrollIntoView=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({caseId:'random-test',patient:{name:'Alex Reed',age:62,visitReason:'Hospital history'}})}));
  render(<App accountName="Test learner"/>);
  fireEvent.click(screen.getByRole('button',{name:'Generate random patient'}));
  await screen.findByText('Alex Reed');
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
