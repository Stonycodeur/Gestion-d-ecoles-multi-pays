import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { SchoolConfigService } from './school-config.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (req: CoreRequest) => {
  if (!req.tenantSlug || !req.principal) throw new BadRequestException('tenant required');
  return { slug: req.tenantSlug, p: req.principal };
};

@Controller()
export class SchoolConfigController {
  constructor(private readonly svc: SchoolConfigService) {}

  /** Country reference data of the school (currency, locale, payment providers, legal framework, education system, calendars). */
  @Get('settings/country') @RequirePermission('schedule:read')
  country(@Req() r: CoreRequest) { return this.svc.country(need(r).slug); }

  /** Active scale, scales allowed by the country, school overrides and colour bands: clients always show the active scale. */
  @Get('settings/grading') @RequirePermission('schedule:read')
  grading(@Req() r: CoreRequest) { return this.svc.grading(need(r).slug); }

  @Put('settings/grading') @RequirePermission('grading:configure')
  setGrading(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.setGrading(slug, p.id, b); }

  @Post('staff/contracts') @RequirePermission('contracts:write')
  createContract(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createContract(slug, p.id, b); }
  @Get('staff/contracts') @RequirePermission('staff:read')
  contracts(@Req() r: CoreRequest, @Query('teacher_id') t?: string) { return this.svc.listContracts(need(r).slug, t); }
  @Get('staff/workload') @RequirePermission('staff:read')
  workload(@Req() r: CoreRequest) { return this.svc.workload(need(r).slug); }

  @Post('substitutions') @RequirePermission('schedule:write')
  substitute(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.substitute(slug, p.id, b); }
  @Get('substitutions') @RequirePermission('schedule:read')
  substitutions(@Req() r: CoreRequest, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.listSubstitutions(need(r).slug, from, to); }
  @Delete('substitutions/:id') @RequirePermission('schedule:write')
  remove(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.removeSubstitution(slug, p.id, id); }
}
