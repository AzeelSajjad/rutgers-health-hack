// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth0Client, Auth0Client } from '@auth0/auth0-spa-js';
import { AuthApp } from './AuthApp';

vi.mock('@auth0/auth0-spa-js', () => ({ createAuth0Client: vi.fn(), Auth0Client: vi.fn(function(){return auth;}) }));
const auth = {
  handleRedirectCallback: vi.fn(), isAuthenticated: vi.fn(), getUser: vi.fn(),
  loginWithRedirect: vi.fn(), logout: vi.fn(),
  getTokenSilently: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_AUTH0_DOMAIN','school.example.auth0.com');
  vi.stubEnv('VITE_AUTH0_AUDIENCE','https://casecoach.example/api');
  vi.stubEnv('VITE_AUTH0_CLIENT_ID','public-spa-id');
  vi.stubEnv('VITE_LOCAL_DEMO_AUTH','0');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('scrollTo', vi.fn());
  window.CASECOACH_AUTH0 = { domain: 'school.example.auth0.com', clientId: 'public-spa-id', audience: 'https://casecoach.example/api' };
  window.history.replaceState({}, '', '/');
  auth.isAuthenticated.mockResolvedValue(false);
  auth.getUser.mockResolvedValue({ sub: 'test-student', name: 'Test learner' });
  auth.handleRedirectCallback.mockResolvedValue({ appState: { casecoachAccountType: 'faculty' } });
  auth.loginWithRedirect.mockResolvedValue(undefined);
  auth.logout.mockResolvedValue(undefined);
  auth.getTokenSilently.mockResolvedValue('verified-access-token');
  vi.mocked(createAuth0Client).mockResolvedValue(auth as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('unified landing and authentication', () => {
  it('redirects on click even when background session initialization never settles', async () => {
    vi.mocked(createAuth0Client).mockReturnValue(new Promise(()=>{}));
    render(<AuthApp/>);
    expect((screen.getByRole('button',{name:'Sign in'}) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
    await waitFor(()=>expect(auth.loginWithRedirect).toHaveBeenCalled());
    expect(Auth0Client).toHaveBeenCalled();
  });
  it('explains a rejected application API grant after callback and permits retry', async () => {
    window.history.replaceState({},'','/?error=invalid_request&state=sdk-state');
    auth.handleRedirectCallback.mockRejectedValueOnce({error:'invalid_request',error_description:'Client is not authorized to access resource server https://casecoach-api'});
    render(<AuthApp/>);
    await screen.findByText(/CaseCoach is not authorized to use its API/);
    expect(window.location.search).toBe('');
    expect((screen.getByRole('button',{name:'Sign in'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('enters explicitly enabled local demo without contacting Auth0', async () => {
    vi.stubEnv('VITE_LOCAL_DEMO_AUTH','1');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({role:'student'})}));
    render(<AuthApp/>);
    await screen.findByText('Choose a patient');
    expect(createAuth0Client).not.toHaveBeenCalled();
    expect(screen.getByText(/Local student demo · Auth0 disabled/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Faculty review'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Sign out'})).toBeNull();
  });
  it('requests an API audience from Auth0 and supplies access tokens for verified roles and live encounters', async () => {
    auth.isAuthenticated.mockResolvedValue(true);
    const OriginalWebSocket = window.WebSocket;
    class TestWebSocket {
      static OPEN = 1;
      readyState = 0;
      sent: string[] = [];
      onopen?: () => void;
      onclose?: () => void;
      onmessage?: (event: { data: string }) => void;
      close() { this.readyState = 3; }
      send(value: string) { this.sent.push(value); }
      constructor() { sockets.push(this); }
    }
    const sockets: TestWebSocket[] = [];
    vi.stubGlobal('WebSocket', TestWebSocket);
    render(<AuthApp/>);
    await screen.findByText('Choose a patient');
    expect(createAuth0Client).toHaveBeenCalledWith(expect.objectContaining({ authorizationParams: { redirect_uri: window.location.origin, audience: 'https://casecoach.example/api' } }));
    expect(auth.getTokenSilently).toHaveBeenCalledWith({ detailedResponse: false });
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Begin conversation' }));
    await waitFor(() => expect(sockets.length).toBe(1));
    sockets[0]!.readyState = 1;
    sockets[0]!.onopen?.();
    await waitFor(() => expect(auth.getTokenSilently).toHaveBeenCalledWith({ detailedResponse: false }));
    await waitFor(() => expect(sockets[0]!.sent).toContain(JSON.stringify({ type: 'authenticate', token: 'verified-access-token' })));
    vi.stubGlobal('WebSocket', OriginalWebSocket);
  });
  it('keeps student/faculty signup on hosted Auth0 without granting roles', async () => {
    render(<AuthApp/>);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Student sign up' }));
    await waitFor(() => expect(auth.loginWithRedirect).toHaveBeenCalledWith({
      appState: { casecoachAccountType: 'student' }, authorizationParams: { screen_hint: 'signup' },
    }));
    await waitFor(() => expect((screen.getByRole('button', { name: /Faculty sign up/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /Faculty sign up/ }));
    await waitFor(() => expect(auth.loginWithRedirect).toHaveBeenLastCalledWith({
      appState: { casecoachAccountType: 'faculty' }, authorizationParams: { screen_hint: 'signup' },
    }));
    expect(screen.queryByText('Choose a patient')).toBeNull();
  });

  it('handles the callback and opens the existing React patient selection', async () => {
    window.history.replaceState({}, '', '/?code=one-use-code&state=verified-by-sdk');
    auth.isAuthenticated.mockResolvedValue(true);
    render(<AuthApp/>);
    await screen.findByText('Choose a patient');
    expect(auth.handleRedirectCallback).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
    expect(screen.getAllByText('Wyatt Nelson').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText('Welcome to CaseCoach');
    expect(auth.logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
  });

  it('continues to preview when storage/SDK initialization fails, ignoring malformed old prototype progress', async () => {
    localStorage.setItem('casecoach.practice.v1.demo', '[{"caseId":"04","date":"invalid"}]');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    vi.mocked(createAuth0Client).mockRejectedValue(new DOMException('Denied', 'SecurityError'));
    render(<AuthApp/>);
    await screen.findByText(/Browser storage is blocked/);
    fireEvent.click(screen.getByRole('button', { name: 'Preview demo without signing in' }));
    await screen.findByText('Choose a patient');
    fireEvent.click(screen.getAllByRole('button', { name: 'Start encounter' })[0]!);
    expect((screen.getByRole('button', { name: 'Live AI' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(screen.getByText('Welcome to CaseCoach')).toBeTruthy();
  });

  it('closes the encounter and offers recovery when hosted sign out fails', async () => {
    auth.isAuthenticated.mockResolvedValue(true);
    auth.logout.mockRejectedValueOnce(new Error('offline'));
    render(<AuthApp/>);
    await screen.findByText('Choose a patient');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    const retry = await screen.findByRole('button', { name: 'Retry sign out' });
    expect(screen.queryByText('Choose a patient')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry sign out' })).toBeNull());
  });
});
