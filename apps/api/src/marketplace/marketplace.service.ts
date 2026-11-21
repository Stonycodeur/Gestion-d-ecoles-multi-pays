import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { addedPermissions, can, consentCovers, isUpgrade, ratingSummary, reviewSubmission, type ModuleManifest, type Principal } from '@ecolemanager/shared';
import { TenantDb } from '../pedagogy/tenant-db.service';
import { mapDbError, optStr, uuid } from '../pedagogy/validate';
import { ModulesService, CORE_VERSION } from '../modules/modules.service';
import { AuditService } from '../core/audit.service';

/** Third-party module catalogue (spec 6.19). Submission and review are open to school admins; publication/withdrawal are root-only (permission marketplace:publish = root wildcard). */
@Injectable()
export class MarketplaceService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly audit: AuditService) {}
  private pool(): Pool { if (!this.modules.pool) throw new ServiceUnavailableException('marketplace needs DATABASE_URL'); return this.modules.pool; }
  private authorize(p: Principal, slug: string | undefined, perm: string) { const d = can(p, perm, slug ? { tenantId: slug } : {}); if (!d.allowed) throw new ForbiddenException(d.reason); }

  /** Names that third parties may not take: every module loaded from the platform itself (marketplace modules are the ones recorded in the catalogue). */
  private async firstPartyNames(): Promise<string[]> { const t = await this.pool().query('SELECT name FROM marketplace_modules'); const tp = new Set(t.rows.map((r: any) => r.name)); return this.modules.registry.list().map((m) => m.name).filter((n) => !tp.has(n)); }

  // ---- submission and decision ---------------------------------------------------------------------------------------
  async submit(slug: string, p: Principal, b: any) {
    this.authorize(p, slug, 'marketplace:submit');
    const manifest = b?.manifest as ModuleManifest; const sources = (b?.handlers_source ?? {}) as Record<string, string>;
    const review = reviewSubmission({ manifest, handlers_source: sources }, CORE_VERSION, await this.firstPartyNames());
    if (!review.ok) throw new BadRequestException({ message: 'submission rejected by the automated review', errors: review.errors, findings: review.findings });
    const pool = this.pool();
    const existing = (await pool.query('SELECT publisher FROM marketplace_modules WHERE name = $1', [manifest.name])).rows[0];
    if (existing && existing.publisher !== p.id) throw new ForbiddenException('this module name belongs to another publisher');
    const latest = (await pool.query("SELECT version FROM marketplace_versions WHERE module_name = $1 AND status <> 'rejected' ORDER BY submitted_at DESC LIMIT 1", [manifest.name])).rows[0];
    if (latest && !isUpgrade(latest.version, manifest.version)) throw new BadRequestException(`version must be greater than ${latest.version}`);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO marketplace_modules(name, publisher) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING", [manifest.name, p.id]);
      const row = (await c.query('INSERT INTO marketplace_versions(module_name, version, manifest, handlers_source, review, submitted_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, module_name, version, status',
        [manifest.name, manifest.version, JSON.stringify(manifest), JSON.stringify(sources), JSON.stringify(review), p.id])).rows[0];
      await c.query('COMMIT');
      await this.audit.log({ actorId: p.id, tenant: slug, action: 'marketplace.submit', entity: 'module', entityId: manifest.name, details: { version: manifest.version, risk: review.risk } });
      return { ...row, review };
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); return mapDbError(e); } finally { c.release(); }
  }
  async submissions(p: Principal, status?: string) {
    this.authorize(p, undefined, 'marketplace:publish');
    return (await this.pool().query('SELECT id, module_name, version, status, review, submitted_by, submitted_at, decided_by, decided_at, decision_note, manifest FROM marketplace_versions WHERE ($1::text IS NULL OR status = $1) ORDER BY submitted_at DESC', [status ?? null])).rows;
  }
  /** Approve = publish (root only). A version flagged for manual review needs a written sign-off. */
  async decide(p: Principal, id: string, b: any) {
    this.authorize(p, undefined, 'marketplace:publish');
    const pool = this.pool();
    const v = (await pool.query('SELECT * FROM marketplace_versions WHERE id = $1', [uuid(id, 'id')])).rows[0];
    if (!v) throw new NotFoundException('submission not found');
    if (v.status !== 'submitted') throw new BadRequestException('submission already decided');
    const note = optStr(b?.note, 'note', 1000);
    if (b?.approve !== true) {
      await pool.query("UPDATE marketplace_versions SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_note = $3 WHERE id = $1", [v.id, p.id, note]);
      await this.audit.log({ actorId: p.id, action: 'marketplace.reject', entity: 'module', entityId: v.module_name });
      return { id: v.id, status: 'rejected' };
    }
    if (v.review?.manual_review_required && !note) throw new BadRequestException('a security sign-off note is required for a module flagged for manual review');
    this.modules.registerThirdParty(v.manifest, v.handlers_source ?? {});
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("UPDATE marketplace_versions SET status = 'withdrawn' WHERE module_name = $1 AND status = 'published'", [v.module_name]);
      await c.query("UPDATE marketplace_versions SET status = 'published', decided_by = $2, decided_at = NOW(), decision_note = $3 WHERE id = $1", [v.id, p.id, note]);
      await c.query("UPDATE marketplace_modules SET status = 'published' WHERE name = $1", [v.module_name]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    await this.audit.log({ actorId: p.id, action: 'marketplace.publish', entity: 'module', entityId: v.module_name, details: { version: v.version } });
    return { id: v.id, status: 'published' };
  }
  async withdraw(p: Principal, name: string) {
    this.authorize(p, undefined, 'marketplace:publish');
    const pool = this.pool();
    const r = await pool.query("UPDATE marketplace_modules SET status = 'withdrawn' WHERE name = $1 AND status = 'published' RETURNING name", [name]);
    if (!r.rowCount) throw new NotFoundException('published module not found');
    await pool.query("UPDATE marketplace_versions SET status = 'withdrawn' WHERE module_name = $1 AND status = 'published'", [name]);
    this.modules.registry.unregister(name);   // reserved names guarantee this is a third-party module
    await this.audit.log({ actorId: p.id, action: 'marketplace.withdraw', entity: 'module', entityId: name });
    return { name, status: 'withdrawn' };
  }

  // ---- catalogue, install, reviews ---------------------------------------------------------------------------------------
  private async published(name: string) {
    const v = (await this.pool().query(`SELECT v.* FROM marketplace_versions v JOIN marketplace_modules m ON m.name = v.module_name WHERE v.module_name = $1 AND v.status = 'published' AND m.status = 'published'`, [name])).rows[0];
    if (!v) throw new NotFoundException('module not found in the catalogue');
    return v;
  }
  async catalogue(slug: string, p: Principal) {
    this.authorize(p, slug, 'marketplace:install');
    const rows = (await this.pool().query(`SELECT v.module_name, v.version, v.manifest, v.review, m.publisher,
      (SELECT COUNT(*)::int FROM module_reviews r WHERE r.module_name = v.module_name) AS reviews,
      (SELECT ROUND(AVG(rating)::numeric, 1) FROM module_reviews r WHERE r.module_name = v.module_name) AS rating
      FROM marketplace_versions v JOIN marketplace_modules m ON m.name = v.module_name WHERE v.status = 'published' AND m.status = 'published' ORDER BY v.module_name`)).rows;
    const installed = await this.db.run(slug, (q) => q('SELECT module_name, version FROM module_installs'));
    const inst = new Map(installed.map((i: any) => [i.module_name, i.version as string]));
    return rows.map((r: any) => ({ name: r.module_name, version: r.version, description: r.manifest.description, permissions: r.manifest.permissions, risk: r.review.risk, publisher: r.publisher,
      rating: r.rating === null ? null : Number(r.rating), reviews: r.reviews, installed: inst.has(r.module_name), installed_version: inst.get(r.module_name) ?? null, update_available: inst.has(r.module_name) && isUpgrade(inst.get(r.module_name)!, r.version) }));
  }
  async detail(slug: string, p: Principal, name: string) {
    this.authorize(p, slug, 'marketplace:install');
    const v = await this.published(name); const pool = this.pool();
    const history = (await pool.query("SELECT version, status, submitted_at FROM marketplace_versions WHERE module_name = $1 AND status IN ('published','withdrawn') ORDER BY submitted_at DESC", [name])).rows;
    const reviews = (await pool.query('SELECT rating, comment, created_at, tenant_slug = $2 AS mine FROM module_reviews WHERE module_name = $1 ORDER BY created_at DESC LIMIT 50', [name, slug])).rows;
    return { name, version: v.version, manifest: v.manifest, permissions_to_accept: v.manifest.permissions, risk: v.review.risk, findings: v.review.findings, history,
      reviews: reviews.map((r: any) => ({ rating: r.rating, comment: r.comment, created_at: r.created_at, mine: r.mine })), summary: ratingSummary(reviews.map((r: any) => r.rating)) };
  }
  async install(slug: string, p: Principal, name: string, b: any) {
    this.authorize(p, slug, 'marketplace:install');
    const v = await this.published(name); const required: string[] = v.manifest.permissions;
    if (!consentCovers(b?.accept_permissions, required)) throw new BadRequestException({ message: 'the permissions requested by the module must be accepted before installation', permissions: required });
    await this.db.run(slug, async (q) => { await q(`INSERT INTO module_installs(module_name, version, accepted_permissions, installed_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (module_name) DO UPDATE SET version = EXCLUDED.version, accepted_permissions = EXCLUDED.accepted_permissions, installed_by = EXCLUDED.installed_by, installed_at = NOW()`, [name, v.version, required, p.id]); }).catch((e) => mapDbError(e));
    this.modules.registry.enable(slug, name, {});
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'marketplace.install', entity: 'module', entityId: name, details: { version: v.version } });
    return { name, version: v.version, enabled: true, permissions: required };
  }
  /** Update to the latest published version. New permissions need a new explicit acceptance. */
  async update(slug: string, p: Principal, name: string, b: any) {
    this.authorize(p, slug, 'marketplace:install');
    const v = await this.published(name);
    const cur = (await this.db.run(slug, (q) => q('SELECT version, accepted_permissions FROM module_installs WHERE module_name = $1', [name])))[0];
    if (!cur) throw new NotFoundException('module is not installed');
    if (!isUpgrade(cur.version, v.version)) throw new BadRequestException('already up to date');
    const added = addedPermissions(cur.accepted_permissions, v.manifest.permissions);
    if (added.length && !consentCovers(b?.accept_permissions, added)) throw new BadRequestException({ message: 'new permissions must be accepted', permissions: added });
    await this.db.run(slug, (q) => q('UPDATE module_installs SET version = $2, accepted_permissions = $3, installed_by = $4, installed_at = NOW() WHERE module_name = $1', [name, v.version, v.manifest.permissions, p.id]));
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'marketplace.update', entity: 'module', entityId: name, details: { from: cur.version, to: v.version } });
    return { name, version: v.version, added_permissions: added };
  }
  async uninstall(slug: string, p: Principal, name: string) {
    this.authorize(p, slug, 'marketplace:install');
    const n = await this.db.run(slug, async (q) => (await q('DELETE FROM module_installs WHERE module_name = $1 RETURNING 1', [name])).length);
    if (!n) throw new NotFoundException('module is not installed');
    if (this.modules.registry.has(name)) this.modules.registry.disable(slug, name);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'marketplace.uninstall', entity: 'module', entityId: name });
    return { name, enabled: false };
  }
  async review(slug: string, p: Principal, name: string, b: any) {
    this.authorize(p, slug, 'marketplace:install');
    await this.published(name);
    const installed = await this.db.run(slug, (q) => q('SELECT 1 FROM module_installs WHERE module_name = $1', [name]));
    if (!installed.length) throw new ForbiddenException('only schools that installed the module can review it');
    const rating = Number(b?.rating); if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BadRequestException('rating must be an integer from 1 to 5');
    const r = (await this.pool().query(`INSERT INTO module_reviews(module_name, tenant_slug, rating, comment) VALUES ($1,$2,$3,$4)
      ON CONFLICT (module_name, tenant_slug) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = NOW() RETURNING module_name, rating, comment`, [name, slug, rating, optStr(b?.comment, 'comment', 1000)])).rows[0];
    return r;
  }
  async installs(slug: string, p: Principal) { this.authorize(p, slug, 'marketplace:install'); return this.db.run(slug, (q) => q('SELECT module_name, version, accepted_permissions, installed_at FROM module_installs ORDER BY module_name')); }
}
