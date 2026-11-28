import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../core/auth.guard';
import { TenantsService } from './tenants.service';
import { GeoService } from '../geo/geo.service';
import { SCHOOL_PROFILES, profileOf } from '@ecolemanager/shared';
import { ModulesService } from '../modules/modules.service';

/** Public directory of the platform: no sign-in. Countries (with how many schools each has) and the schools of a country. */
@Controller('directory')
export class DirectoryController {
  constructor(private readonly tenants: TenantsService, private readonly geo: GeoService, private readonly modules: ModulesService) {}

  @Public() @Get('countries')
  async countries(@Query('q') q?: string) {
    await this.geo.refresh();
    const counts = await this.tenants.countsByCountry().catch(() => ({} as Record<string, number>));
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const needle = q ? fold(q) : '';
    return this.geo.countries()
      .filter((c) => !needle || fold(c.n).includes(needle) || fold(c.fr).includes(needle) || c.c.toLowerCase() === needle)
      .map((c) => ({ c: c.c, n: c.n, fr: c.fr, k: c.k, schools: counts[c.c] ?? 0 }))
      .sort((a, b) => b.schools - a.schools || a.fr.localeCompare(b.fr))
      .slice(0, needle ? 30 : 400);
  }

  /** Schools of a country, or one school by code (`slug`): with the pages of its public site and its words, as set by its level and by its own choices. */
  @Public() @Get('schools')
  async schools(@Query('country') country?: string, @Query('q') q?: string, @Query('type') type?: string, @Query('slug') slug?: string) {
    const rows = await this.tenants.directory(country, q, type, slug);
    return rows.map((r: any) => {
      const prof = profileOf(r.school_type); const cfg = (r.config ?? {}) as { vocabulary?: Record<string, { fr?: string; en?: string }> };
      const base = { slug: r.slug, name: r.name, type: r.school_type, type_label: SCHOOL_PROFILES[r.school_type as keyof typeof SCHOOL_PROFILES]?.label, country: r.country_code, region: r.region, city: r.city };
      if (!slug) return base;
      const vocabulary = { ...prof.vocabulary } as Record<string, { fr: string; en: string }>;
      for (const [k, v] of Object.entries(cfg.vocabulary ?? {})) if (vocabulary[k]) vocabulary[k] = { fr: v.fr || vocabulary[k].fr, en: v.en || vocabulary[k].en };
      return { ...base, sections: prof.publicSections, vocabulary, site_open: this.modules.registry.isEnabled(r.slug, 'module-visitor') };
    });
  }
}
