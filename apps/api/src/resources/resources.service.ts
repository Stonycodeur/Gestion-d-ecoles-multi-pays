import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, optStr, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { AuditService } from '../core/audit.service';

export const RESOURCES_MODULE = 'module-resources';
const KINDS = ['pdf', 'video', 'link', 'file'];
const STAFF = ['tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant'];

@Injectable()
export class ResourcesService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly audit: AuditService) {}
  private tx<T>(slug: string, fn: (q: Q) => Promise<T>): Promise<T> { return this.db.run(slug, (q) => fn(q)).catch((e) => mapDbError(e)); }
  private authorize(p: Principal, slug: string, perm: string) { const d = can(p, perm, { tenantId: slug }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  private enabled(slug: string) { if (!this.modules.registry.isEnabled(slug, RESOURCES_MODULE)) throw new ForbiddenException('resources module is not enabled for this school'); }
  private staff(p: Principal) { return !!p.isRoot || p.roles.some((r) => STAFF.includes(r)); }

  async list(slug: string, p: Principal, f: { q?: string; subject?: string; level?: string; tag?: string }) {
    this.enabled(slug); this.authorize(p, slug, 'resources:read');
    return this.tx(slug, (q) => q(`SELECT id, title, description, kind, url, subject_code, level_code, tags, school_year, shared, owner_user_id, created_at,
        CASE WHEN $1::text IS NULL THEN 0 ELSE ts_rank(tsv, websearch_to_tsquery('simple', $1)) END AS rank
      FROM resources WHERE ($1::text IS NULL OR tsv @@ websearch_to_tsquery('simple', $1)) AND ($2::text IS NULL OR subject_code = $2) AND ($3::text IS NULL OR level_code = $3) AND ($4::text IS NULL OR $4 = ANY(tags))
      ORDER BY rank DESC, created_at DESC LIMIT 100`, [f.q?.trim() || null, f.subject ?? null, f.level ?? null, f.tag ?? null]));
  }
  async create(slug: string, p: Principal, b: any) {
    this.enabled(slug); this.authorize(p, slug, 'resources:write');
    if (!KINDS.includes(b?.kind)) throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
    const url = str(b.url, 'url', 1000); if (!/^(https?:\/\/|\/)/.test(url)) throw new BadRequestException('url must be http(s) or a relative path');
    const tags = Array.isArray(b.tags) ? b.tags.slice(0, 20).map((t: unknown) => str(t, 'tag', 40).toLowerCase()) : [];
    const row = await this.tx(slug, async (q) => (await q(`INSERT INTO resources(title, description, kind, url, subject_code, level_code, tags, school_year, shared, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [str(b.title, 'title', 200), optStr(b.description, 'description', 4000), b.kind, url, optStr(b.subject_code, 'subject_code', 40), optStr(b.level_code, 'level_code', 40), tags, optStr(b.school_year, 'school_year', 20), b.shared === true, p.id]))[0]);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'resource.create', entity: 'resource', entityId: row.id });
    return row;
  }
  /** Re-uses a resource of a previous year in a new school year (copy, the original is untouched). Only the owner or the head/admin may do it. */
  async carryOver(slug: string, p: Principal, id: string, schoolYear: unknown) {
    this.enabled(slug); this.authorize(p, slug, 'resources:write');
    const year = str(schoolYear, 'school_year', 20);
    return this.tx(slug, async (q) => {
      const r = (await q('SELECT * FROM resources WHERE id = $1', [uuid(id, 'id')]))[0];
      if (!r) throw new NotFoundException('resource not found');
      if (r.owner_user_id !== p.id && !p.roles.some((x) => ['tenant_super_admin', 'admin', 'head'].includes(x)) && !p.isRoot && !r.shared) throw new ForbiddenException('only the owner (or a shared resource) can be carried over');
      return (await q(`INSERT INTO resources(title, description, kind, url, subject_code, level_code, tags, school_year, shared, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [r.title, r.description, r.kind, r.url, r.subject_code, r.level_code, r.tags, year, r.shared, p.id]))[0];
    });
  }

  // ---- forums ----------------------------------------------------------------------------------------------------------
  private async myClassIds(q: Q, p: Principal): Promise<string[] | null> {
    if (this.staff(p)) return null;
    const ids = p.studentId ? [p.studentId] : (p.childIds ?? []);
    return (await q('SELECT DISTINCT class_id FROM students WHERE id = ANY($1::uuid[]) AND class_id IS NOT NULL', [ids])).map((r: any) => r.class_id as string);
  }
  async forums(slug: string, p: Principal) {
    this.enabled(slug); this.authorize(p, slug, 'resources:read');
    return this.tx(slug, async (q) => { const mine = await this.myClassIds(q, p); return q('SELECT * FROM forums WHERE ($1::uuid[] IS NULL OR class_id IS NULL OR class_id = ANY($1::uuid[])) ORDER BY created_at DESC', [mine]); });
  }
  async createForum(slug: string, p: Principal, b: any) {
    this.enabled(slug); this.authorize(p, slug, 'resources:write');
    return this.tx(slug, async (q) => (await q('INSERT INTO forums(title, class_id, subject_code, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [str(b.title, 'title', 200), b.class_id ? uuid(b.class_id, 'class_id') : null, optStr(b.subject_code, 'subject_code', 40), p.id]))[0]);
  }
  private async access(q: Q, p: Principal, forumId: string) {
    const f = (await q('SELECT * FROM forums WHERE id = $1', [uuid(forumId, 'forum_id')]))[0];
    if (!f) throw new NotFoundException('forum not found');
    const mine = await this.myClassIds(q, p);
    if (mine !== null && f.class_id && !mine.includes(f.class_id)) throw new ForbiddenException('this forum belongs to another class');
    return f;
  }
  async posts(slug: string, p: Principal, forumId: string) {
    this.enabled(slug); this.authorize(p, slug, 'resources:read');
    return this.tx(slug, async (q) => { await this.access(q, p, forumId); return q('SELECT * FROM forum_posts WHERE forum_id = $1 ORDER BY created_at', [forumId]); });
  }
  async post(slug: string, p: Principal, forumId: string, b: any) {
    this.enabled(slug); this.authorize(p, slug, 'forums:post');
    const body = str(b?.body, 'body', 5000);
    return this.tx(slug, async (q) => {
      await this.access(q, p, forumId);
      if (b.parent_id && !(await q('SELECT 1 FROM forum_posts WHERE id = $1 AND forum_id = $2', [uuid(b.parent_id, 'parent_id'), forumId])).length) throw new BadRequestException('parent_id does not belong to this forum');
      const name = (await q('SELECT display_name FROM directory WHERE user_id = $1', [p.id]))[0]?.display_name ?? 'user';
      return (await q('INSERT INTO forum_posts(forum_id, parent_id, author_user_id, author_name, body) VALUES ($1,$2,$3,$4,$5) RETURNING *', [forumId, b.parent_id ?? null, p.id, name, body]))[0];
    });
  }
}
