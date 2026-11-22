import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { AI_KINDS, MAX_INPUT_CHARS, STAFF_KINDS, ageBand, ageYears, can, containsBlocked, filterTutorOutput, pseudonymize, restore, tutorPolicy, validateQcm, SAFE_REDIRECT, type AiKind, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, str, uuid } from '../pedagogy/validate';
import { AuditService } from '../core/audit.service';
import { ModulesService } from '../modules/modules.service';
import { GamificationService } from '../gamification/gamification.service';
import { createLlm, type LlmAdapter } from './llm.adapter';

export const AI_MODULE = 'module-ai-assistant';

/** Generative assistant (spec 6.20). Guarantees: personal data is pseudonymised before any model call; usage is logged without content; model output is validated;
 *  proposals never become grades; the tutor is age-filtered; the whole module can be switched off per school. */
@Injectable()
export class GenAiService {
  private llm: LlmAdapter = createLlm();
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly audit: AuditService, private readonly games: GamificationService) {}
  setAdapter(a: LlmAdapter) { this.llm = a; }
  private tx<T>(slug: string, fn: (q: Q) => Promise<T>): Promise<T> { return this.db.run(slug, (q) => fn(q)).catch((e) => mapDbError(e)); }
  private requireEnabled(slug: string) { if (!this.modules.registry.isEnabled(slug, AI_MODULE)) throw new ForbiddenException('AI assistant is not enabled for this school'); }
  private authorize(p: Principal, slug: string, perm: string, r: Record<string, unknown> = {}) { const d = can(p, perm, { tenantId: slug, ...r }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  private cfg(slug: string) { return this.modules.registry.config(slug, AI_MODULE) as { tutor_enabled?: boolean; hourly_limit?: number; extra_blocked_terms?: string[] }; }
  private role(p: Principal) { return p.roles[0] ?? 'unknown'; }

  status(slug: string) { const enabled = this.modules.registry.isEnabled(slug, AI_MODULE); return { enabled, adapter: this.llm.name, simulated: this.llm.name === 'sandbox', tutor_enabled: enabled && this.cfg(slug).tutor_enabled !== false }; }

  async assist(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug);
    const kind = b?.kind as AiKind; if (!AI_KINDS.includes(kind)) throw new BadRequestException(`kind must be one of ${AI_KINDS.join('|')}`);
    const lang: 'fr' | 'en' = b.lang === 'en' ? 'en' : 'fr';
    const isTutor = kind === 'tutor';
    this.authorize(p, slug, isTutor ? 'ai:tutor' : 'ai:use');
    if (!isTutor && !STAFF_KINDS.includes(kind)) throw new BadRequestException('unsupported kind');
    if (isTutor && this.cfg(slug).tutor_enabled === false) throw new ForbiddenException('the tutor is disabled for this school');
    const text = str(b.text, 'text', MAX_INPUT_CHARS);
    if (kind === 'correction_help') { str(b.reference, 'reference', MAX_INPUT_CHARS); str(b.answer, 'answer', MAX_INPUT_CHARS); }
    const count = Math.min(20, Math.max(1, Number.isInteger(b.count) ? b.count : 5));
    const limit = Number(this.cfg(slug).hourly_limit ?? 60);
    const used = await this.tx(slug, async (q) => Number((await q("SELECT COUNT(*)::int AS n FROM ai_usage_log WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'", [p.id]))[0].n));
    if (used >= limit) throw new HttpException('hourly AI limit reached', 429);

    // who is behind the request (names to redact, age band for the tutor)
    let names: string[] = Array.isArray(b.names) ? b.names.map(String).slice(0, 50) : []; let studentId: string | null = null; let band = ageBand(null); let level: string | undefined;
    const own = isTutor ? p.studentId : (b.student_id ? uuid(b.student_id, 'student_id') : undefined);
    if (isTutor && !own) throw new ForbiddenException('only student accounts can use the tutor');
    if (own) {
      const s = await this.tx(slug, async (q) => (await q('SELECT s.id, s.first_name, s.last_name, s.birth_date::text AS birth_date, c.level_code FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1', [own]))[0]);
      if (!s) throw new NotFoundException('student not found');
      studentId = s.id; names = [...names, s.first_name, s.last_name, `${s.first_name} ${s.last_name}`]; band = ageBand(ageYears(s.birth_date)); level = s.level_code ?? undefined;
    }
    const policy = tutorPolicy(band, this.cfg(slug).extra_blocked_terms ?? []);
    let blocked = false; let output: Record<string, any> = {}; let simulated = true; let redactions = 0; let charsOut = 0;
    if (isTutor && (containsBlocked(text, policy.blocked) || text.length > policy.maxChars * 2)) { blocked = true; output = { reply: SAFE_REDIRECT[lang], blocked: true }; }
    else {
      const pa = pseudonymize(text, names); const pr = b.reference ? pseudonymize(String(b.reference), names) : null; const pn = b.answer ? pseudonymize(String(b.answer), names) : null;
      redactions = pa.redactions + (pr?.redactions ?? 0) + (pn?.redactions ?? 0);
      const map = { ...pa.map, ...(pr?.map ?? {}), ...(pn?.map ?? {}) };
      const r = await this.llm.run({ kind, lang, text: pa.text, target: b.target === 'en' ? 'en' : b.target === 'fr' ? 'fr' : undefined, count, reference: pr?.text, answer: pn?.text,
        maxPoints: Number.isFinite(b.max_points) ? Math.min(1000, Math.max(1, Number(b.max_points))) : 20, level, maxChars: policy.maxChars });
      simulated = r.simulated;
      output = JSON.parse(restore(JSON.stringify(r.output), Object.fromEntries(Object.entries(map).map(([k, v]) => [k, JSON.stringify(v).slice(1, -1)]))));
      if (kind === 'qcm') { const v = validateQcm(output.questions); output = { questions: v.ok, rejected: v.rejected }; if (!v.ok.length) throw new HttpException('the model produced no valid question; try again', 422); }
      if (kind === 'exercises') output = { exercises: (Array.isArray(output.exercises) ? output.exercises : []).map(String).filter(Boolean).slice(0, 20) };
      if (kind === 'correction_help') {
        const max = Number(output.max_points ?? b.max_points ?? 20); const pts = Number(output.suggested_points);
        output = { suggested_points: Number.isFinite(pts) ? Math.min(max, Math.max(0, pts)) : null, max_points: max, feedback: String(output.feedback ?? ''), matched: output.matched ?? [], missing: output.missing ?? [] };
      }
      if (isTutor) { const f = filterTutorOutput(String(output.reply ?? ''), policy, lang); blocked = f.blocked; output = { reply: f.text, blocked: f.blocked }; }
    }
    charsOut = JSON.stringify(output).length;
    const proposal = await this.tx(slug, async (q) => {
      await q('INSERT INTO ai_usage_log(user_id, role, kind, adapter, chars_in, chars_out, redactions, blocked) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [p.id, this.role(p), kind, this.llm.name, text.length, charsOut, redactions, blocked]);
      if (kind !== 'correction_help') return null;
      return (await q('INSERT INTO ai_proposals(kind, requested_by, student_id, proposal) VALUES ($1,$2,$3,$4) RETURNING id', ['correction_help', p.id, studentId, JSON.stringify(output)]))[0].id as string;
    });
    return { kind, simulated, output, ...(proposal ? { proposal_id: proposal, note: 'proposition : aucune note n’est enregistrée ; l’enseignant décide' } : {}) };
  }

  /** Teacher decision on a correction proposal. Accepting records the decision only: grades are entered by the teacher through the grading screens. */
  async decide(slug: string, p: Principal, id: string, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'ai:use');
    if (typeof b?.accept !== 'boolean') throw new BadRequestException('accept (boolean) is required');
    const r = await this.tx(slug, async (q) => (await q("UPDATE ai_proposals SET status = $2, decided_by = $3, decided_at = NOW(), note = $4 WHERE id = $1 AND status = 'pending' RETURNING id, status", [uuid(id, 'id'), b.accept ? 'accepted' : 'rejected', p.id, b.note ? str(b.note, 'note', 500) : null]))[0]);
    if (!r) throw new NotFoundException('pending proposal not found');
    await this.audit.log({ actorId: p.id, tenant: slug, action: `ai.proposal.${r.status}`, entity: 'ai_proposal', entityId: id });
    return { ...r, grade_recorded: false };
  }
  async proposals(slug: string, p: Principal) {
    this.requireEnabled(slug); this.authorize(p, slug, 'ai:use');
    return this.tx(slug, (q) => q('SELECT id, kind, student_id, proposal, status, created_at, decided_at FROM ai_proposals WHERE requested_by = $1 OR $2 ORDER BY created_at DESC LIMIT 100', [p.id, p.roles.some((r) => r !== 'teacher')]));
  }
  /** Saves reviewed QCM items as a DRAFT quiz (unpublished) through the gamification service, which applies its own class-scope rules. */
  async saveQcm(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'ai:use');
    const v = validateQcm(b?.questions); if (!v.ok.length) throw new BadRequestException('no valid question');
    return this.games.createQuiz(slug, p, { class_id: b.class_id, subject_id: b.subject_id, title: b.title, mode: 'qcm', questions: v.ok });
  }
  async usage(slug: string, p: Principal) {
    this.requireEnabled(slug); this.authorize(p, slug, 'ai:configure');
    return this.tx(slug, (q) => q("SELECT kind, role, adapter, COUNT(*)::int AS calls, SUM(chars_in)::int AS chars_in, SUM(redactions)::int AS redactions, COUNT(*) FILTER (WHERE blocked)::int AS blocked FROM ai_usage_log WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY kind, role, adapter ORDER BY kind, role"));
  }
}
