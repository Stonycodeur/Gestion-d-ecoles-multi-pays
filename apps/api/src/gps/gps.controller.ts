import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { GpsService } from './gps.service';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller('gps')
export class GpsController {
  constructor(private readonly svc: GpsService) {}
  @Post('students/:id/consent') consent(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.setConsent(slug, p, id, b); }
  @Get('students/:id/consent') myConsent(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.myConsent(slug, p, id); }
  @Get('students/:id/policy') policy(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.policy(slug, p, id); }
  @Post('students/:id/positions') report(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.report(slug, p, id, b); }
  @Get('students/:id/live') live(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.live(slug, p, id); }
  @Get('students/:id/history') history(@Req() r: CoreRequest, @Param('id') id: string, @Query('from') f?: string, @Query('to') t?: string) { const { slug, p } = need(r); return this.svc.history(slug, p, id, f, t); }
  @Get('students/:id/events') events(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.events(slug, p, id); }
  @Get('students/:id/access-log') accessLog(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.accessLog(slug, p, id); }
  @Get('students/:id/geofences') geofences(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.listGeofences(slug, p, id); }
  @Post('geofences') createFence(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createGeofence(slug, p, b); }
  @Post('purge') purge(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.purge(slug, p); }
}
