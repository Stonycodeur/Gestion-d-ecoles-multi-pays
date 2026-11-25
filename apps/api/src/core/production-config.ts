/**
 * Refuses to start a production process with development shortcuts or weak secrets. Returns the list of problems
 * (empty = ready). Called from main.ts when NODE_ENV=production; sandbox adapters need ALLOW_SANDBOX_ADAPTERS=1 (staging/demo).
 */
const SANDBOXABLE = ['PAYMENT_MODE', 'PUSH_MODE', 'SMS_MODE', 'EMAIL_MODE', 'STORAGE_MODE', 'IDENTITY_MODE', 'MINISTRY_MODE', 'LLM_MODE', 'AI_MODE'] as const;

export function productionProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if ((env.NODE_ENV ?? 'development') !== 'production') return [];
  const p: string[] = [];
  if ((env.AUTH_MODE ?? 'oidc') !== 'oidc') p.push('AUTH_MODE must be oidc in production (sandbox tokens are for development only)');
  else for (const k of ['OIDC_ISSUER', 'OIDC_JWKS_URI', 'OIDC_AUDIENCE']) if (!env[k]) p.push(`${k} is required with AUTH_MODE=oidc`);
  if (!env.DATABASE_URL) p.push('DATABASE_URL is required (in-memory mode is for tests only)');
  for (const k of ['MESSAGE_KEY', 'GPS_KEY', 'WEBHOOK_KEY']) {
    const v = env[k];
    if (!v) { if (k !== 'WEBHOOK_KEY') p.push(`${k} is required (32 bytes, base64)`); continue; }
    if (Buffer.from(v, 'base64').length !== 32) p.push(`${k} must be 32 bytes encoded in base64`);
  }
  if ((env.PAYMENT_WEBHOOK_SECRET ?? '').length < 32) p.push('PAYMENT_WEBHOOK_SECRET (>= 32 chars) is required');
  const origins = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origins.length) p.push('CORS_ORIGINS must list the web origins (comma-separated)');
  if (origins.some((o) => o === '*' || !/^https:\/\//.test(o))) p.push('CORS_ORIGINS must be https origins, never *');
  if (env.WEBHOOK_ALLOW_PRIVATE === 'true') p.push('WEBHOOK_ALLOW_PRIVATE must not be true in production');
  if (env.ALLOW_SANDBOX_ADAPTERS !== '1') {
    const sb = SANDBOXABLE.filter((k) => (env[k] ?? 'sandbox') !== 'live');
    if (sb.length) p.push(`sandbox adapters in production: ${sb.join(', ')} (set them to live, or ALLOW_SANDBOX_ADAPTERS=1 for a staging/demo deployment)`);
  }
  return p;
}
