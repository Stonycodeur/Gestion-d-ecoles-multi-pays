/** OAuth2 authorization-code + PKCE helpers (RFC 7636, S256 only) used by the web app; the mobile app relies on AppAuth for the same flow. */
const B64URL = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32): string { return B64URL(globalThis.crypto.getRandomValues(new Uint8Array(bytes))); }
export async function challengeFor(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('invalid code_verifier');
  return B64URL(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export interface AuthRequestInput { authorizationEndpoint: string; clientId: string; redirectUri: string; scope: string; state: string; challenge: string; locale?: string; loginHint?: string }
export function buildAuthorizeUrl(i: AuthRequestInput): string {
  const u = new URL(i.authorizationEndpoint);
  u.searchParams.set('response_type', 'code'); u.searchParams.set('client_id', i.clientId); u.searchParams.set('redirect_uri', i.redirectUri);
  u.searchParams.set('scope', i.scope); u.searchParams.set('state', i.state); u.searchParams.set('code_challenge', i.challenge); u.searchParams.set('code_challenge_method', 'S256');
  if (i.locale) u.searchParams.set('kc_locale', i.locale); if (i.loginHint) u.searchParams.set('login_hint', i.loginHint);
  return u.toString();
}

/** Validates the redirect back from the identity provider: provider error, missing code, or a state that is not the one we issued (CSRF). */
export function parseCallback(search: string, expectedState: string | null): { code: string } | { error: string } {
  const p = new URLSearchParams(search);
  if (p.get('error')) return { error: p.get('error_description') ?? p.get('error') ?? 'error' };
  const state = p.get('state'); const code = p.get('code');
  if (!expectedState || !state || state !== expectedState) return { error: 'state mismatch' };
  if (!code) return { error: 'missing code' };
  return { code };
}

/** Claims of an access token for display only (the API verifies the signature on every call). */
export function decodeClaims(jwt: string): Record<string, unknown> {
  try { const b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(atob(b)))) as Record<string, unknown>; } catch { return {}; }
}
