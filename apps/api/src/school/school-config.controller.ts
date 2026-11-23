import { BadRequestException, ForbiddenException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { SchoolConfigService } from './school-config.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (req: CoreRequest) => {
  if (!req.tenantSlug || !req.principal) throw new BadRequestException('tenant required');
  return { slug: req.tenantSlug, p: req.principal };
};

/** School members (any role but visitor/inspector) read configuration and see replacements: ABAC own-child rules do not apply to school-wide data. */
const member = (req: CoreRequest) => {
  const x = need(req);
  if (x.p.roles.some((r) => r === 'visitor' || r === 'inspector') && !x.p.roles.some((r) => !['visitor', 'inspector'].includes(r))) throw new ForbiddenException('school members only');
  return x;
};

@Controller()
export class SchoolConfigController {
  constructor(private readonly svc: SchoolConfigService) {}

  /** Country reference data of the school (currency, locale, payment providers, legal framework, education system, calendars). */
  @Get('settings/country')
  country(@Req() r: CoreRequest) { return this.svc.country(member(r).slug); }

  /** Active scale, scales allowed by the country, school overrides and colour bands: clients always show the active scale. */
  @Get('settings/grading')
  grading(@Req() r: CoreRequest) { return this.svc.grading(member(r).slug); }

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
  @Get('substitutions')
  substitutions(@Req() r: CoreRequest, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.listSubstitutions(member(r).slug, from, to); }
  @Delete('substitutions/:id') @RequirePermission('schedule:write')
  remove(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.removeSubstitution(slug, p.id, id); }
}
