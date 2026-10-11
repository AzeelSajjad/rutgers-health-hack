// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth0Client } from '@auth0/auth0-spa-js';
import { AuthApp } from './AuthApp';

vi.mock('@auth0/auth0-spa-js', () => ({ createAuth0Client: vi.fn() }));
const auth = {
  handleRedirectCallback: vi.fn(), isAuthenticated: vi.fn(), getUser: vi.fn(),
  loginWithRedirect: vi.fn(), logout: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('scrollTo', vi.fn());
  window.CASECOACH_AUTH0 = { domain: 'school.example.auth0.com', clientId: 'public-spa-id' };
  window.history.replaceState({}, '', '/');
  auth.isAuthenticated.mockResolvedValue(false);
  auth.getUser.mockResolvedValue({ sub: 'test-student', name: 'Test learner' });
  auth.handleRedirectCallback.mockResolvedValue({ appState: { casecoachAccountType: 'faculty' } });
  auth.loginWithRedirect.mockResolvedValue(undefined);
  auth.logout.mockResolvedValue(undefined);
  vi.mocked(createAuth0Client).mockResolvedValue(auth as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('unified landing and authentication', () => {
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
    await screen.findByText(/Sign in could not initialize/);
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
