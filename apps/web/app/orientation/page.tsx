'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function OrientationPage() {
  const [paths, setPaths] = useState<any[]>([]); const [items, setItems] = useState<any[]>([]); const [students, setStudents] = useState<any[]>([]);
  const [staff, setStaff] = useState(false); const [msg, setMsg] = useState(''); const [sid, setSid] = useState(''); const [fiche, setFiche] = useState<any>(null);
  const [form, setForm] = useState({ organisation: '', supervisor_name: '', start_on: '', end_on: '' }); const [path, setPath] = useState({ title: '', kind: 'path', description: '' });
  const [report, setReport] = useState<Record<string, string>>({});

  const load = async () => {
    const p = await api('/orientation/paths'); if (p.ok) setPaths(p.data);
    const i = await api('/orientation/internships'); if (i.ok) setItems(i.data);
    const all = await api('/students'); if (all.ok) { setStaff(true); setStudents(all.data); } else { const m = await api('/me/students'); if (m.ok) { setStudents(m.data); setSid(m.data[0]?.id ?? ''); } }
  };
  useEffect(() => { void load(); }, []);
  const act = async (r: Promise<any>, ok: string) => { const x = await r; setMsg(x.ok ? ok : `Refusé : ${x.error}`); await load(); };
  const request = () => act(api('/orientation/internships', { method: 'POST', body: { ...form, student_id: sid }, online: true }), 'Demande de stage envoyée');
  const move = (id: string, to: string) => act(api(`/orientation/internships/${id}/transition`, { method: 'POST', body: { to, note: to === 'rejected' ? 'Refusé par la direction' : undefined }, online: true }), `Stage : ${to}`);
  const loadFiche = async () => { const r = await api(`/orientation/exam/fiche/${sid}`); if (r.ok) { setFiche(r.data); setMsg(''); } else { setFiche(null); setMsg(`Fiche indisponible : ${r.error}`); } };

  return (
    <Shell>
      <h1>Orientation et stages</h1><p role="status">{msg}</p>
      <label>Élève <select value={sid} onChange={(e) => setSid(e.target.value)}><option value="">—</option>{students.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}</select></label>
      <h2>Parcours et fiches métiers</h2>
      <ul>{paths.map((p) => <li key={p.id}><strong>{p.title}</strong> ({p.kind === 'career_sheet' ? 'fiche métier' : `${p.from_level ?? ''} → ${p.to_level ?? ''}`}) — {p.description}{p.steps?.length ? <ol>{p.steps.map((s: string) => <li key={s}>{s}</li>)}</ol> : null}</li>)}</ul>
      {staff && <fieldset><legend>Ajouter un parcours / une fiche métier</legend>
        <input aria-label="titre" placeholder="Titre" value={path.title} onChange={(e) => setPath({ ...path, title: e.target.value })} />{' '}
        <select aria-label="type" value={path.kind} onChange={(e) => setPath({ ...path, kind: e.target.value })}><option value="path">Parcours</option><option value="career_sheet">Fiche métier</option></select>{' '}
        <input aria-label="description" placeholder="Description" value={path.description} onChange={(e) => setPath({ ...path, description: e.target.value })} />{' '}
        <button onClick={() => act(api('/orientation/paths', { method: 'POST', body: path, online: true }), 'Ajouté')} disabled={!path.title || !path.description}>Ajouter</button></fieldset>}
      <h2>Stages</h2>
      <ul>{items.map((i) => <li key={i.id}><strong>{i.organisation}</strong> — {i.first_name} {i.last_name} — {String(i.start_on).slice(0, 10)} → {String(i.end_on).slice(0, 10)} — <em>{i.status}</em>
        {staff && i.status === 'requested' && <> <button onClick={() => move(i.id, 'approved')}>Valider</button> <button onClick={() => move(i.id, 'rejected')}>Refuser</button></>}
        {staff && i.status === 'report_submitted' && <> <button onClick={() => move(i.id, 'completed')}>Clôturer</button> <button onClick={() => move(i.id, 'in_progress')}>Renvoyer</button></>}
        {!staff && i.status === 'approved' && <button onClick={() => move(i.id, 'in_progress')}>Démarrer</button>}
        {!staff && i.status === 'in_progress' && <><br /><textarea aria-label="rapport" value={report[i.id] ?? ''} onChange={(e) => setReport({ ...report, [i.id]: e.target.value })} /> <button onClick={() => act(api(`/orientation/internships/${i.id}/report`, { method: 'POST', body: { text: report[i.id] }, online: true }), 'Rapport remis')}>Remettre le rapport</button></>}
      </li>)}</ul>
      <fieldset><legend>Demander un stage</legend>
        <input aria-label="organisme" placeholder="Organisme" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />{' '}
        <input aria-label="tuteur" placeholder="Maître de stage" value={form.supervisor_name} onChange={(e) => setForm({ ...form, supervisor_name: e.target.value })} />{' '}
        <input aria-label="début" type="date" value={form.start_on} onChange={(e) => setForm({ ...form, start_on: e.target.value })} />{' '}
        <input aria-label="fin" type="date" value={form.end_on} onChange={(e) => setForm({ ...form, end_on: e.target.value })} />{' '}
        <button onClick={request} disabled={!sid || !form.organisation || !form.start_on || !form.end_on}>Envoyer</button></fieldset>
      <h2>Fiche d’examen de fin de collège (BEPC / Brevet)</h2>
      <button onClick={loadFiche} disabled={!sid}>Afficher la fiche</button>
      {fiche && <div><p>Examen {fiche.fiche.exam_code} — année {fiche.school_year} — <em>projection indicative, pas un résultat officiel</em></p>
        <p>Contrôle continu : {fiche.fiche.continuous_pct ?? '—'} % · Examen : {fiche.fiche.exam_pct ?? '—'} % · Projection : {fiche.fiche.projected_pct ?? '—'} % · {fiche.fiche.admitted === null ? '' : fiche.fiche.admitted ? 'au-dessus du seuil d’admission' : 'sous le seuil d’admission'} {fiche.fiche.mention ?? ''}</p>
        <table><thead><tr><th>Matière</th><th>Coef.</th><th>Continu</th><th>Examen</th><th>Combiné</th></tr></thead><tbody>{fiche.fiche.subjects.map((s: any) => <tr key={s.subject_code}><td>{s.subject_code}</td><td>{s.coefficient}</td><td>{s.continuous_pct ?? '—'}</td><td>{s.exam_pct ?? '—'}</td><td>{s.combined_pct ?? '—'}</td></tr>)}</tbody></table>
        {fiche.outcome && <p>Résultat enregistré : {fiche.outcome.passed ? 'admis' : 'non admis'} {fiche.outcome.mention ?? ''}</p>}</div>}
    </Shell>
  );
}
