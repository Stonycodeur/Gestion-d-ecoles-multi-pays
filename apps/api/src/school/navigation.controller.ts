import { BadRequestException, Body, Controller, ForbiddenException, Get, Put, Req } from '@nestjs/common';
import { SCHOOL_PROFILES, TOGGLEABLE_PAGES, NAV_CATALOG, allPermissions, profileOf, roleHas, visibleNav, type RoleCode, type Vocabulary } from '@ecolemanager/shared';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';
import { TenantsService } from './tenants.service';
import { ModulesService } from '../modules/modules.service';

const VOCAB_KEYS: (keyof Vocabulary)[] = ['student', 'students', 'teacher', 'teachers', 'head', 'class', 'classes', 'period', 'subjects', 'guardian'];

/** What the signed-in person sees in this school: pages by right, module and level, plus the school's own vocabulary and choices. */
@Controller()
export class NavigationController {
  constructor(private readonly tenants: TenantsService, private readonly modules: ModulesService) {}

  private async view(req: CoreRequest) {
    const slug = req.tenantSlug; const p = req.principal;
    if (!p) throw new ForbiddenException('sign in required');
    if (!slug) return { school: null, profile: null, groups: [], widgets: [], hidden: [], shown: [], rights: [], modules: [] };
    const t = await this.tenants.get(slug); const cfg = (t.config ?? {}) as { hidden?: string[]; shown?: string[]; vocabulary?: Record<string, { fr?: string; en?: string }> };
    const mods = this.modules.registry.activeFor(slug).map((m: { name: string }) => m.name);
    const prof = profileOf(t.school_type);
    const vocabulary = { ...prof.vocabulary } as Record<string, { fr: string; en: string }>;
    for (const k of VOCAB_KEYS) { const o = cfg.vocabulary?.[k]; if (o) vocabulary[k] = { fr: o.fr || vocabulary[k].fr, en: o.en || vocabulary[k].en }; }
    const groups = visibleNav({ roles: p.roles, isRoot: p.isRoot, schoolType: t.school_type, modules: mods, hidden: cfg.hidden, shown: cfg.shown });
    return { school: { slug: t.slug, name: t.name, type: t.school_type, country: t.country_code, city: t.city ?? null }, profile: { type: prof.type, label: prof.label, vocabulary }, groups,
      widgets: prof.homeWidgets, hidden: cfg.hidden ?? [], shown: cfg.shown ?? [], modules: mods,
      rights: allPermissions().filter((perm) => p.isRoot || p.roles.some((role) => roleHas(role as RoleCode, perm))) };
  }

  @Get('me/navigation') navigation(@Req() r: CoreRequest) { return this.view(r); }

  /** Settings screen data: the level's defaults, the school's choices, and the pages that can be switched. */
  @Get('school/profile') @RequirePermission('school:configure')
  async profile(@Req() r: CoreRequest) {
    const v = await this.view(r); if (!v.school) throw new BadRequestException('tenant required');
    const level = SCHOOL_PROFILES[v.school.type as keyof typeof SCHOOL_PROFILES];
    return { ...v, level_hidden: level.hidden, defaults: level.vocabulary,
      pages: NAV_CATALOG.filter((n) => TOGGLEABLE_PAGES.includes(n.href)).map((n) => ({ href: n.href, label: n.label, module: n.module ?? null, level_hidden: level.hidden.includes(n.href) || (!!n.types && !n.types.includes(level.type)) })) };
  }

  @Put('school/profile') @RequirePermission('school:configure')
  async save(@Req() r: CoreRequest, @Body() b: any) {
    if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required');
    const list = (x: unknown, name: string): string[] | undefined => {
      if (x === undefined) return undefined;
      if (!Array.isArray(x) || x.some((h) => typeof h !== 'string' || !TOGGLEABLE_PAGES.includes(h))) throw new BadRequestException(`${name} must be a list of known pages`);
      return [...new Set(x as string[])];
    };
    let vocabulary: Record<string, { fr?: string; en?: string }> | undefined;
    if (b?.vocabulary !== undefined) {
      if (typeof b.vocabulary !== 'object' || b.vocabulary === null) throw new BadRequestException('vocabulary must be an object');
      vocabulary = {};
      for (const [k, v] of Object.entries(b.vocabulary as Record<string, any>)) {
        if (!VOCAB_KEYS.includes(k as keyof Vocabulary)) throw new BadRequestException(`unknown term: ${k}`);
        const fr = typeof v?.fr === 'string' ? v.fr.trim().slice(0, 40) : ''; const en = typeof v?.en === 'string' ? v.en.trim().slice(0, 40) : '';
        if (fr || en) vocabulary[k] = { ...(fr ? { fr } : {}), ...(en ? { en } : {}) };
      }
    }
    await this.tenants.setProfile(r.tenantSlug, r.principal.id, { hidden: list(b?.hidden, 'hidden'), shown: list(b?.shown, 'shown'), vocabulary });
    return this.view(r);
  }
}
