export interface AuthConfig { domain: string; clientId: string; audience?: string }

declare global {
  interface Window { CASECOACH_AUTH0?: Partial<AuthConfig> }
}

export function getAuthConfig(): AuthConfig | null {
  const domain = import.meta.env.VITE_AUTH0_DOMAIN || window.CASECOACH_AUTH0?.domain;
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID || window.CASECOACH_AUTH0?.clientId;
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE || window.CASECOACH_AUTH0?.audience;
  if (!domain || !clientId || /YOUR_AUTH0_/.test(`${domain} ${clientId}`)) return null;
  return { domain, clientId, ...(audience ? { audience } : {}) };
}
