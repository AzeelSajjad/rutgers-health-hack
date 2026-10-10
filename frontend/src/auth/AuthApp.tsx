import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createAuth0Client, type Auth0Client, type User } from '@auth0/auth0-spa-js';
import { getAuthConfig } from './config';
import { LandingPage } from './LandingPage';
import './landing.css';

type AccountType = 'student' | 'faculty';
interface Session { client: Auth0Client; user?: User; accountType?: AccountType }
const ExperienceApp = lazy(() => import('../experience/App').then(module => ({ default: module.App })));

export function AuthApp() {
  const [config] = useState(getAuthConfig);
  const [viewer, setViewer] = useState<{ name: string; preview: boolean } | null>(null);
  const [busy, setBusy] = useState(Boolean(config));
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [status, setStatus] = useState(config ? 'Connecting securely to Auth0…' : 'Sign in is not configured. You can explore the educational preview.');
  const client = useRef<Auth0Client | null>(null);
  const bootstrap = useRef<Promise<Session> | null>(null);
  const previewing = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!config) return;
    let mounted = true;
    const gen = generation.current;
    // Keep the PKCE callback single-use even if React mounts effects twice.
    bootstrap.current ??= (async () => {
      const auth = await createAuth0Client({ ...config, authorizationParams: { redirect_uri: window.location.origin } });
      const params = new URLSearchParams(window.location.search);
      let accountType: AccountType | undefined;
      if (params.has('state') && (params.has('code') || params.has('error'))) {
        try {
          const callback = await auth.handleRedirectCallback();
          const requested = callback.appState?.casecoachAccountType;
          if (requested === 'student' || requested === 'faculty') accountType = requested;
        } finally {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
      const user = await auth.isAuthenticated() ? await auth.getUser() : undefined;
      return { client: auth, user, accountType };
    })();
    void bootstrap.current.then(session => {
      if (!mounted) return;
      client.current = session.client;
      if (generation.current !== gen) return;
      if (session.user && !previewing.current) {
        const name = session.user.name || session.user.nickname || session.user.email || 'CaseCoach learner';
        setViewer({ name, preview: false });
      }
      setStatus(session.accountType === 'faculty' ? 'Faculty signup received. Faculty access requires institutional verification.' : 'Sign in or create an account to enter your learning space.');
    }).catch(() => {
      if (mounted && generation.current === gen) setStatus('Sign in could not initialize. Check your connection and Auth0 settings, or explore the educational preview.');
    }).finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, [config]);

  async function signIn(accountType?: AccountType) {
    if (!config) {
      setStatus('Configure the Auth0 tenant and SPA client ID to enable sign in. Preview remains available.');
      return;
    }
    setBusy(true);
    try {
      const auth = client.current ?? await createAuth0Client({ ...config, authorizationParams: { redirect_uri: window.location.origin } });
      client.current = auth;
      await auth.loginWithRedirect(accountType ? {
        appState: { casecoachAccountType: accountType },
        authorizationParams: { screen_hint: 'signup' },
      } : undefined);
    } catch {
      setStatus('Sign in could not start. Check your connection and Auth0 callback settings, then try again.');
    } finally { setBusy(false); }
  }

  async function exit() {
    const wasPreview = previewing.current;
    previewing.current = false;
    generation.current++;
    setViewer(null);
    setBusy(false);
    setLogoutFailed(false);
    if (!wasPreview && client.current) {
      setBusy(true);
      try { await client.current.logout({ logoutParams: { returnTo: window.location.origin } }); }
      catch {
        setLogoutFailed(true);
        setStatus('The practice screen is closed, but Auth0 sign out failed. Retry sign out before sharing this device.');
      } finally { setBusy(false); }
    }
  }

  if (viewer) return <Suspense fallback={<p role="status">Opening your learning space…</p>}><ExperienceApp
    accountName={viewer.name}
    previewOnly={viewer.preview}
    onExit={() => void exit()}
  /></Suspense>;

  return <LandingPage busy={busy} status={status} onRetrySignOut={logoutFailed ? () => void exit() : undefined} onSignIn={() => void signIn()}
    onSignUp={type => void signIn(type)} onPreview={() => {
      previewing.current = true;
      setViewer({ name: 'Demo learner', preview: true });
    }} />;
}
