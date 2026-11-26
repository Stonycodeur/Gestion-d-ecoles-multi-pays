import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { GeoService } from './geo.service';
import { TenantsService } from '../school/tenants.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

/** World geography for signed-in users (reference data, no personal data); activating a country is reserved to the root super-admin. */
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService, private readonly tenants: TenantsService) {}

  @Get('continents') continents() { return this.geo.continents(); }

  /** Countries of a continent (or all), flagged `activated` when schools can already be created there. */
  @Get('countries') @RequirePermission('tenants:manage')
  async countries(@Query('continent') continent?: string, @Query('q') q?: string) {
    const on = new Map((await this.tenants.activated()).map((c) => [c.code as string, c.schools as number]));
    return this.geo.countries(continent || undefined, q).map((c) => ({ ...c, activated: on.has(c.c), schools: on.get(c.c) ?? 0 }));
  }
  @Get('countries/:iso') @RequirePermission('tenants:manage')
  async country(@Param('iso') iso: string) {
    const c = this.geo.country(iso);
    const on = (await this.tenants.activated()).find((x) => x.code === c.c);
    return { ...c, activated: !!on, schools: on?.schools ?? 0 };
  }
  @Get('countries/:iso/regions') regions(@Param('iso') iso: string) { return this.geo.regions(iso); }
  @Get('countries/:iso/cities')
  cities(@Param('iso') iso: string, @Query('region') region?: string, @Query('q') q?: string, @Query('limit') limit?: string) {
    const rid = region === undefined || region === '' ? undefined : Number(region);
    if (rid !== undefined && !Number.isInteger(rid)) throw new BadRequestException('region must be a region id');
    return this.geo.cities(iso, rid, q, Math.min(Math.max(Number(limit) || 50, 1), 200));
  }
  @Post('countries/:iso/activate') @RequirePermission('tenants:manage')
  activate(@Req() r: CoreRequest, @Param('iso') iso: string, @Body() b: any) { return this.tenants.activateCountry(r.principal!.id, iso, b); }
}
