import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { GeoService } from './geo.service';
import { GeoAdminService } from './geo-admin.service';
import { TenantsService } from '../school/tenants.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const rid = (v: unknown): number => { const n = Number(v); if (!Number.isInteger(n)) throw new BadRequestException('region must be a region id'); return n; };

/** World geography for signed-in users (reference data, no personal data); changing it and activating a country are reserved to the root super-admin. */
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService, private readonly admin: GeoAdminService, private readonly tenants: TenantsService) {}

  @Get('continents') async continents() { await this.geo.refresh(); return this.geo.continents(); }

  /** Dialling codes for the phone fields of the personal space (every signed-in user). */
  @Get('dial-codes') async dial() {
    await this.geo.refresh();
    return this.geo.countries().filter((c) => c.ph).map((c) => ({ c: c.c, n: c.n, fr: c.fr, ph: c.ph, d: c.d, em: c.em })).sort((a, b) => a.fr.localeCompare(b.fr));
  }

  /** Countries of a continent (or all), flagged `activated` when schools can already be created there. */
  @Get('countries') @RequirePermission('tenants:manage')
  async countries(@Query('continent') continent?: string, @Query('q') q?: string) {
    await this.geo.refresh();
    const on = new Map((await this.tenants.activated()).map((c) => [c.code as string, c.schools as number]));
    return this.geo.countries(continent || undefined, q).map((c) => ({ ...c, activated: on.has(c.c), schools: on.get(c.c) ?? 0 }));
  }
  @Get('countries/:iso') @RequirePermission('tenants:manage')
  async country(@Param('iso') iso: string) {
    await this.geo.refresh();
    const c = this.geo.country(iso);
    const on = (await this.tenants.activated()).find((x) => x.code === c.c);
    return { ...c, activated: !!on, schools: on?.schools ?? 0 };
  }
  @Get('countries/:iso/regions') async regions(@Param('iso') iso: string) { await this.geo.refresh(); return this.geo.regions(iso); }
  @Get('countries/:iso/cities')
  async cities(@Param('iso') iso: string, @Query('region') region?: string, @Query('q') q?: string, @Query('limit') limit?: string) {
    await this.geo.refresh();
    return this.geo.cities(iso, region === undefined || region === '' ? undefined : rid(region), q, Math.min(Math.max(Number(limit) || 50, 1), 500));
  }
  @Post('countries/:iso/activate') @RequirePermission('tenants:manage')
  activate(@Req() r: CoreRequest, @Param('iso') iso: string, @Body() b: any) { return this.tenants.activateCountry(r.principal!.id, iso, b); }

  // ----- management (root super-admin)
  @Post('continents') @RequirePermission('tenants:manage') addContinent(@Req() r: CoreRequest, @Body() b: any) { return this.admin.createContinent(r.principal!.id, b); }
  @Patch('continents/:code') @RequirePermission('tenants:manage') editContinent(@Req() r: CoreRequest, @Param('code') c: string, @Body() b: any) { return this.admin.updateContinent(r.principal!.id, c.toUpperCase(), b); }
  @Delete('continents/:code') @RequirePermission('tenants:manage') delContinent(@Req() r: CoreRequest, @Param('code') c: string) { return this.admin.trashContinent(r.principal!.id, c.toUpperCase()); }

  @Post('countries') @RequirePermission('tenants:manage') addCountry(@Req() r: CoreRequest, @Body() b: any) { return this.admin.createCountry(r.principal!.id, b); }
  @Patch('countries/:iso') @RequirePermission('tenants:manage') editCountry(@Req() r: CoreRequest, @Param('iso') i: string, @Body() b: any) { return this.admin.updateCountry(r.principal!.id, i, b); }
  @Delete('countries/:iso') @RequirePermission('tenants:manage') delCountry(@Req() r: CoreRequest, @Param('iso') i: string) { return this.admin.trashCountry(r.principal!.id, i); }

  @Post('countries/:iso/regions') @RequirePermission('tenants:manage') addRegion(@Req() r: CoreRequest, @Param('iso') i: string, @Body() b: any) { return this.admin.createRegion(r.principal!.id, i, b); }
  @Patch('countries/:iso/regions/:id') @RequirePermission('tenants:manage') editRegion(@Req() r: CoreRequest, @Param('iso') i: string, @Param('id') id: string, @Body() b: any) { return this.admin.updateRegion(r.principal!.id, i, rid(id), b); }
  @Delete('countries/:iso/regions/:id') @RequirePermission('tenants:manage') delRegion(@Req() r: CoreRequest, @Param('iso') i: string, @Param('id') id: string) { return this.admin.trashRegion(r.principal!.id, i, rid(id)); }

  @Post('countries/:iso/cities') @RequirePermission('tenants:manage') addCity(@Req() r: CoreRequest, @Param('iso') i: string, @Body() b: any) { return this.admin.createCity(r.principal!.id, i, b); }
  @Delete('countries/:iso/cities') @RequirePermission('tenants:manage')
  delCity(@Req() r: CoreRequest, @Param('iso') i: string, @Query('region_id') rg: string, @Query('name') name: string) { return this.admin.trashCity(r.principal!.id, i, { region_id: rg, name }); }
}
