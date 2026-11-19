import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DEFAULT_BADGES, DEFAULT_LEVELS, DEFAULT_XP_RULES, GAME_TYPES_BY_LEVEL, can, challengeProgress, checkTiming, evaluateBadges, leaderboard, levelFor, presentQuestions,
  scoreExam, teamPoints, xpFor, type ExamMode, type Principal, type Question, type XpRules } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, num, optStr, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { OaaService } from '../oaa/oaa.service';

export const GAME_MODULE = 'module-gamification';
const MODES: ExamMode[] = ['qcm', 'escape_game', 'team_quiz', 'boss'];
const kindOf = (mode: ExamMode, hasSubject: boolean) =>
  mode === 'qcm' ? (hasSubject ? 'quiz' : 'game') : mode === 'escape_game' ? 'game' : mode === 'team_quiz' ? 'group_challenge' : 'boss';   // table 8.4

@Injectable()
export class GamificationService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly oaa: OaaService) {}

  private tx<T>(slug: string, fn: (q: Q, t: { id: string; slug: string; country: string; schoolType: string }) => Promise<T>): Promise<T> {
    return this.db.run(slug, fn).catch((e) => mapDbError(e));
  }
  authorize(p: Principal, slug: string, perm: string, r: Record<string, unknown> = {}) {
    const d = can(p, perm, { tenantId: slug, ...r });
    if (!d.allowed) throw new ForbiddenException(d.reason);
  }
  requireEnabled(slug: string) {
    if (!this.modules.registry.isEnabled(slug, GAME_MODULE)) throw new ForbiddenException('Gamification module is not enabled for this school');
  }
  private rules(slug: string): XpRules { return { ...DEFAULT_XP_RULES, ...((this.modules.registry.config(slug, GAME_MODULE).xp_rules as Partial<XpRules>) ?? {}) }; }
  private async studentOf(slug: string, id: string) {
    const st = await this.tx(slug, async (q) => (await q('SELECT id, class_id, first_name, last_name FROM students WHERE id = $1', [uuid(id, 'student_id')]))[0]);
    if (!st) throw new NotFoundException('student not found');
    return st as { id: string; class_id: string | null; first_name: string; last_name: string };
  }

  // ---- XP, badges, challenges ---------------------------------------------------------------------------------------
  /** Idempotent: the same (student, source, ref) never gives XP twice. Returns the XP actually granted. */
  private async grantXp(q: Q, studentId: string, source: string, xp: number, ref: string): Promise<number> {
    if (xp <= 0) return 0;
    const r = await q('INSERT INTO xp_events(student_id, source, xp, ref) VALUES ($1,$2,$3,$4) ON CONFLICT (student_id, source, ref) DO NOTHING RETURNING xp', [studentId, source, xp, ref]);
    return r.length ? Number(r[0].xp) : 0;
  }
  private async stats(q: Q, studentId: string) {
    const xp = Number((await q('SELECT COALESCE(SUM(xp),0)::int AS t FROM xp_events WHERE student_id = $1', [studentId]))[0].t);
    const qa = (await q(`SELECT COUNT(*)::int AS n, COALESCE(AVG(a.score100),0)::float AS avg, COUNT(*) FILTER (WHERE a.score100 = 100)::int AS perfect,
        COUNT(*) FILTER (WHERE z.mode = 'boss' AND a.score100 >= 60)::int AS bosses
      FROM quiz_attempts a JOIN quizzes z ON z.id = a.quiz_id WHERE a.student_id = $1 AND a.score100 IS NOT NULL`, [studentId]))[0];
    const last = (await q(`SELECT GREATEST(COALESCE((SELECT MAX(on_date) FROM absences WHERE student_id = $1 AND kind = 'absence' AND status IN ('unjustified','rejected')), 'epoch'::date),
        (SELECT created_at::date FROM students WHERE id = $1)) AS d`, [studentId]))[0].d as string;
    const streak = Math.max(0, Math.floor((Date.now() - new Date(last).getTime()) / 86400000));
    return { totalXp: xp, quizCount: qa.n as number, quizAvg: qa.avg as number, perfectQuizzes: qa.perfect as number, bossesDefeated: qa.bosses as number, attendanceStreakDays: streak };
  }
  private async awardBadges(q: Q, studentId: string) {
    const earned = (await q('SELECT badge_code FROM student_badges WHERE student_id = $1', [studentId])).map((r: any) => r.badge_code as string);
    const fresh = evaluateBadges(await this.stats(q, studentId), earned);
    for (const b of fresh) await q('INSERT INTO student_badges(student_id, badge_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [studentId, b.code]);
    return fresh;
  }
  private async metricTotal(q: Q, studentIds: string[], metric: string, from: string, to: string): Promise<number> {
    const w = [studentIds, from, to];
    if (metric === 'xp') return Number((await q("SELECT COALESCE(SUM(xp),0)::int AS t FROM xp_events WHERE student_id = ANY($1::uuid[]) AND created_at::date BETWEEN $2 AND $3", w))[0].t);
    if (metric === 'homework') return Number((await q("SELECT COUNT(*)::int AS t FROM xp_events WHERE student_id = ANY($1::uuid[]) AND source = 'homework' AND created_at::date BETWEEN $2 AND $3", w))[0].t);
    return Number((await q('SELECT COUNT(*)::int AS t FROM quiz_attempts WHERE student_id = ANY($1::uuid[]) AND score100 IS NOT NULL AND submitted_at::date BETWEEN $2 AND $3', w))[0].t);
  }
  /** Individual challenges complete per student, group challenges complete for every member of a team that reaches the target together. */
  private async progressChallenges(q: Q, studentId: string, rules: XpRules) {
    const done: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const c of await q('SELECT * FROM challenges WHERE starts_on <= $1 AND ends_on >= $1', [today])) {
      const target = { code: c.code, kind: c.kind, metric: c.metric, target: Number(c.target) };
      let group: string[] = [studentId];
      if (c.kind === 'group') {
        const t = (await q('SELECT team_id FROM team_members WHERE student_id = $1', [studentId]))[0];
        if (!t) continue;
        group = (await q('SELECT student_id FROM team_members WHERE team_id = $1', [t.team_id])).map((r: any) => r.student_id as string);
      }
      const total = await this.metricTotal(q, group, c.metric, c.starts_on, c.ends_on);
      if (!challengeProgress(target, total).done) continue;
      for (const sid of group) {
        const ins = await q('INSERT INTO challenge_completions(challenge_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id', [c.id, sid]);
        if (!ins.length) continue;
        await this.grantXp(q, sid, 'challenge', xpFor('challenge', null, rules), c.id);
        await q('INSERT INTO game_results(student_id, kind, score100, ref) VALUES ($1,$2,100,$3)', [sid, c.kind === 'group' ? 'group_challenge' : 'individual_challenge', `challenge:${c.id}`]);
        if (sid === studentId) done.push(c.code);
      }
    }
    return done;
  }
  /** Common path after any activity: challenges, badges, then the OAA is fed (table 8.4). */
  private async afterActivity(slug: string, studentId: string) {
    const rules = this.rules(slug);
    const out = await this.tx(slug, async (q) => { const ch = await this.progressChallenges(q, studentId, rules); const badges = await this.awardBadges(q, studentId); return { ch, badges }; });
    await this.oaa.recompute(slug, studentId, 'onExamCompleted', 'gamification');
    return { challenges: out.ch, badges: out.badges.map((b) => b.code) };
  }

  /** Teacher awards XP for homework / participation / a game result. */
  async award(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug);
    const st = await this.studentOf(slug, b.student_id);
    this.authorize(p, slug, 'games:create', { classId: st.class_id ?? undefined });
    const source = str(b.source, 'source', 20);
    if (!['homework', 'participation', 'game'].includes(source)) throw new BadRequestException('source must be homework|participation|game');
    const score = source === 'game' ? num(b.score100, 'score100', 0, 100) : null;
    const ref = str(b.ref, 'ref', 80);
    const rules = this.rules(slug);
    const granted = await this.tx(slug, async (q) => {
      const xp = await this.grantXp(q, st.id, source, xpFor(source as 'homework', score, rules), ref);
      if (xp > 0 && source === 'game') await q('INSERT INTO game_results(student_id, kind, score100, ref) VALUES ($1,$2,$3,$4)', [st.id, 'game', score, ref]);
      return xp;
    });
    return { xp: granted, duplicate: granted === 0, ...(await this.afterActivity(slug, st.id)) };
  }

  // ---- quizzes and gamified exams (QCM, escape game, team quiz, boss) ---------------------------------------------
  async createQuiz(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug);
    const classId = uuid(b.class_id, 'class_id');
    this.authorize(p, slug, 'games:create', { classId });
    const mode = (b.mode ?? 'qcm') as ExamMode;
    if (!MODES.includes(mode)) throw new BadRequestException(`mode must be one of ${MODES.join('|')}`);
    if (!Array.isArray(b.questions) || !b.questions.length || b.questions.length > 100) throw new BadRequestException('questions: 1..100 required');
    const questions = b.questions.map((x: any, i: number) => {
      if (!Array.isArray(x.choices) || x.choices.length < 2 || x.choices.length > 8) throw new BadRequestException(`question ${i + 1}: 2..8 choices`);
      const correct = num(x.correct, 'correct', 0, x.choices.length - 1);
      if (!Number.isInteger(correct)) throw new BadRequestException(`question ${i + 1}: correct must be an index`);
      return { prompt: str(x.prompt, 'prompt', 1000), choices: x.choices.map((c: unknown) => str(c, 'choice', 300)), correct, points: Math.round(num(x.points ?? 1, 'points', 1, 100)) };
    });
    return this.tx(slug, async (q) => {
      const quiz = (await q('INSERT INTO quizzes(title, subject_id, class_id, mode, time_limit_sec, max_attempts, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [str(b.title, 'title', 200), b.subject_id ? uuid(b.subject_id, 'subject_id') : null, classId, mode, b.time_limit_sec ? Math.round(num(b.time_limit_sec, 'time_limit_sec', 10, 7200)) : null, Math.round(num(b.max_attempts ?? 1, 'max_attempts', 1, 20)), p.id]))[0];
      let pos = 0;
      for (const x of questions) await q('INSERT INTO quiz_questions(quiz_id, position, prompt, choices, correct, points) VALUES ($1,$2,$3,$4,$5,$6)', [quiz.id, pos++, x.prompt, JSON.stringify(x.choices), x.correct, x.points]);
      return quiz;
    });
  }
  async publishQuiz(slug: string, p: Principal, id: string) {
    this.requireEnabled(slug);
    const z = await this.tx(slug, async (q) => (await q('SELECT class_id FROM quizzes WHERE id = $1', [uuid(id, 'id')]))[0]);
    if (!z) throw new NotFoundException('quiz not found');
    this.authorize(p, slug, 'games:create', { classId: z.class_id });
    return this.tx(slug, async (q) => (await q('UPDATE quizzes SET published = TRUE WHERE id = $1 RETURNING id, title, published', [id]))[0]);
  }
  async listQuizzes(slug: string, p: Principal, classId?: string) {
    this.requireEnabled(slug);
    const isStudent = p.roles.includes('student') && !p.roles.some((r) => ['teacher', 'head', 'admin', 'tenant_super_admin'].includes(r));
    let cls = classId;
    if (isStudent) cls = (await this.studentOf(slug, p.studentId ?? '')).class_id ?? undefined;
    else if (cls) this.authorize(p, slug, 'games:create', { classId: cls });
    return this.tx(slug, (q) => q(`SELECT id, title, class_id, subject_id, mode, time_limit_sec, max_attempts, published FROM quizzes WHERE ($1::uuid IS NULL OR class_id = $1) ${isStudent ? 'AND published' : ''} ORDER BY created_at DESC`, [cls ?? null]));
  }
  /** Starts an attempt: questions come back shuffled per attempt, WITHOUT the correct answers. */
  async start(slug: string, p: Principal, quizId: string) {
    this.requireEnabled(slug);
    const st = await this.studentOf(slug, p.studentId ?? '');
    this.authorize(p, slug, 'games:play', { studentId: st.id });
    return this.tx(slug, async (q) => {
      const z = (await q('SELECT * FROM quizzes WHERE id = $1 AND published', [uuid(quizId, 'id')]))[0];
      if (!z || z.class_id !== st.class_id) throw new NotFoundException('quiz not found');
      const used = Number((await q('SELECT COUNT(*)::int AS n FROM quiz_attempts WHERE quiz_id = $1 AND student_id = $2', [quizId, st.id]))[0].n);
      if (used >= z.max_attempts) throw new ConflictException('no attempts left');
      const a = (await q('INSERT INTO quiz_attempts(quiz_id, student_id) VALUES ($1,$2) RETURNING id, started_at', [quizId, st.id]))[0];
      const qs = await this.questions(q, quizId);
      return { attempt_id: a.id, mode: z.mode, time_limit_sec: z.time_limit_sec, started_at: a.started_at, questions: presentQuestions(qs, a.id) };
    });
  }
  private async questions(q: Q, quizId: string): Promise<Question[]> {
    return (await q('SELECT id, prompt, choices, correct, points FROM quiz_questions WHERE quiz_id = $1 ORDER BY position', [quizId])).map((r: any) => ({ id: r.id, prompt: r.prompt, choices: r.choices, correct: r.correct, points: r.points }));
  }
  /** answers: { questionId: originalChoiceIndex } (escape game: an array of attempts). */
  async submit(slug: string, p: Principal, attemptId: string, b: any) {
    this.requireEnabled(slug);
    const st = await this.studentOf(slug, p.studentId ?? '');
    this.authorize(p, slug, 'games:play', { studentId: st.id });
    const rules = this.rules(slug);
    const r = await this.tx(slug, async (q) => {
      const a = (await q('SELECT a.*, z.mode, z.time_limit_sec, z.subject_id FROM quiz_attempts a JOIN quizzes z ON z.id = a.quiz_id WHERE a.id = $1 AND a.student_id = $2 FOR UPDATE OF a', [uuid(attemptId, 'id'), st.id]))[0];
      if (!a) throw new NotFoundException('attempt not found');
      if (a.submitted_at) throw new ConflictException('attempt already submitted');
      const qs = await this.questions(q, a.quiz_id);
      const timing = checkTiming(new Date(a.started_at).getTime(), Date.now(), a.time_limit_sec, qs.length);
      if (!timing.ok) {
        await q('UPDATE quiz_attempts SET submitted_at = NOW(), flags = $2 WHERE id = $1', [attemptId, JSON.stringify(timing.flags)]);
        return { rejected: timing.flags };
      }
      if (typeof b.answers !== 'object' || b.answers === null) throw new BadRequestException('answers required');
      const result = scoreExam(a.mode as ExamMode, qs, b.answers);
      await q('UPDATE quiz_attempts SET submitted_at = NOW(), score100 = $2, flags = $3, result = $4 WHERE id = $1', [attemptId, result.score100, JSON.stringify(timing.flags), JSON.stringify(result)]);
      const kind = kindOf(a.mode, !!a.subject_id);
      await q('INSERT INTO game_results(student_id, kind, score100, ref) VALUES ($1,$2,$3,$4)', [st.id, kind, result.score100, `attempt:${attemptId}`]);
      const src = a.mode === 'boss' ? 'boss' : a.mode === 'qcm' && a.subject_id ? 'quiz' : a.mode === 'qcm' ? 'game' : 'exam';
      return { result, flags: timing.flags, kind, source: src, quizId: a.quiz_id };
    });
    if ('rejected' in r) throw new BadRequestException(`submission refused: ${r.rejected.join(',')}`);
    // exam-type results: XP is computed by module-gamification (hook onExamCompleted); other sources use the XP rules directly
    let xp = xpFor(r.source as 'quiz', r.result.score100, rules);
    if (r.source === 'exam') {
      const h = await this.modules.registry.emitTo(slug, 'onExamCompleted', GAME_MODULE, { studentId: st.id, examId: attemptId, score100: r.result.score100 });
      if (h?.ok) xp = (h.value as { xp: number }).xp;
    }
    const granted = await this.tx(slug, (q) => this.grantXp(q, st.id, r.source, xp, attemptId));
    return { score100: r.result.score100, correct: r.result.correctCount, total_questions: undefined, escaped: r.result.escaped, boss_defeated: r.result.bossDefeated, flags: r.flags, xp: granted, ...(await this.afterActivity(slug, st.id)) };
  }
  /** Teacher view of the attempts of a quiz, including anti-cheat flags (review by a human). */
  async attempts(slug: string, p: Principal, quizId: string) {
    this.requireEnabled(slug);
    const z = await this.tx(slug, async (q) => (await q('SELECT class_id FROM quizzes WHERE id = $1', [uuid(quizId, 'id')]))[0]);
    if (!z) throw new NotFoundException('quiz not found');
    this.authorize(p, slug, 'games:create', { classId: z.class_id });
    return this.tx(slug, (q) => q(`SELECT a.id, a.student_id, s.first_name, s.last_name, a.started_at, a.submitted_at, a.score100, a.flags FROM quiz_attempts a JOIN students s ON s.id = a.student_id WHERE a.quiz_id = $1 ORDER BY a.started_at`, [quizId]));
  }

  // ---- dashboards, leaderboards, challenges, teams ------------------------------------------------------------------
  async studentProfile(slug: string, p: Principal, studentId: string, lang = 'fr') {
    this.requireEnabled(slug);
    const st = await this.studentOf(slug, studentId);
    this.authorize(p, slug, 'games:read', { studentId: st.id, classId: st.class_id ?? undefined });
    return this.tx(slug, async (q) => {
      const s = await this.stats(q, st.id);
      const lv = levelFor(s.totalXp, DEFAULT_LEVELS);
      const badges = (await q('SELECT badge_code, earned_at FROM student_badges WHERE student_id = $1 ORDER BY earned_at', [st.id])).map((b: any) => {
        const d = DEFAULT_BADGES.find((x) => x.code === b.badge_code);
        return { code: b.badge_code, name: d ? (lang === 'en' ? d.name_en : d.name_fr) : b.badge_code, earned_at: b.earned_at };
      });
      const recent = await q('SELECT source, xp, created_at FROM xp_events WHERE student_id = $1 ORDER BY created_at DESC LIMIT 20', [st.id]);
      const challenges = (await q('SELECT c.code, c.title, cc.completed_at FROM challenge_completions cc JOIN challenges c ON c.id = cc.challenge_id WHERE cc.student_id = $1', [st.id]));
      return { total_xp: s.totalXp, level: { code: lv.level.code, label: lang === 'en' ? lv.level.label_en : lv.level.label_fr, progress_pct: lv.progressPct, xp_to_next: lv.xpToNext, next: lv.next ? (lang === 'en' ? lv.next.label_en : lv.next.label_fr) : null },
        badges, recent_xp: recent, completed_challenges: challenges };
    });
  }
  /** scope: class | school | subject. Names are shortened ("Ada O.") for privacy. */
  async leaderboard(slug: string, p: Principal, scope: string, opts: { classId?: string; subjectId?: string }) {
    this.requireEnabled(slug);
    if (this.modules.registry.config(slug, GAME_MODULE).leaderboard_enabled === false) throw new ForbiddenException('leaderboards are disabled for this school');
    const staff = p.roles.some((r) => ['teacher', 'head', 'admin', 'tenant_super_admin'].includes(r));
    let classId = opts.classId;
    if (!staff) {                                            // students and parents only see their own class (or the school scope)
      const sid = p.studentId ?? p.childIds?.[0];
      if (!sid) throw new ForbiddenException('no student linked');
      if (scope === 'class') classId = (await this.studentOf(slug, sid)).class_id ?? undefined;
    } else if (scope === 'class') this.authorize(p, slug, 'games:read', { classId: uuid(classId, 'class_id') });
    return this.tx(slug, async (q) => {
      let rows: any[];
      if (scope === 'subject') rows = await q(`SELECT s.id, s.first_name, s.last_name, COALESCE(SUM(best.m),0)::int AS points FROM students s LEFT JOIN
          (SELECT a.student_id, MAX(a.score100) AS m FROM quiz_attempts a JOIN quizzes z ON z.id = a.quiz_id WHERE z.subject_id = $1 AND a.score100 IS NOT NULL GROUP BY a.student_id, a.quiz_id) best ON best.student_id = s.id
          WHERE ($2::uuid IS NULL OR s.class_id = $2) GROUP BY s.id`, [uuid(opts.subjectId, 'subject_id'), classId ?? null]);
      else rows = await q(`SELECT s.id, s.first_name, s.last_name, COALESCE(SUM(x.xp),0)::int AS points FROM students s LEFT JOIN xp_events x ON x.student_id = s.id
          WHERE ($1::uuid IS NULL OR s.class_id = $1) GROUP BY s.id`, [scope === 'class' ? classId ?? null : null]);
      const names = new Map(rows.map((r) => [r.id as string, `${r.first_name} ${String(r.last_name).charAt(0)}.`]));
      return leaderboard(rows.map((r) => ({ id: r.id as string, points: r.points as number })), 50).map((r) => ({ rank: r.rank, student_id: staff ? r.id : undefined, name: names.get(r.id), points: r.points }));
    });
  }
  createChallenge(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug);
    return this.tx(slug, async (q) => (await q('INSERT INTO challenges(code, title, kind, metric, target, starts_on, ends_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [str(b.code, 'code', 40), str(b.title, 'title', 200), str(b.kind, 'kind', 12), str(b.metric, 'metric', 12), Math.round(num(b.target, 'target', 1, 100000)), str(b.starts_on, 'starts_on', 10), str(b.ends_on, 'ends_on', 10), p.id]))[0]);
  }
  listChallenges(slug: string) { this.requireEnabled(slug); return this.tx(slug, (q) => q('SELECT * FROM challenges ORDER BY ends_on DESC')); }
  async createTeam(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug);
    const classId = b.class_id ? uuid(b.class_id, 'class_id') : undefined;
    this.authorize(p, slug, 'games:create', { classId });
    const members: string[] = Array.isArray(b.member_ids) ? b.member_ids.map((x: unknown) => uuid(x, 'member_ids')) : [];
    return this.tx(slug, async (q) => {
      const t = (await q('INSERT INTO teams(name, class_id) VALUES ($1,$2) RETURNING *', [str(b.name, 'name', 80), classId ?? null]))[0];
      for (const m of members) await q('INSERT INTO team_members(team_id, student_id) VALUES ($1,$2)', [t.id, m]);
      return { ...t, members: members.length };
    });
  }
  /** Team ranking: average XP of members (spec 8.1: competition between classes or groups). */
  async teams(slug: string) {
    this.requireEnabled(slug);
    return this.tx(slug, async (q) => {
      const rows = await q(`SELECT t.id, t.name, COALESCE(array_agg(x.total) FILTER (WHERE x.total IS NOT NULL), '{}') AS totals, COUNT(tm.student_id)::int AS members
        FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
        LEFT JOIN (SELECT student_id, SUM(xp)::int AS total FROM xp_events GROUP BY student_id) x ON x.student_id = tm.student_id GROUP BY t.id`);
      return leaderboard(rows.map((r: any) => ({ id: r.id as string, points: teamPoints((r.totals as number[]).map(Number)), name: r.name as string, members: r.members as number })));
    });
  }
  catalog() { return { game_types: GAME_TYPES_BY_LEVEL, exam_modes: MODES, levels: DEFAULT_LEVELS, badges: DEFAULT_BADGES }; }
  static optStr = optStr;
}
