import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { graphql, buildSchema } from 'graphql';
import { API_SCOPES, QuotaCounter, WEBHOOK_EVENTS, can, generateClientCredentials, parseScopes, secretMatches, sha256, signAccessToken, verifyAccessToken, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, str, uuid } from '../pedagogy/validate';
import { AuditService } from '../core/audit.service';
import { WebhooksService } from './webhooks.service';

const TOKEN_TTL = 600;
export interface ApiCtx { slug: string; clientId: string; scopes: string[] }

const SDL = `
  type Student { id: ID! first_name: String! last_name: String! status: String! class_id: ID }
  type Class { id: ID! name: String! level_code: String school_year: String }
  type News { id: ID! title: String! body: String published_at: String }
  type Grade { evaluation: String! subject_code: String normalized: Float! }
  type Client { client_id: String! name: String! scopes: [String!]! }
  type Query {
    me: Client!
    students(limit: Int = 50, offset: Int = 0): [Student!]!
    classes: [Class!]!
    news(limit: Int = 20): [News!]!
    grades(student_id: ID!): [Grade!]!
  }`;
const schema = buildSchema(SDL);

/** Public API (spec 6.19): OAuth2 client credentials per school, scoped read-only REST + GraphQL, quotas, developer docs. Data is minimised: no birth dates, guardians, payments. */
@Injectable()
export class PublicApiService {
  private readonly quota = new QuotaCounter();
  private readonly tokenLimiter = new QuotaCounter();
  constructor(private readonly db: TenantDb, private readonly audit: AuditService, readonly webhooks: WebhooksService) {}
  private tx<T>(slug: string, fn: (q: Q) => Promise<T>): Promise<T> { return this.db.run(slug, (q) => fn(q)).catch((e) => mapDbError(e)); }
  private authorize(p: Principal, slug: string, perm: string) { const d = can(p, perm, { tenantId: slug }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  private secret(): string { const s = process.env.API_TOKEN_SECRET ?? process.env.SANDBOX_JWT_SECRET; if (!s || s.length < 32) throw new HttpException('API_TOKEN_SECRET (>=32 chars) is not configured', 500); return s; }

  // ---- client administration (school admins) ---------------------------------------------------------------------------
  async createClient(slug: string, p: Principal, b: any) {
    this.authorize(p, slug, 'api:manage');
    let scopes: string[]; try { scopes = parseScopes(b?.scopes, API_SCOPES); } catch (e) { throw new BadRequestException((e as Error).message); }
    const quota = b?.quota_per_hour === undefined ? 1000 : Number(b.quota_per_hour);
    if (!Number.isInteger(quota) || quota < 1 || quota > 1_000_000) throw new BadRequestException('quota_per_hour must be an integer from 1 to 1,000,000');
    const cred = generateClientCredentials();
    const row = await this.tx(slug, async (q) => (await q('INSERT INTO api_clients(name, client_id, secret_hash, scopes, quota_per_hour, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, client_id, scopes, quota_per_hour, active', [str(b?.name, 'name', 100), cred.client_id, sha256(cred.client_secret), scopes, quota, p.id]))[0]);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'apiclient.create', entity: 'api_client', entityId: row.id });
    return { ...row, client_secret: cred.client_secret, note: 'the secret is shown once; store it safely' };
  }
  async clients(slug: string, p: Principal) { this.authorize(p, slug, 'api:manage'); return this.tx(slug, (q) => q('SELECT id, name, client_id, scopes, quota_per_hour, active, created_at, revoked_at, last_used_at FROM api_clients ORDER BY created_at DESC')); }
  async revokeClient(slug: string, p: Principal, id: string) {
    this.authorize(p, slug, 'api:manage');
    const n = await this.tx(slug, async (q) => (await q('UPDATE api_clients SET active = FALSE, revoked_at = NOW() WHERE id = $1 AND active RETURNING 1', [uuid(id, 'id')])).length);
    if (!n) throw new NotFoundException('active client not found');
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'apiclient.revoke', entity: 'api_client', entityId: id });
    return { id, revoked: true };
  }
  async createWebhook(slug: string, p: Principal, b: any) {
    this.authorize(p, slug, 'api:manage');
    const url = str(b?.url, 'url', 500); const bad = this.webhooks.checkUrl(url); if (bad) throw new BadRequestException(`url refused: ${bad}`);
    const events = Array.isArray(b?.events) ? [...new Set<string>(b.events.map(String))] : [];
    if (!events.length || events.some((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))) throw new BadRequestException(`events must be a non-empty subset of ${WEBHOOK_EVENTS.join(', ')}`);
    const s = this.webhooks.newSecret();
    const row = await this.tx(slug, async (q) => (await q('INSERT INTO webhooks_out(url, secret_enc, events, created_by) VALUES ($1,$2,$3,$4) RETURNING id, url, events, active', [url, s.enc, events, p.id]))[0]);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'webhook.create', entity: 'webhook', entityId: row.id });
    return { ...row, secret: s.secret, note: 'the signing secret is shown once' };
  }
  async webhooksList(slug: string, p: Principal) { this.authorize(p, slug, 'api:manage'); return this.tx(slug, (q) => q('SELECT id, url, events, active, created_at FROM webhooks_out ORDER BY created_at DESC')); }
  async deleteWebhook(slug: string, p: Principal, id: string) {
    this.authorize(p, slug, 'api:manage');
    const n = await this.tx(slug, async (q) => (await q('DELETE FROM webhooks_out WHERE id = $1 RETURNING 1', [uuid(id, 'id')])).length);
    if (!n) throw new NotFoundException('webhook not found'); return { id, deleted: true };
  }
  async deliveries(slug: string, p: Principal, status?: string) { this.authorize(p, slug, 'api:manage'); return this.tx(slug, (q) => q("SELECT id, webhook_id, event, status, attempts, response_status, last_error, created_at, delivered_at FROM webhook_deliveries WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 200", [status ?? null])); }
  async retry(slug: string, p: Principal) { this.authorize(p, slug, 'api:manage'); return this.webhooks.retryFailed(slug); }
  async testWebhook(slug: string, p: Principal, id: string) {
    this.authorize(p, slug, 'api:manage');
    const id2 = await this.tx(slug, async (q) => { const w = (await q('SELECT id FROM webhooks_out WHERE id = $1', [uuid(id, 'id')]))[0]; if (!w) throw new NotFoundException('webhook not found'); return (await q('INSERT INTO webhook_deliveries(webhook_id, event, payload) VALUES ($1,$2,$3) RETURNING id', [id, 'ping', JSON.stringify({ event: 'ping', created_at: new Date().toISOString(), tenant: slug, data: {} })]))[0].id as string; });
    return { delivery_id: id2, status: await this.webhooks.attempt(slug, id2) };
  }

  // ---- OAuth2 client credentials -----------------------------------------------------------------------------------------
  async token(ip: string, b: any) {
    if (!this.tokenLimiter.hit(`tok|${ip}`, 30, 60_000).allowed) throw new HttpException('too many token requests', 429);
    if (b?.grant_type !== 'client_credentials') throw new BadRequestException({ error: 'unsupported_grant_type' });
    const slug = str(b?.school, 'school', 63);
    const bad = () => new UnauthorizedException({ error: 'invalid_client' });
    const cid = typeof b?.client_id === 'string' ? b.client_id : '', sec = typeof b?.client_secret === 'string' ? b.client_secret : '';
    const c = await this.db.run(slug, async (q) => (await q('SELECT client_id, secret_hash, scopes, active FROM api_clients WHERE client_id = $1', [cid]))[0]).catch(() => undefined);
    if (!c || !c.active || !secretMatches(sec, c.secret_hash)) throw bad();
    let scopes = c.scopes as string[];
    if (b.scope) { try { scopes = parseScopes(b.scope, c.scopes); } catch { throw new BadRequestException({ error: 'invalid_scope' }); } }
    return { access_token: signAccessToken(this.secret(), { cid, tenant: slug, scopes, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }), token_type: 'Bearer', expires_in: TOKEN_TTL, scope: scopes.join(' ') };
  }
  /** Verifies the bearer token, re-reads the client (revocation and scope reduction apply immediately) and enforces the hourly quota. */
  async authenticate(authorization: string | undefined, res?: { setHeader(k: string, v: string): void }): Promise<ApiCtx> {
    const m = /^Bearer (.+)$/.exec(authorization ?? ''); if (!m) throw new UnauthorizedException('missing bearer token');
    const claims = verifyAccessToken(this.secret(), m[1]!); if (!claims) throw new UnauthorizedException('invalid or expired token');
    const c = await this.db.run(claims.tenant, async (q) => { const r = (await q('SELECT client_id, scopes, quota_per_hour, active FROM api_clients WHERE client_id = $1', [claims.cid]))[0]; if (r?.active) await q('UPDATE api_clients SET last_used_at = NOW() WHERE client_id = $1', [claims.cid]); return r; }).catch(() => undefined);
    if (!c || !c.active) throw new UnauthorizedException('client revoked');
    const qt = this.quota.hit(`${claims.tenant}|${claims.cid}`, c.quota_per_hour);
    res?.setHeader('X-RateLimit-Limit', String(c.quota_per_hour)); res?.setHeader('X-RateLimit-Remaining', String(qt.remaining));
    if (!qt.allowed) { res?.setHeader('Retry-After', String(Math.ceil((qt.resetAt - Date.now()) / 1000))); throw new HttpException('quota exceeded', 429); }
    return { slug: claims.tenant, clientId: claims.cid, scopes: claims.scopes.filter((s) => (c.scopes as string[]).includes(s)) };
  }
  private need(ctx: ApiCtx, scope: string) { if (!ctx.scopes.includes(scope)) throw new ForbiddenException(`scope ${scope} is required`); }

  // ---- data (read-only, minimised) ---------------------------------------------------------------------------------------
  private page(v: unknown, def: number, max: number) { const n = v === undefined ? def : Number(v); return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : def; }
  students(ctx: ApiCtx, limit?: unknown, offset?: unknown) { this.need(ctx, 'students:read'); return this.tx(ctx.slug, (q) => q('SELECT id, first_name, last_name, status, class_id FROM students ORDER BY last_name, first_name, id LIMIT $1 OFFSET $2', [this.page(limit, 50, 200), this.page(offset, 0, 1_000_000)])); }
  classes(ctx: ApiCtx) { this.need(ctx, 'classes:read'); return this.tx(ctx.slug, (q) => q('SELECT id, name, level_code, school_year FROM classes ORDER BY name')); }
  news(ctx: ApiCtx, limit?: unknown) { this.need(ctx, 'news:read'); return this.tx(ctx.slug, (q) => q('SELECT id, title, body, published_at FROM news WHERE is_public ORDER BY published_at DESC LIMIT $1', [this.page(limit, 20, 100)])); }
  grades(ctx: ApiCtx, studentId: unknown) {
    this.need(ctx, 'grades:read');
    return this.tx(ctx.slug, (q) => q(`SELECT e.title AS evaluation, sub.code AS subject_code, g.normalized::float AS normalized FROM grades g JOIN evaluations e ON e.id = g.evaluation_id LEFT JOIN subjects sub ON sub.id = e.subject_id WHERE g.student_id = $1 ORDER BY e.title`, [uuid(studentId, 'student_id')]));
  }
  async me(ctx: ApiCtx) { const c = await this.tx(ctx.slug, async (q) => (await q('SELECT client_id, name FROM api_clients WHERE client_id = $1', [ctx.clientId]))[0]); return { client_id: ctx.clientId, name: c?.name ?? '', scopes: ctx.scopes }; }

  async graphql(ctx: ApiCtx, b: any) {
    const source = typeof b?.query === 'string' ? b.query : ''; if (!source || source.length > 5000) throw new BadRequestException('query is required (max 5000 characters)');
    const root = {
      me: () => this.me(ctx),
      students: (a: any) => this.students(ctx, a.limit, a.offset), classes: () => this.classes(ctx), news: (a: any) => this.news(ctx, a.limit), grades: (a: any) => this.grades(ctx, a.student_id),
    };
    const r = await graphql({ schema, source, rootValue: root, variableValues: b.variables && typeof b.variables === 'object' ? b.variables : undefined });
    return { data: r.data ?? null, errors: r.errors?.map((e) => ({ message: e.message })) };
  }

  /** Developer portal content (public). */
  docs() {
    return {
      name: 'ÉcoleManager Pro public API', version: 'v1',
      authentication: { type: 'OAuth2 client credentials', token_url: '/oauth/token', body: { grant_type: 'client_credentials', client_id: '…', client_secret: '…', school: '<school code>', scope: 'students:read classes:read' }, token_ttl_seconds: TOKEN_TTL, usage: 'Authorization: Bearer <access_token>' },
      scopes: API_SCOPES, quotas: 'per client and hour (header X-RateLimit-Remaining; 429 + Retry-After when exceeded)',
      rest: [{ method: 'GET', path: '/v1/me' }, { method: 'GET', path: '/v1/students?limit&offset', scope: 'students:read' }, { method: 'GET', path: '/v1/classes', scope: 'classes:read' }, { method: 'GET', path: '/v1/news?limit', scope: 'news:read' }, { method: 'GET', path: '/v1/grades?student_id', scope: 'grades:read' }],
      graphql: { method: 'POST', path: '/v1/graphql', body: { query: '{ students(limit: 5) { id first_name } }' }, schema: SDL.trim() },
      webhooks: { events: WEBHOOK_EVENTS, headers: ['x-em-event', 'x-em-timestamp', 'x-em-signature', 'x-em-delivery'], signature: 'hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)); reject timestamps older than 5 minutes', retries: 'failed deliveries can be retried from the admin console (max 5 attempts)' },
      data_minimisation: 'no birth dates, guardians, contact details, payments or messages are exposed',
      openapi: '/docs',
    };
  }
}
