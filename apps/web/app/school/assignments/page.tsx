'use client';
import { useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import Confirm from '../../../components/Confirm';
import { api } from '../../../lib/api';
import { useLang } from '../../../lib/useLang';
import { useNavigation } from '../../../lib/navigation';

interface Row { id: string; class_id: string; subject_id: string; teacher_id: string; weekly_hours: number; subject: string; teacher: string }

/** Which subject, taught by whom, how many hours a week, for each class. This is what the timetable generator and the grade book are built on. */
export default function AssignmentsPage() {
  const { t, l } = useLang(); const { has, loaded, term } = useNavigation();
  const [classes, setClasses] = useState<any[]>([]); const [subjects, setSubjects] = useState<any[]>([]); const [teachers, setTeachers] = useState<any[]>([]);
  const [cid, setCid] = useState(''); const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [f, setF] = useState({ subject_id: '', teacher_id: '', weekly_hours: '2' }); const [del, setDel] = useState<Row | null>(null);
  const write = has('schedule:write');
  useEffect(() => { void api('/classes').then((r) => { if (r.ok) { setClasses(r.data); if (r.data[0]) setCid(r.data[0].id); } }); void api('/subjects').then((r) => r.ok && setSubjects(r.data)); void api('/teachers').then((r) => r.ok && setTeachers(r.data)); }, []);
  const load = async (c = cid) => { if (!c) { setRows([]); return; } const r = await api(`/class-subjects?class_id=${c}`); if (r.ok) { setRows(r.data); setErr(''); } else { setRows([]); setErr(`${t('Erreur', 'Error')} : ${r.error}`); } };
  useEffect(() => { setRows(null); void load(cid); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cid]);
  const add = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); setNote('');
    const r = await api('/class-subjects', { method: 'POST', body: { class_id: cid, subject_id: f.subject_id, teacher_id: f.teacher_id, weekly_hours: Number(f.weekly_hours) }, online: true });
    if (!r.ok) { setErr(r.status === 409 ? t('Cette matière est déjà affectée à cette classe.', 'This subject is already assigned to this class.') : `${t('Erreur', 'Error')} : ${r.error}`); return; }
    setNote(t('Affectation enregistrée.', 'Assignment saved.')); setF({ ...f, subject_id: '' }); await load(); };
  const total = (rows ?? []).reduce((a, x) => a + Number(x.weekly_hours), 0);
  const title = l === 'fr' ? 'Affectations' : 'Assignments';
  if (loaded && !has('schedule:write') && !has('students:read')) return <Shell><h1>{title}</h1><div className="empty-state"><p>{t('Vous n’avez pas accès à cette page.', 'You do not have access to this page.')}</p></div></Shell>;
  return (
    <Shell>
      <h1>{title}</h1>
      <p className="hint">{t(`Pour chaque ${term('classes', l).toLowerCase()}, choisissez les matières, l’enseignant et le volume horaire hebdomadaire.`, `For each ${term('classes', l).toLowerCase()}, choose the subjects, the teacher and the weekly hours.`)}</p>
      <div className="toolbar"><label>{term('classes', l)}<select value={cid} onChange={(e) => setCid(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{rows && <span className="chip">{total} {t('h / semaine', 'h / week')}</span>}</div>
      {err && <p role="alert">{err}</p>}{note && <p role="status">{note}</p>}
      {rows === null ? <p aria-busy="true">{t('Chargement…', 'Loading…')}</p> : rows.length === 0 ? <div className="empty-state"><p>{t('Aucune matière affectée à cette classe.', 'No subject assigned to this class.')}</p></div> : (
        <div className="table-wrap"><table><thead><tr><th scope="col">{t('Matière', 'Subject')}</th><th scope="col">{t('Enseignant', 'Teacher')}</th><th scope="col">{t('Heures / semaine', 'Hours / week')}</th>{write && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.subject}</td><td>{r.teacher}</td><td>{r.weekly_hours}</td>{write && <td className="row-actions"><button type="button" className="btn-sec" onClick={() => setDel(r)}>{t('Retirer', 'Remove')}</button></td>}</tr>)}</tbody></table></div>)}
      {write && cid && <form onSubmit={add} className="school-form" style={{ marginTop: 18 }}><h2>{t('Ajouter une affectation', 'Add an assignment')}</h2>
        <div className="form-grid">
          <label>{t('Matière', 'Subject')}<select required value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{subjects.filter((s) => !(rows ?? []).some((r) => r.subject_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>{t('Enseignant', 'Teacher')}<select required value={f.teacher_id} onChange={(e) => setF({ ...f, teacher_id: e.target.value })}><option value="">—</option>{teachers.map((x) => <option key={x.id} value={x.id}>{x.first_name} {x.last_name}</option>)}</select></label>
          <label>{t('Heures / semaine', 'Hours / week')}<input type="number" min="0.5" max="40" step="0.5" required value={f.weekly_hours} onChange={(e) => setF({ ...f, weekly_hours: e.target.value })} /></label>
        </div>
        <div><button type="submit">{t('Affecter', 'Assign')}</button></div></form>}
      {del && <Confirm title={t('Retirer l’affectation', 'Remove the assignment')} body={t(`« ${del.subject} » ne sera plus enseignée à cette classe.`, `“${del.subject}” will no longer be taught to this class.`)} label={t('Retirer', 'Remove')} onClose={() => setDel(null)}
        onConfirm={async () => { const r = await api(`/class-subjects/${del.id}`, { method: 'DELETE', online: true }); setErr(r.ok ? '' : r.status === 409 ? t('Impossible : des notes ou des séances utilisent cette affectation.', 'Not possible: grades or lessons use this assignment.') : `${t('Erreur', 'Error')} : ${r.error}`); setDel(null); await load(); }} />}
    </Shell>
  );
}
