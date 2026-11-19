'use client';
import { useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import { api } from '../../../lib/api';

interface Q { prompt: string; choices: string[]; correct: number; points: number }
const blank = (): Q => ({ prompt: '', choices: ['', ''], correct: 0, points: 1 });

export default function ManageGames() {
  const [classes, setClasses] = useState<any[]>([]); const [subjects, setSubjects] = useState<any[]>([]); const [quizzes, setQuizzes] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [title, setTitle] = useState(''); const [cls, setCls] = useState(''); const [subject, setSubject] = useState(''); const [mode, setMode] = useState('qcm');
  const [limit, setLimit] = useState('600'); const [qs, setQs] = useState<Q[]>([blank()]); const [msg, setMsg] = useState('');
  const [ch, setCh] = useState({ code: '', title: '', kind: 'individual', metric: 'xp', target: '100', starts_on: '', ends_on: '' });
  const [team, setTeam] = useState({ name: '', members: [] as string[] });
  const load = () => api('/quizzes').then((r) => setQuizzes(r.data ?? []));
  useEffect(() => { api('/classes').then((r) => setClasses(r.data ?? [])); api('/subjects').then((r) => setSubjects(r.data ?? [])); void load(); }, []);
  useEffect(() => { if (cls) api(`/students?class_id=${cls}`).then((r) => setStudents(r.data ?? [])); }, [cls]);
  const upd = (i: number, f: Partial<Q>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...f } : q)));
  const say = (r: any, ok: string) => setMsg(r.ok ? ok : `Refusé : ${r.error}`);
  const createQuiz = async () => {
    const body: any = { title, class_id: cls, mode, time_limit_sec: Number(limit) || null, questions: qs };
    if (subject) body.subject_id = subject;
    const r = await api('/quizzes', { method: 'POST', body }); say(r, 'Quiz créé (brouillon)'); if (r.ok) { setQs([blank()]); setTitle(''); await load(); }
  };
  const publish = async (id: string) => { say(await api(`/quizzes/${id}/publish`, { method: 'POST', body: {} }), 'Quiz publié'); await load(); };
  const createChallenge = async () => say(await api('/challenges', { method: 'POST', body: { ...ch, target: Number(ch.target) } }), 'Défi créé');
  const createTeam = async () => say(await api('/teams', { method: 'POST', body: { name: team.name, class_id: cls, member_ids: team.members } }), 'Équipe créée');

  return (
    <Shell>
      <h1>Créer des jeux, défis et équipes</h1>
      <p role="status">{msg}</p>
      <h2>Quiz / examen gamifié</h2>
      <label>Titre <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>{' '}
      <select aria-label="classe" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Classe…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{' '}
      <select aria-label="matière" value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">Sans matière (jeu)</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
      <select aria-label="mode" value={mode} onChange={(e) => setMode(e.target.value)}>{['qcm', 'escape_game', 'team_quiz', 'boss'].map((m) => <option key={m}>{m}</option>)}</select>{' '}
      <label>Durée (s) <input type="number" min={10} value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
      {qs.map((q, i) => (
        <fieldset key={i}><legend>Question {i + 1}</legend>
          <input aria-label="énoncé" placeholder="Énoncé" value={q.prompt} onChange={(e) => upd(i, { prompt: e.target.value })} />
          {q.choices.map((c, k) => (
            <div key={k}><input type="radio" aria-label={`bonne réponse ${k + 1}`} checked={q.correct === k} onChange={() => upd(i, { correct: k })} />
              <input aria-label={`choix ${k + 1}`} value={c} onChange={(e) => upd(i, { choices: q.choices.map((x, m) => (m === k ? e.target.value : x)) })} /></div>))}
          <button type="button" onClick={() => upd(i, { choices: [...q.choices, ''] })} disabled={q.choices.length >= 8}>+ choix</button>{' '}
          <label>Points <input type="number" min={1} value={q.points} onChange={(e) => upd(i, { points: Number(e.target.value) })} /></label>
        </fieldset>))}
      <button type="button" onClick={() => setQs([...qs, blank()])}>+ question</button>{' '}
      <button type="button" onClick={createQuiz} disabled={!title || !cls}>Créer le quiz</button>
      <h3>Quiz existants</h3>
      <ul>{quizzes.map((q) => <li key={q.id}>{q.title} ({q.mode}) — {q.published ? 'publié' : 'brouillon'} {!q.published && <button onClick={() => publish(q.id)}>Publier</button>}</li>)}</ul>

      <h2>Défi</h2>
      {(['code', 'title', 'target', 'starts_on', 'ends_on'] as const).map((k) => (
        <label key={k} style={{ marginRight: 8 }}>{k} <input type={k.endsWith('_on') ? 'date' : k === 'target' ? 'number' : 'text'} value={(ch as any)[k]} onChange={(e) => setCh({ ...ch, [k]: e.target.value })} /></label>))}
      <select aria-label="type" value={ch.kind} onChange={(e) => setCh({ ...ch, kind: e.target.value })}><option value="individual">individuel</option><option value="group">groupe</option></select>{' '}
      <select aria-label="mesure" value={ch.metric} onChange={(e) => setCh({ ...ch, metric: e.target.value })}>{['xp', 'quizzes', 'perfect'].map((m) => <option key={m}>{m}</option>)}</select>{' '}
      <button type="button" onClick={createChallenge} disabled={!ch.code || !ch.title || !ch.starts_on || !ch.ends_on}>Créer le défi</button>

      <h2>Équipe (classe choisie ci-dessus)</h2>
      <label>Nom <input value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} /></label>
      <ul style={{ listStyle: 'none', padding: 0 }}>{students.map((s) => (
        <li key={s.id}><label><input type="checkbox" checked={team.members.includes(s.id)} onChange={(e) => setTeam({ ...team, members: e.target.checked ? [...team.members, s.id] : team.members.filter((x) => x !== s.id) })} /> {s.first_name} {s.last_name}</label></li>))}</ul>
      <button type="button" onClick={createTeam} disabled={!team.name || !cls}>Créer l’équipe</button>
    </Shell>
  );
}
