import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, validateXrAsset, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, optStr, uuid } from '../pedagogy/validate';
import { AuditService } from '../core/audit.service';
import { ModulesService } from '../modules/modules.service';

export const XR_MODULE = 'module-xr';
const COLS = 'id, title, kind, format, url, ios_url, size_bytes, lesson_id, resource_id, subject_code, level_code, is_public, alt_text, created_at';

/** 3D / AR / 360° assets attached to lessons and resources, plus the public virtual tour (spec 6.21). Files live in object storage; the school registers their address. */
@Injectable()
export class XrService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly audit: AuditService) {}
  private tx<T>(slug: string, fn: (q: Q) => Promise<T>): Promise<T> { return this.db.run(slug, (q) => fn(q)).catch((e) => mapDbError(e)); }
  private requireEnabled(slug: string) { if (!this.modules.registry.isEnabled(slug, XR_MODULE)) throw new ForbiddenException('XR module is not enabled for this school'); }
  private authorize(p: Principal, slug: string, perm: string) { const d = can(p, perm, { tenantId: slug }); if (!d.allowed) throw new ForbiddenException(d.reason); }

  async create(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'xr:write');
    const problems = validateXrAsset(b ?? {}); if (problems.length) throw new BadRequestException(problems.join('; '));
    const isPublic = b.is_public === true;
    if (isPublic) { this.authorize(p, slug, 'site:write'); if (b.kind !== 'panorama_360') throw new BadRequestException('only 360° panoramas can be public (virtual tour)'); }
    const lessonId = b.lesson_id ? uuid(b.lesson_id, 'lesson_id') : null; const resourceId = b.resource_id ? uuid(b.resource_id, 'resource_id') : null;
    const row = await this.tx(slug, async (q) => {
      if (lessonId) {
        const l = (await q('SELECT class_id FROM lessons WHERE id = $1', [lessonId]))[0]; if (!l) throw new NotFoundException('lesson not found');
        if (p.roles.includes('teacher') && !p.isRoot && !p.roles.some((r) => ['admin', 'tenant_super_admin', 'head'].includes(r)) && !p.classIds?.includes(l.class_id)) throw new ForbiddenException('not your class');
      }
      if (resourceId && !(await q('SELECT 1 FROM resources WHERE id = $1', [resourceId])).length) throw new NotFoundException('resource not found');
      return (await q(`INSERT INTO xr_assets(title, kind, format, url, ios_url, size_bytes, lesson_id, resource_id, subject_code, level_code, is_public, alt_text, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${COLS}`,
        [String(b.title).trim(), b.kind, String(b.format).toLowerCase(), b.url, b.ios_url ?? null, Number(b.size_bytes), lessonId, resourceId, optStr(b.subject_code, 'subject_code', 50), optStr(b.level_code, 'level_code', 50), isPublic, String(b.alt_text).trim(), p.id]))[0];
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'xr.create', entity: 'xr_asset', entityId: row.id });
    return row;
  }
  async list(slug: string, p: Principal, f: { lesson_id?: string; resource_id?: string; kind?: string }) {
    this.requireEnabled(slug); this.authorize(p, slug, 'xr:read');
    return this.tx(slug, (q) => q(`SELECT ${COLS} FROM xr_assets WHERE ($1::uuid IS NULL OR lesson_id = $1) AND ($2::uuid IS NULL OR resource_id = $2) AND ($3::text IS NULL OR kind = $3) ORDER BY created_at DESC LIMIT 200`,
      [f.lesson_id ? uuid(f.lesson_id, 'lesson_id') : null, f.resource_id ? uuid(f.resource_id, 'resource_id') : null, f.kind === 'model_3d' || f.kind === 'panorama_360' ? f.kind : null]));
  }
  async remove(slug: string, p: Principal, id: string) {
    this.requireEnabled(slug); this.authorize(p, slug, 'xr:write');
    const n = await this.tx(slug, async (q) => {
      const a = (await q('SELECT created_by FROM xr_assets WHERE id = $1', [uuid(id, 'id')]))[0]; if (!a) throw new NotFoundException('asset not found');
      if (a.created_by !== p.id && !p.roles.some((r) => ['admin', 'tenant_super_admin', 'head'].includes(r)) && !p.isRoot) throw new ForbiddenException('only the author or the administration can delete');
      return (await q('DELETE FROM xr_assets WHERE id = $1 RETURNING 1', [id])).length;
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'xr.delete', entity: 'xr_asset', entityId: id });
    return { id, deleted: n === 1 };
  }
  /** Public virtual tour: no login; only panoramas explicitly marked public. */
  async tour(slug: string) {
    this.requireEnabled(slug);
    return this.tx(slug, (q) => q("SELECT id, title, format, url, alt_text FROM xr_assets WHERE is_public AND kind = 'panorama_360' ORDER BY created_at LIMIT 50"));
  }
}
