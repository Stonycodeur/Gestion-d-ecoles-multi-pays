'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function GradesPage() {
  const [classes, setClasses] = useState<any[]>([]); const [subjects, setSubjects] = useState<any[]>([]); const [students, setStudents] = useState<any[]>([]);
  const [cls, setCls] = useState(''); const [subject, setSubject] = useState(''); const [period, setPeriod] = useState('T1'); const [title, setTitle] = useState('DS 1');
  const [evalId, setEvalId] = useState(''); const [scale, setScale] = useState<any>(null); const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(''); const [report, setReport] = useState<any>(null);

  useEffect(() => { api('/classes').then((r) => setClasses(r.data ?? [])); api('/subjects').then((r) => setSubjects(r.data ?? [])); }, []);
  useEffect(() => { if (cls) api(`/students?class_id=${cls}`).then((r) => setStudents(r.data ?? [])); }, [cls]);

  const create = async () => {
    const r = await api('/evaluations', { method: 'POST', body: { class_id: cls, subject_id: subject, period_code: period, title } });
    if (r.ok && r.data) { setEvalId(r.data.id); setScale(r.data.scale_snapshot); setMsg(''); } else setMsg(r.error ?? 'error');
  };
  const save = async () => {
    const entries = students.filter((s) => values[s.id] !== undefined && values[s.id] !== '').map((s) => ({ student_id: s.id, value: scale?.type === 'letter' ? values[s.id] : Number(values[s.id]) }));
    const r = await api(`/evaluations/${evalId}/grades`, { method: 'POST', body: { entries } });
    setMsg(r.queued ? 'Hors ligne : saisie mise en file' : r.ok ? `${r.data.saved} note(s) enregistrée(s)` : `Refusé : ${r.error}`);
  };
  const show = async (sid: string) => { const r = await api(`/students/${sid}/report?period=${period}`); setReport(r.ok ? r.data : null); };

  return (
    <Shell>
      <h1>Notes</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="classe" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Classe…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="matière" value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">Matière…</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input aria-label="période" value={period} onChange={(e) => setPeriod(e.target.value)} size={4} /><input aria-label="titre" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button disabled={!cls || !subject} onClick={create}>Créer l’évaluation</button>
      </div>
      {scale && <p>Échelle active : <strong>{scale.code}</strong> ({scale.min}–{scale.max}, pas {scale.step}, passage {scale.passMark})</p>}
      {evalId && (
        <table><tbody>{students.map((s) => (
          <tr key={s.id}><td>{s.last_name} {s.first_name}</td>
            <td><input aria-label={`note ${s.last_name}`} type={scale?.type === 'letter' ? 'text' : 'number'} min={scale?.min} max={scale?.max} step={scale?.step}
              value={values[s.id] ?? ''} onChange={(e) => setValues({ ...values, [s.id]: e.target.value })} /></td>
            <td><button onClick={() => show(s.id)}>Bulletin</button></td></tr>))}</tbody></table>
      )}
      {evalId && <button onClick={save}>Enregistrer</button>}
      {msg && <p role="status">{msg}</p>}
      {report && <section aria-label="bulletin"><h2>{report.student.first_name} {report.student.last_name} — {report.period}</h2>
        <ul>{report.lines.map((l: any) => <li key={l.subjectId}>{l.subject} (coef {l.coefficient}) : {l.average.text}</li>)}</ul>
        <p>Moyenne générale : <strong>{report.general?.text ?? '—'}</strong>{report.rank ? ` — rang ${report.rank}/${report.classSize}` : ''}</p></section>}
    </Shell>
  );
}
