import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { Public, RequirePermission } from '../core/auth.guard';
import { sharedPool } from '../core/shared-pool';
import { AuditService } from '../core/audit.service';
import type { CoreRequest } from '../core/request-context';

const THEMES = ['blue', 'violet', 'orange', 'teal', 'rose'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const txt = (v: unknown, name: string, max: number, required = false): string | null => {
  if (v === undefined || v === null || v === '') { if (required) throw new BadRequestException(`${name} is required`); return null; }
  if (typeof v !== 'string' || v.trim().length > max) throw new BadRequestException(`${name} must be text of at most ${max} characters`);
  return v.trim();
};
const when = (v: unknown, name: string): string | null => { if (v === undefined || v === null || v === '') return null; const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be a date`); return d.toISOString(); };
const pool = () => { const p = sharedPool(); if (!p) throw new ServiceUnavailableException('database not configured'); return p; };

/** Highlights of the public home page: what visitors see (live ones only), and the root console that manages them. */
@Controller()
export class PlatformAdsController {
  constructor(private readonly audit: AuditService) {}

  @Public() @Get('directory/ads')
  async live() {
    return (await pool().query(`SELECT id, title_fr, title_en, text_fr, text_en, link_url, link_label_fr, link_label_en, theme FROM platform_ads
      WHERE active AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at > NOW()) ORDER BY position, created_at LIMIT 12`)).rows;
  }

  @Get('platform/ads') @RequirePermission('tenants:manage')
  async list() { return (await pool().query('SELECT * FROM platform_ads ORDER BY position, created_at')).rows; }

  private fields(b: any, partial: boolean) {
    const o: Record<string, unknown> = {};
    const put = (k: string, v: unknown) => { if (!partial || b?.[k] !== undefined) o[k] = v; };
    put('title_fr', txt(b?.title_fr, 'title_fr', 80, !partial)); put('title_en', txt(b?.title_en, 'title_en', 80, !partial));
    put('text_fr', txt(b?.text_fr, 'text_fr', 240) ?? ''); put('text_en', txt(b?.text_en, 'text_en', 240) ?? '');
    const url = txt(b?.link_url, 'link_url', 300); if (url && !/^(\/(?!\/)|https:\/\/)/.test(url)) throw new BadRequestException('link_url must be a path of this site or an https address');
    put('link_url', url); put('link_label_fr', txt(b?.link_label_fr, 'link_label_fr', 40)); put('link_label_en', txt(b?.link_label_en, 'link_label_en', 40));
    if (b?.theme !== undefined && !THEMES.includes(b.theme)) throw new BadRequestException(`theme must be one of ${THEMES.join(', ')}`);
    put('theme', b?.theme ?? 'blue');
    if (b?.position !== undefined && !Number.isInteger(b.position)) throw new BadRequestException('position must be an integer');
    put('position', b?.position ?? 0);
    if (b?.active !== undefined && typeof b.active !== 'boolean') throw new BadRequestException('active must be boolean');
    put('active', b?.active ?? true); put('starts_at', when(b?.starts_at, 'starts_at')); put('ends_at', when(b?.ends_at, 'ends_at'));
    return o;
  }

  @Post('platform/ads') @RequirePermission('tenants:manage')
  async create(@Req() r: CoreRequest, @Body() b: any) {
    const o = this.fields(b, false); const keys = Object.keys(o);
    const row = (await pool().query(`INSERT INTO platform_ads(${keys.join(',')}, created_by) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}, $${keys.length + 1}) RETURNING *`, [...keys.map((k) => o[k]), r.principal?.id])).rows[0];
    await this.audit.log({ actorId: r.principal?.id, action: 'ad.create', entity: 'platform_ad', entityId: row.id });
    return row;
  }

  @Patch('platform/ads/:id') @RequirePermission('tenants:manage')
  async update(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) {
    if (!UUID.test(id)) throw new NotFoundException('unknown ad');
    const o = this.fields(b, true); const keys = Object.keys(o); if (!keys.length) throw new BadRequestException('nothing to change');
    const row = (await pool().query(`UPDATE platform_ads SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING *`, [...keys.map((k) => o[k]), id])).rows[0];
    if (!row) throw new NotFoundException('unknown ad');
    await this.audit.log({ actorId: r.principal?.id, action: 'ad.update', entity: 'platform_ad', entityId: id });
    return row;
  }

  @Delete('platform/ads/:id') @RequirePermission('tenants:manage')
  async remove(@Req() r: CoreRequest, @Param('id') id: string) {
    if (!UUID.test(id)) throw new NotFoundException('unknown ad');
    const n = (await pool().query('DELETE FROM platform_ads WHERE id = $1', [id])).rowCount;
    if (!n) throw new NotFoundException('unknown ad');
    await this.audit.log({ actorId: r.principal?.id, action: 'ad.delete', entity: 'platform_ad', entityId: id });
    return { deleted: true };
  }
}
