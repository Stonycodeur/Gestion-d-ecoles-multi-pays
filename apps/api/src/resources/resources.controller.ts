import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ResourcesService } from './resources.service';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller()
export class ResourcesController {
  constructor(private readonly svc: ResourcesService) {}
  @Get('resources') list(@Req() r: CoreRequest, @Query('q') q?: string, @Query('subject') subject?: string, @Query('level') level?: string, @Query('tag') tag?: string) { const { slug, p } = need(r); return this.svc.list(slug, p, { q, subject, level, tag }); }
  @Post('resources') create(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.create(slug, p, b); }
  @Post('resources/reindex') reindex(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.reindex(slug, p); }
  @Post('resources/:id/carry-over') carry(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.carryOver(slug, p, id, b?.school_year); }
  @Get('forums') forums(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.forums(slug, p); }
  @Post('forums') createForum(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createForum(slug, p, b); }
  @Get('forums/:id/posts') posts(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.posts(slug, p, id); }
  @Post('forums/:id/posts') post(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.post(slug, p, id, b); }
}
