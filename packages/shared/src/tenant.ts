const SLUG = /^[a-z0-9_]{2,40}$/;

export interface TenantInput {
  host?: string;            // Host header
  baseDomain?: string;      // e.g. ecolemanager.app
  tokenTenant?: string;     // tenant slug from the verified JWT
  headerTenant?: string;    // X-Tenant (only when allowed, e.g. mobile school code)
  allowHeader?: boolean;
}

export type TenantResolution = { slug: string; source: 'token' | 'subdomain' | 'header' } | { error: string };

/** TenantResolver rules (spec 4.3): token > subdomain; a token and a subdomain that disagree are rejected. */
export function resolveTenant(i: TenantInput): TenantResolution {
  let sub: string | undefined;
  if (i.host && i.baseDomain) {
    const host = i.host.split(':')[0].toLowerCase();
    if (host.endsWith(`.${i.baseDomain}`)) sub = host.slice(0, -(i.baseDomain.length + 1)).replace(/-/g, '_');
  }
  if (sub && !SLUG.test(sub)) return { error: 'invalid tenant subdomain' };
  if (i.tokenTenant) {
    if (!SLUG.test(i.tokenTenant)) return { error: 'invalid tenant in token' };
    if (sub && sub !== i.tokenTenant) return { error: 'tenant mismatch between token and subdomain' };
    return { slug: i.tokenTenant, source: 'token' };
  }
  if (sub) return { slug: sub, source: 'subdomain' };
  if (i.allowHeader && i.headerTenant) {
    const h = i.headerTenant.toLowerCase();
    return SLUG.test(h) ? { slug: h, source: 'header' } : { error: 'invalid tenant header' };
  }
  return { error: 'tenant not resolved' };
}
