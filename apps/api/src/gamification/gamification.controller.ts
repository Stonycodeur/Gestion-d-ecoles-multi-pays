import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller()
export class GamificationController {
  constructor(private readonly svc: GamificationService) {}
  @Get('games/catalog') @RequirePermission('games:read') catalog(@Req() r: CoreRequest) { need(r); return this.svc.catalog(); }
  @Post('games/award') award(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.award(slug, p, b); }
  @Post('quizzes') create(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createQuiz(slug, p, b); }
  @Get('quizzes') list(@Req() r: CoreRequest, @Query('class_id') c?: string) { const { slug, p } = need(r); return this.svc.listQuizzes(slug, p, c); }
  @Post('quizzes/:id/publish') publish(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.publishQuiz(slug, p, id); }
  @Post('quizzes/:id/start') start(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.start(slug, p, id); }
  @Get('quizzes/:id/attempts') attempts(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.attempts(slug, p, id); }
  @Post('quiz-attempts/:id/submit') submit(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.submit(slug, p, id, b); }
  @Get('students/:id/gamification') profile(@Req() r: CoreRequest, @Param('id') id: string, @Query('lang') l?: string) { const { slug, p } = need(r); return this.svc.studentProfile(slug, p, id, l); }
  @Get('leaderboards') board(@Req() r: CoreRequest, @Query('scope') scope = 'class', @Query('class_id') c?: string, @Query('subject_id') s?: string) { const { slug, p } = need(r); return this.svc.leaderboard(slug, p, scope, { classId: c, subjectId: s }); }
  @Post('challenges') @RequirePermission('games:create') challenge(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createChallenge(slug, p, b); }
  @Get('challenges') @RequirePermission('games:read') challenges(@Req() r: CoreRequest) { return this.svc.listChallenges(need(r).slug); }
  @Post('teams') createTeam(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createTeam(slug, p, b); }
  @Get('teams') @RequirePermission('games:read') teams(@Req() r: CoreRequest) { return this.svc.teams(need(r).slug); }
}
