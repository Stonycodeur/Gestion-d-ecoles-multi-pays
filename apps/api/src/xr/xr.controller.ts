import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { XrService } from './xr.service';
import { Public } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller('xr')
export class XrController {
  constructor(private readonly svc: XrService) {}
  @Post('assets') create(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.create(slug, p, b); }
  @Get('assets') list(@Req() r: CoreRequest, @Query('lesson_id') l?: string, @Query('resource_id') rs?: string, @Query('kind') k?: string) { const { slug, p } = need(r); return this.svc.list(slug, p, { lesson_id: l, resource_id: rs, kind: k }); }
  @Delete('assets/:id') remove(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.remove(slug, p, id); }
}

@Controller('public/:school')
export class XrPublicController {
  constructor(private readonly svc: XrService) {}
  @Public() @Get('tour') tour(@Param('school') s: string) { return this.svc.tour(s); }
}
