import { ServiceUnavailableException } from '@nestjs/common';
import { parseJsonLoose, type AiKind } from '@ecolemanager/shared';

export interface LlmRequest {
  kind: AiKind; lang: 'fr' | 'en'; text: string; target?: 'fr' | 'en'; count: number;
  reference?: string; answer?: string; maxPoints?: number; level?: string; maxChars?: number;
}
export interface LlmResult { output: Record<string, any>; simulated: boolean }
export interface LlmAdapter { readonly name: string; run(r: LlmRequest): Promise<LlmResult> }

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const words = (t: string) => (t.toLowerCase().match(/\p{L}{5,}/gu) ?? []);

/** Local, deterministic stand-in with the same contract as a real model: lets web and mobile be used and tested with no account. Outputs are flagged simulated. */
export class SandboxLlm implements LlmAdapter {
  readonly name = 'sandbox';
  async run(r: LlmRequest): Promise<LlmResult> {
    const fr = r.lang === 'fr'; const ss = sentences(r.text);
    switch (r.kind) {
      case 'summarize': {
        const freq = new Map<string, number>(); for (const w of words(r.text)) freq.set(w, (freq.get(w) ?? 0) + 1);
        const scored = ss.map((s, i) => ({ s, i, v: words(s).reduce((a, w) => a + (freq.get(w) ?? 0), 0) / Math.max(1, words(s).length) }));
        const keep = scored.sort((a, b) => b.v - a.v).slice(0, Math.max(1, r.count)).sort((a, b) => a.i - b.i);
        return { simulated: true, output: { summary: keep.map((k) => k.s).join(' ') } };
      }
      case 'qcm': {
        const pool = [...new Set(words(r.text))]; const questions: any[] = [];
        for (const s of ss) {
          if (questions.length >= r.count) break;
          const ws = words(s); if (s.split(/\s+/).length < 6 || !ws.length) continue;
          const answer = ws.reduce((a, b) => (b.length > a.length ? b : a));
          const others = pool.filter((w) => w !== answer).slice(questions.length, questions.length + 3);
          if (others.length < 1) continue;
          const choices = [...others]; const correct = questions.length % (choices.length + 1); choices.splice(correct, 0, answer);
          questions.push({ prompt: s.replace(new RegExp(answer, 'i'), '_____'), choices, correct, points: 1 });
        }
        return { simulated: true, output: { questions } };
      }
      case 'exercises':
        return { simulated: true, output: { exercises: ss.slice(0, Math.max(1, r.count)).map((s) => (fr ? `Explique avec tes propres mots : « ${s} »` : `Explain in your own words: “${s}”`)) } };
      case 'translate':
        return { simulated: true, output: { text: `[${fr ? 'traduction simulée' : 'simulated translation'} ${r.lang}→${r.target ?? (fr ? 'en' : 'fr')}] ${r.text}` } };
      case 'correction_help': {
        const ref = [...new Set(words(r.reference ?? ''))]; const ans = new Set(words(r.answer ?? ''));
        const matched = ref.filter((w) => ans.has(w)); const missing = ref.filter((w) => !ans.has(w)); const max = r.maxPoints ?? 20;
        const ratio = ref.length ? matched.length / ref.length : 0;
        return { simulated: true, output: { suggested_points: Math.round(ratio * max * 4) / 4, max_points: max, matched, missing,
          feedback: fr ? `Points de la correction retrouvés : ${matched.length}/${ref.length}. À vérifier par l’enseignant.${missing.length ? ` Notions absentes : ${missing.join(', ')}.` : ''}` : `Reference points found: ${matched.length}/${ref.length}. To be checked by the teacher.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}` } };
      }
      case 'tutor': {
        const topic = r.text.split(/\s+/).slice(0, 8).join(' ');
        return { simulated: true, output: { reply: fr ? `Essayons ensemble. Que sais-tu déjà à propos de « ${topic} » ? Quelle serait la première étape ? (mode simulé)` : `Let’s work it out together. What do you already know about “${topic}”? What would be the first step? (simulated mode)` } };
      }
    }
  }
}

/** Any OpenAI-compatible chat-completions endpoint (LLM_URL, LLM_API_KEY, LLM_MODEL). Only pseudonymised text ever reaches this class. */
export class HttpLlm implements LlmAdapter {
  readonly name = 'http';
  constructor(private readonly url: string, private readonly key: string, private readonly model: string) {}
  private prompt(r: LlmRequest): { system: string; user: string; json: boolean } {
    const lang = r.lang === 'fr' ? 'français' : 'English';
    const base = `Tu es un assistant pédagogique pour un établissement scolaire. Réponds en ${lang}. Les jetons entre crochets comme [NOM1] sont des pseudonymes : recopie-les tels quels, ne cherche pas à les deviner.`;
    switch (r.kind) {
      case 'summarize': return { system: base, user: `Résume ce cours en ${r.count} phrases au plus :\n${r.text}`, json: false };
      case 'qcm': return { system: base, user: `Génère ${r.count} QCM à partir du texte. Réponds UNIQUEMENT par un JSON {"questions":[{"prompt":"","choices":["",""],"correct":0,"points":1}]} ; "correct" est l'indice de la bonne réponse ; réponses distinctes.\n${r.text}`, json: true };
      case 'exercises': return { system: base, user: `Propose ${r.count} exercices. Réponds UNIQUEMENT par un JSON {"exercises":["",""]}.\n${r.text}`, json: true };
      case 'translate': return { system: base, user: `Traduis vers ${r.target === 'en' ? 'English' : 'français'}, sans commentaire :\n${r.text}`, json: false };
      case 'correction_help': return { system: base, user: `Corrigé de référence :\n${r.reference}\n\nRéponse de l'élève :\n${r.answer}\n\nPropose une note sur ${r.maxPoints ?? 20} et un retour bienveillant. Réponds UNIQUEMENT par un JSON {"suggested_points":0,"feedback":"","matched":[],"missing":[]}. C'est une proposition que l'enseignant validera.`, json: true };
      case 'tutor': return { system: `${base} Tu es un tuteur pour un élève de niveau ${r.level ?? 'collège'}. Guide par des questions et des indices, ne donne pas directement la solution d'un devoir, reste dans le cadre scolaire, réponse de ${r.maxChars ?? 600} caractères au plus.`, user: r.text, json: false };
    }
  }
  async run(r: LlmRequest): Promise<LlmResult> {
    const { system, user, json } = this.prompt(r);
    let res: Response;
    try {
      res = await fetch(this.url, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ model: this.model, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    } catch { throw new ServiceUnavailableException('language model unreachable'); }
    if (!res.ok) throw new ServiceUnavailableException(`language model error (HTTP ${res.status})`);
    const content: string = (await res.json() as any)?.choices?.[0]?.message?.content ?? '';
    if (!content) throw new ServiceUnavailableException('empty model answer');
    if (!json) return { simulated: false, output: r.kind === 'summarize' ? { summary: content } : r.kind === 'translate' ? { text: content } : { reply: content } };
    try { const o = parseJsonLoose(content) as any; return { simulated: false, output: Array.isArray(o) ? (r.kind === 'qcm' ? { questions: o } : { exercises: o }) : o }; } catch { throw new ServiceUnavailableException('model answer was not valid JSON'); }
  }
}

export function createLlm(env = process.env): LlmAdapter {
  if ((env.LLM_MODE ?? 'sandbox') !== 'live') return new SandboxLlm();
  if (!env.LLM_URL || !env.LLM_API_KEY) throw new Error('LLM_MODE=live requires LLM_URL and LLM_API_KEY');
  return new HttpLlm(env.LLM_URL, env.LLM_API_KEY, env.LLM_MODEL ?? 'default');
}
