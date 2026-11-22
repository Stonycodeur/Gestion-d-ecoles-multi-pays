'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function LessonsPage() {
  const [classes, setClasses] = useState<any[]>([]); const [subjects, setSubjects] = useState<any[]>([]); const [lessons, setLessons] = useState<any[]>([]);
  const [q, setQ] = useState(''); const [f, setF] = useState({ class_id: '', subject_id: '', on_date: new Date().toISOString().slice(0, 10), title: '', content: '', homework: '', homework_due: '' });
  const [msg, setMsg] = useState('');
  const load = async () => { const r = await api(`/lessons?${q ? `q=${encodeURIComponent(q)}` : ''}`); setLessons(r.data ?? []); };
  useEffect(() => { api('/classes').then((r) => setClasses(r.data ?? [])); api('/subjects').then((r) => setSubjects(r.data ?? [])); void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    const body = { ...f, homework: f.homework || undefined, homework_due: f.homework_due || undefined };
    const r = await api('/lessons', { method: 'POST', body });
    setMsg(r.queued ? 'Hors ligne : saisie mise en file' : r.ok ? 'Enregistré' : `Refusé : ${r.error}`); if (r.ok && !r.queued) await load();
  };
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Shell>
      <h1>Cahier de textes</h1>
      <input aria-label="recherche" placeholder="Recherche plein texte" value={q} onChange={(e) => setQ(e.target.value)} /> <button onClick={load}>Chercher</button>
      <ul>{lessons.map((l) => <li key={l.id}><strong>{l.on_date?.slice(0, 10)}</strong> {l.title}{l.homework ? ` — À faire : ${l.homework}` : ''}{l.visa_at ? ' ✔ visa' : ''} <a href={`/xr?lesson_id=${l.id}`}>3D/AR</a></li>)}</ul>
      <fieldset><legend>Nouvelle séance</legend>
        <select aria-label="classe" value={f.class_id} onChange={set('class_id')}><option value="">Classe…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{' '}
        <select aria-label="matière" value={f.subject_id} onChange={set('subject_id')}><option value="">Matière…</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
        <input aria-label="date" type="date" value={f.on_date} onChange={set('on_date')} /> <input aria-label="titre" placeholder="Titre" value={f.title} onChange={set('title')} />
        <br /><textarea aria-label="contenu" placeholder="Contenu" value={f.content} onChange={set('content')} />
        <br /><input aria-label="devoir" placeholder="Travail à faire" value={f.homework} onChange={set('homework')} /> <input aria-label="échéance" type="date" value={f.homework_due} onChange={set('homework_due')} />
        <br /><button disabled={!f.class_id || !f.subject_id || !f.title} onClick={add}>Publier</button>
      </fieldset>
      {msg && <p role="status">{msg}</p>}
    </Shell>
  );
}
