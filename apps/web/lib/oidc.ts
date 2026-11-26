import { buildAuthorizeUrl, challengeFor, decodeClaims, parseCallback, randomToken } from './pkce';

export interface AuthConfig { mode: 'sandbox' | 'oidc' | 'password'; api_key?: string; authorization_endpoint?: string; token_endpoint?: string; end_session_endpoint?: string; clients?: { web: string }; scopes?: string }
export interface OidcSession { school: string; token: string; refresh?: string; expiresAt?: number }

const API = () => process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';
const PK = 'em_pkce';
export const redirectUri = () => `${window.location.origin}/auth/callback`;

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const r = await fetch(`${API()}/auth/config`); if (!r.ok) throw new Error(`auth config unavailable (${r.status})`);
  return (await r.json()) as AuthConfig;
}

/** Step 1: redirect to the identity provider (authorization code + PKCE S256). Nothing secret is stored: only the verifier and state, in this tab's sessionStorage. */
export async function startLogin(cfg: AuthConfig, school: string, locale: string): Promise<void> {
  const verifier = randomToken(48); const state = randomToken(16);
  sessionStorage.setItem(PK, JSON.stringify({ verifier, state, school, cfg }));
  window.location.assign(buildAuthorizeUrl({ authorizationEndpoint: cfg.authorization_endpoint!, clientId: cfg.clients!.web, redirectUri: redirectUri(), scope: cfg.scopes ?? 'openid profile email', state, challenge: await challengeFor(verifier), locale }));
}

/** Hosted password flow (Supabase Auth): JSON body, the public key goes in the `apikey` header. */
async function passwordCall(cfg: AuthConfig, grant: 'password' | 'refresh_token', body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const r = await fetch(`${cfg.token_endpoint}?grant_type=${grant}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.api_key ?? '' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status === 400 || r.status === 401 ? 'Email ou mot de passe incorrect / wrong email or password' : `sign-in unavailable (${r.status})`);
  return r.json();
}

/** Password sign-in. The school comes from the token's tenant claim (set by the access-token hook), not from what was typed. */
export async function passwordLogin(cfg: AuthConfig, email: string, password: string): Promise<OidcSession> {
  const t = await passwordCall(cfg, 'password', { email: email.trim(), password });
  const claims = decodeClaims(t.access_token);
  const isRoot = Array.isArray(claims.roles) && claims.roles.includes('root_super_admin');
  const s = toSession(isRoot ? 'root' : '', t);   // the platform owner belongs to no school: administration screens only
  if (!s.school) throw new Error('Compte non rattaché à un établissement / account not linked to a school');
  return s;
}

async function tokenCall(endpoint: string, params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  if (!r.ok) throw new Error(`token endpoint refused (${r.status})`);
  return r.json();
}
const toSession = (school: string, t: { access_token: string; refresh_token?: string; expires_in?: number }): OidcSession => {
  const claims = decodeClaims(t.access_token);
  return { school: typeof claims.tenant === 'string' ? claims.tenant : school, token: t.access_token, refresh: t.refresh_token, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined };
};

/** Step 2 (callback page): checks state, exchanges the code with the stored verifier. The school comes from the token's tenant claim, not from what was typed. */
export async function finishLogin(search: string): Promise<OidcSession> {
  const raw = sessionStorage.getItem(PK); sessionStorage.removeItem(PK);
  if (!raw) throw new Error('no sign-in in progress');
  const p = JSON.parse(raw) as { verifier: string; state: string; school: string; cfg: AuthConfig };
  const cb = parseCallback(search, p.state); if ('error' in cb) throw new Error(cb.error);
  return toSession(p.school, await tokenCall(p.cfg.token_endpoint!, { grant_type: 'authorization_code', client_id: p.cfg.clients!.web, code: cb.code, redirect_uri: redirectUri(), code_verifier: p.verifier }));
}

let inflight: Promise<OidcSession | null> | null = null;
/** Silent renewal with the refresh token (single flight, so parallel 401s trigger one refresh). Returns null when the session cannot be renewed. */
export function refreshSession(cur: OidcSession, cfg: AuthConfig): Promise<OidcSession | null> {
  if (!cur.refresh || !cfg.token_endpoint) return Promise.resolve(null);
  inflight ??= (cfg.mode === 'password' ? passwordCall(cfg, 'refresh_token', { refresh_token: cur.refresh }) : tokenCall(cfg.token_endpoint, { grant_type: 'refresh_token', client_id: cfg.clients!.web, refresh_token: cur.refresh }))
    .then((t) => toSession(cur.school, t)).catch(() => null).finally(() => { inflight = null; });
  return inflight;
}

export function logoutUrl(cfg: AuthConfig): string | null {
  if (!cfg.end_session_endpoint) return null;
  const u = new URL(cfg.end_session_endpoint); u.searchParams.set('client_id', cfg.clients!.web); u.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/login`); return u.toString();
}
