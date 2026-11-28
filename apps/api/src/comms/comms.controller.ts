import { BadRequestException, Body, Controller, Get, Param, Post, Put, Req, StreamableFile } from '@nestjs/common';
import { CommsService } from './comms.service';
import { NotificationService } from './notification.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (req: CoreRequest) => {
  if (!req.tenantSlug || !req.principal) throw new BadRequestException('tenant required');
  return { slug: req.tenantSlug, p: req.principal };
};
const file = (d: { data: Buffer; contentType: string; filename: string }) =>
  new StreamableFile(d.data, { type: d.contentType, disposition: `attachment; filename="${encodeURIComponent(d.filename)}"` });

@Controller()
export class CommsController {
  constructor(private readonly svc: CommsService, private readonly notif: NotificationService) {}

  @Post('directory') @RequirePermission('directory:manage') upsertDir(@Req() r: CoreRequest, @Body() b: any) { return this.svc.upsertDirectory(need(r).slug, b); }
  @Get('directory') listDir(@Req() r: CoreRequest) { const { slug, p } = need(r); this.svc.authorize(p, slug, 'news:read'); return this.svc.listDirectory(slug); }

  @Post('threads') createThread(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createThread(slug, p, b); }
  @Get('threads') threads(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.listThreads(slug, p); }
  @Get('threads/:id') thread(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.getThread(slug, p, id); }
  @Post('threads/:id/messages') post(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.postMessage(slug, p, id, b); }
  @Get('attachments/:id') async attachment(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return file(await this.svc.attachment(slug, p, id)); }

  @Post('news') @RequirePermission('news:write') publish(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.publishNews(slug, p, b); }
  @Get('news') @RequirePermission('news:read') news(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.listNews(slug, p); }
  @Post('newsletter/send') @RequirePermission('news:write') newsletter(@Req() r: CoreRequest) { return this.svc.sendNewsletter(need(r).slug); }
  @Post('surveys') @RequirePermission('news:write') survey(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createSurvey(slug, p, b); }
  @Get('surveys') @RequirePermission('news:read') surveys(@Req() r: CoreRequest) { return this.svc.listSurveys(need(r).slug); }
  @Post('surveys/:id/vote') @RequirePermission('news:read') vote(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.vote(slug, p, id, b); }
  @Get('surveys/:id/results') @RequirePermission('news:read') results(@Req() r: CoreRequest, @Param('id') id: string) { return this.svc.surveyResults(need(r).slug, id); }
  @Post('events') @RequirePermission('news:write') event(@Req() r: CoreRequest, @Body() b: any) { return this.svc.createEvent(need(r).slug, b); }
  @Get('events') @RequirePermission('news:read') events(@Req() r: CoreRequest) { return this.svc.listEvents(need(r).slug); }

  @Get('notifications') notifications(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.listNotifications(slug, p); }
  @Post('notifications/read-all') readAll(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.markAllRead(slug, p); }
  @Post('notifications/:id/read') read(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.markRead(slug, p, id); }
  @Get('me/notification-preferences') prefs(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.notif.getPrefs(slug, p.id); }
  @Put('me/notification-preferences') setPrefs(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.notif.setPrefs(slug, p.id, b); }
  @Post('devices') device(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.registerDevice(slug, p, b); }
  @Get('push-outbox') outbox(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.pushOutbox(slug, p); }
  @Post('notifications/send') @RequirePermission('notify:send') send(@Req() r: CoreRequest, @Body() b: any) { return this.svc.sendTest(need(r).slug, b.user_ids, b.text); }

  @Post('locker') @RequirePermission('locker:write') upload(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.lockerUpload(slug, p, b); }
  @Get('students/:id/locker') lockerList(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.lockerList(slug, p, id); }
  @Get('locker/:id/download') async download(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return file(await this.svc.lockerDownload(slug, p, id)); }
  @Post('locker/purge') @RequirePermission('locker:write') purge(@Req() r: CoreRequest) { return this.svc.lockerPurge(need(r).slug); }
}
