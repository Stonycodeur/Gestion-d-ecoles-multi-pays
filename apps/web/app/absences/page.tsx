'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function AbsencesPage() {
  const [classes, setClasses] = useState<any[]>([]); const [cls, setCls] = useState(''); const [students, setStudents] = useState<any[]>([]);
  const [sid, setSid] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [kind, setKind] = useState('absence');
  const [stats, setStats] = useState<any>(null); const [msg, setMsg] = useState('');
  useEffect(() => { api('/classes').then((r) => setClasses(r.data ?? [])); }, []);
  useEffect(() => { if (cls) api(`/students?class_id=${cls}`).then((r) => setStudents(r.data ?? [])); }, [cls]);
  const refresh = async (id = sid) => { const r = await api(`/students/${id}/attendance`); setStats(r.ok ? r.data : null); };
  const record = async () => {
    const r = await api('/absences', { method: 'POST', body: { student_id: sid, on_date: date, kind, period_index: 0, minutes_late: kind === 'late' ? 10 : undefined } });
    setMsg(r.queued ? 'Hors ligne : pointage mis en file' : r.ok ? 'Enregistré' : `Refusé : ${r.error}`); if (r.ok && !r.queued) await refresh();
  };
  return (
    <Shell>
      <h1>Absences</h1>
      <select aria-label="classe" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Classe…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{' '}
      <select aria-label="élève" value={sid} onChange={(e) => { setSid(e.target.value); if (e.target.value) void refresh(e.target.value); }}><option value="">Élève…</option>{students.map((s) => <option key={s.id} value={s.id}>{s.last_name} {s.first_name}</option>)}</select>{' '}
      <input aria-label="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />{' '}
      <select aria-label="type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="absence">Absence</option><option value="late">Retard</option></select>{' '}
      <button disabled={!sid} onClick={record}>Pointer</button>
      {msg && <p role="status">{msg}</p>}
      {stats && <p>Absences {stats.stats.absences} (non justifiées {stats.stats.unjustified}, justifiées {stats.stats.justified}), retards {stats.stats.lates} — alerte : <strong>{stats.alert}</strong></p>}
    </Shell>
  );
}
