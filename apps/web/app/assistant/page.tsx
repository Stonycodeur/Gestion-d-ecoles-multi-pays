'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

/** Teacher tools (summary, QCM, exercises, translation, correction help) and student tutor. Everything produced is a proposal: nothing is graded or published automatically. */
export default function AssistantPage() {
  const [st, setSt] = useState<any>(null); const [kind, setKind] = useState('summarize'); const [text, setText] = useState(''); const [lang, setLang] = useState<'fr' | 'en'>('fr');
  const [ref, setRef] = useState(''); const [ans, setAns] = useState(''); const [max, setMax] = useState(20); const [out, setOut] = useState<any>(null); const [msg, setMsg] = useState('');
  const [chat, setChat] = useState<{ who: string; text: string }[]>([]); const [cls, setCls] = useState(''); const [title, setTitle] = useState(''); const [props, setProps] = useState<any[]>([]);
  useEffect(() => { (async () => { const s = await api('/ai/status'); if (s.ok) setSt(s.data); else setMsg(`Assistant indisponible : ${s.error}`); const p = await api('/ai/proposals'); if (p.ok) setProps(p.data); })(); }, []);
  const run = async (k = kind) => {
    setMsg('…'); const body: any = { kind: k, text, lang, target: lang === 'fr' ? 'en' : 'fr' }; if (k === 'correction_help') { body.reference = ref; body.answer = ans; body.max_points = max; }
    const r = await api('/ai/assist', { method: 'POST', body, online: true });
    if (!r.ok) { setMsg(`Refusé : ${r.error}`); return; }
    setMsg(r.data.simulated ? 'Réponse simulée (aucun modèle branché)' : ''); setOut(r.data);
    if (k === 'tutor') { setChat((c) => [...c, { who: 'Moi', text }, { who: 'Tuteur', text: r.data.output.reply }]); setText(''); }
    else { const p = await api('/ai/proposals'); if (p.ok) setProps(p.data); }
  };
  const save = async () => { const r = await api('/ai/qcm/save', { method: 'POST', body: { class_id: cls, title, questions: out.output.questions }, online: true }); setMsg(r.ok ? 'Quiz enregistré en brouillon (à publier depuis Jeux)' : `Refusé : ${r.error}`); };
  const decide = async (id: string, accept: boolean) => { const r = await api(`/ai/proposals/${id}/decision`, { method: 'POST', body: { accept }, online: true }); setMsg(r.ok ? 'Décision enregistrée (aucune note enregistrée)' : `Refusé : ${r.error}`); const p = await api('/ai/proposals'); if (p.ok) setProps(p.data); };
  return (
    <Shell>
      <h1>Assistant pédagogique</h1><p role="status">{msg}</p>
      {st && !st.enabled && <p>L’assistant n’est pas activé pour cet établissement.</p>}
      <p>Les noms, e-mails et téléphones sont remplacés par des pseudonymes avant tout envoi à un modèle. Les propositions sont toujours validées par l’enseignant.</p>
      <label>Outil <select value={kind} onChange={(e) => { setKind(e.target.value); setOut(null); }}>
        {[['summarize', 'Résumé de cours'], ['qcm', 'Générer un QCM'], ['exercises', 'Exercices'], ['translate', 'Traduction FR/EN'], ['correction_help', 'Aide à la correction'], ['tutor', 'Tuteur (élèves)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>{' '}
      <label>Langue <select value={lang} onChange={(e) => setLang(e.target.value as 'fr' | 'en')}><option value="fr">Français</option><option value="en">English</option></select></label>
      {kind === 'tutor' && <ul aria-label="conversation">{chat.map((c, i) => <li key={i}><strong>{c.who}</strong> : {c.text}</li>)}</ul>}
      <p><label>{kind === 'tutor' ? 'Ta question' : kind === 'correction_help' ? 'Sujet' : 'Texte'}<br /><textarea rows={5} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} /></label></p>
      {kind === 'correction_help' && <><p><label>Corrigé de référence<br /><textarea rows={3} style={{ width: '100%' }} value={ref} onChange={(e) => setRef(e.target.value)} /></label></p>
        <p><label>Réponse de l’élève<br /><textarea rows={3} style={{ width: '100%' }} value={ans} onChange={(e) => setAns(e.target.value)} /></label></p>
        <label>Barème <input type="number" min={1} value={max} onChange={(e) => setMax(Number(e.target.value))} /></label></>}
      <p><button onClick={() => run()} disabled={!text}>Lancer</button></p>
      {out && kind !== 'tutor' && <section aria-label="résultat">
        {out.output.summary && <p>{out.output.summary}</p>}{out.output.text && <p>{out.output.text}</p>}
        {out.output.exercises && <ol>{out.output.exercises.map((e: string, i: number) => <li key={i}>{e}</li>)}</ol>}
        {out.output.questions && <><ol>{out.output.questions.map((q: any, i: number) => <li key={i}>{q.prompt}<ul>{q.choices.map((c: string, j: number) => <li key={j}>{j === q.correct ? '✔ ' : ''}{c}</li>)}</ul></li>)}</ol>
          <label>Classe (id) <input value={cls} onChange={(e) => setCls(e.target.value)} /></label>{' '}<label>Titre <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>{' '}<button onClick={save} disabled={!cls || !title}>Enregistrer en brouillon</button></>}
        {out.output.feedback !== undefined && <p>Note suggérée : <strong>{out.output.suggested_points ?? '—'}/{out.output.max_points}</strong> — {out.output.feedback}</p>}</section>}
      {props.length > 0 && <><h2>Propositions de correction</h2><ul>{props.map((p) => <li key={p.id}>{p.proposal.suggested_points ?? '—'}/{p.proposal.max_points} — {p.status} {p.status === 'pending' && <><button onClick={() => decide(p.id, true)}>Retenir</button> <button onClick={() => decide(p.id, false)}>Écarter</button></>}</li>)}</ul></>}
    </Shell>
  );
}
