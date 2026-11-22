/** Public OIDC client configuration for the web and mobile apps (authorization-code flow with PKCE against Keycloak). Endpoints come from the issuer's discovery document, cached. */
export interface PublicAuthConfig {
  mode: 'sandbox' | 'oidc';
  issuer?: string; authorization_endpoint?: string; token_endpoint?: string; end_session_endpoint?: string;
  clients?: { web: string; mobile: string };
  scopes?: string; mobile_redirect_uri?: string;
}

export class OidcConfig {
  private cache?: { at: number; doc: Record<string, string> };
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly fetchFn: typeof fetch = fetch, private readonly ttlMs = 10 * 60_000) {}

  async get(): Promise<PublicAuthConfig> {
    if ((this.env.AUTH_MODE ?? 'oidc') === 'sandbox') return { mode: 'sandbox' };
    const issuer = this.env.OIDC_ISSUER;
    if (!issuer || !/^https:\/\//.test(issuer) && !/^http:\/\/(localhost|127\.0\.0\.1|keycloak)/.test(issuer)) throw new Error('OIDC_ISSUER is not configured (https required outside local development)');
    if (!this.cache || Date.now() - this.cache.at > this.ttlMs) {
      const r = await this.fetchFn(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`OIDC discovery failed (${r.status})`);
      const doc = (await r.json()) as Record<string, string>;
      if (doc.issuer?.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) throw new Error('OIDC discovery issuer mismatch');   // a hijacked document must not redirect users elsewhere
      this.cache = { at: Date.now(), doc };
    }
    const d = this.cache.doc;
    return {
      mode: 'oidc', issuer: d.issuer, authorization_endpoint: d.authorization_endpoint, token_endpoint: d.token_endpoint, end_session_endpoint: d.end_session_endpoint,
      clients: { web: this.env.OIDC_WEB_CLIENT_ID ?? 'ecolemanager-web', mobile: this.env.OIDC_MOBILE_CLIENT_ID ?? 'ecolemanager-mobile' },
      scopes: 'openid profile email offline_access', mobile_redirect_uri: this.env.OIDC_MOBILE_REDIRECT_URI ?? 'com.ecolemanager.pro:/oauthredirect',
    };
  }
}
