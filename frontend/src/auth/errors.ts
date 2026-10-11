/** Explain known Auth0 failures without rendering codes, tokens or arbitrary server text. */
export function authErrorMessage(error: unknown): string {
  const value=error && typeof error==='object' ? error as {error?:unknown;error_description?:unknown;message?:unknown;name?:unknown} : {};
  const description=[value.error_description,value.message].filter(v=>typeof v==='string').join(' ');
  if(/not authorized to access resource server/i.test(description)) return 'CaseCoach is not authorized to use its API. In Auth0, enable User-Delegated Access for the CaseCoach application to the CaseCoach API, then try again.';
  if(/callback url mismatch|redirect_uri.*not/i.test(description)) return `Auth0 rejected the callback URL. Add ${window.location.origin} to the CaseCoach application's Allowed Callback URLs.`;
  if(value.error==='invalid_state' || /invalid state|state mismatch/i.test(description)) return 'The login session expired or was opened in another browser. Start Sign in again from this browser tab.';
  if(value.name==='SecurityError') return 'Browser storage is blocked. Allow site storage for CaseCoach and try signing in again.';
  if(value.error==='access_denied') return 'Auth0 denied this login. Check the application connection and access policy, then try again.';
  if(value.error==='timeout' || /timed? ?out|timeout/i.test(description)) return 'Auth0 did not respond in time. Try Sign in again or use Preview.';
  return 'Sign in failed. Check the Auth0 application settings and your connection, then try again. Preview remains available.';
}
