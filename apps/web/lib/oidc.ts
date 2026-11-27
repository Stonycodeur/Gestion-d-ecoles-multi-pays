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

/** Password sign-in. The school comes from the token's tenant claim (set by the access-token hook), not from what was typed.
 *  When the account has two-step verification, `mfaFactor` is set: the session is NOT yet usable, the person must enter the code (verifyMfa). */
export async function passwordLogin(cfg: AuthConfig, email: string, password: string): Promise<OidcSession & { mfaFactor?: string }> {
  const t = await passwordCall(cfg, 'password', { email: email.trim(), password });
  const claims = decodeClaims(t.access_token);
  const isRoot = Array.isArray(claims.roles) && claims.roles.includes('root_super_admin');
  const s = toSession(isRoot ? 'root' : '', t);   // the platform owner belongs to no school: administration screens only
  if (!s.school) throw new Error('Compte non rattaché à un établissement / account not linked to a school');
  const f = (await mfaFactors(cfg, s.token)).find((x) => x.status === 'verified');
  return f ? { ...s, mfaFactor: f.id } : s;
}

const authBase = (cfg: AuthConfig): string => {
  if (cfg.mode !== 'password' || !cfg.token_endpoint) throw new Error('La double authentification se gère chez votre fournisseur d’identité / manage two-step verification at your identity provider');
  return cfg.token_endpoint.replace(/\/token$/, '');
};
const authCall = async (cfg: AuthConfig, token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${authBase(cfg)}${path}`, { method, headers: { 'content-type': 'application/json', apikey: cfg.api_key ?? '', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({})) as Record<string, any>;
  if (!r.ok) throw new Error(String(j.msg ?? j.message ?? j.error_description ?? `request refused (${r.status})`));
  return j;
};
export interface MfaFactor { id: string; status: 'verified' | 'unverified'; friendly_name?: string }
/** Two-step verification (TOTP, authenticator app) through Supabase Auth. */
export async function mfaFactors(cfg: AuthConfig, token: string): Promise<MfaFactor[]> {
  if (cfg.mode !== 'password') return [];
  try { return (((await authCall(cfg, token, 'GET', '/user')).factors ?? []) as (MfaFactor & { factor_type: string })[]).filter((f) => f.factor_type === 'totp'); } catch { return []; }
}
/** Starts enrolment: returns the QR code (data URI) and the manual key. Leftover unverified factors are removed first. */
export async function mfaEnroll(cfg: AuthConfig, token: string): Promise<{ id: string; qr: string; secret: string }> {
  for (const f of (await mfaFactors(cfg, token)).filter((x) => x.status === 'unverified')) await authCall(cfg, token, 'DELETE', `/factors/${f.id}`).catch(() => undefined);
  const j = await authCall(cfg, token, 'POST', '/factors', { factor_type: 'totp', friendly_name: `ÉcoleManager ${new Date().toISOString().slice(0, 10)}`, issuer: 'ÉcoleManager Pro' });
  const qr = String(j.totp?.qr_code ?? ''); 
  return { id: String(j.id), qr: qr.startsWith('<svg') ? `data:image/svg+xml;utf8,${encodeURIComponent(qr)}` : qr, secret: String(j.totp?.secret ?? '') };
}
/** Checks a 6-digit code against a factor; returns the upgraded (aal2) session. */
export async function verifyMfa(cfg: AuthConfig, cur: OidcSession, factorId: string, code: string): Promise<OidcSession> {
  const ch = await authCall(cfg, cur.token, 'POST', `/factors/${factorId}/challenge`);
  const t = await authCall(cfg, cur.token, 'POST', `/factors/${factorId}/verify`, { challenge_id: ch.id, code: code.replace(/\s/g, '') });
  return toSession(cur.school, t as { access_token: string; refresh_token?: string; expires_in?: number });
}
export const mfaRemove = (cfg: AuthConfig, token: string, factorId: string) => authCall(cfg, token, 'DELETE', `/factors/${factorId}`);

/** Changes the password of the signed-in user (Supabase Auth). The current password is re-checked first; the change uses the live session (already two-step verified when the account has it). */
export async function changePassword(cfg: AuthConfig, email: string, current: string, next: string, token: string): Promise<void> {
  if (cfg.mode !== 'password' || !cfg.token_endpoint) throw new Error('Le changement de mot de passe se fait chez votre fournisseur d’identité / change your password at your identity provider');
  await passwordCall(cfg, 'password', { email: email.trim(), password: current });
  await authCall(cfg, token, 'PUT', '/user', { password: next });
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
