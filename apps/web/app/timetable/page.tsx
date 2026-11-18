'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

interface Slot { id: string; classId: string; subjectId: string; teacherId: string; day: number; period: number }
const DAYS = [1, 2, 3, 4, 5], PERIODS = [0, 1, 2, 3, 4, 5];

export default function TimetablePage() {
  const [id, setId] = useState(''); const [slots, setSlots] = useState<Slot[]>([]); const [status, setStatus] = useState('');
  const [names, setNames] = useState<Record<string, string>>({}); const [msg, setMsg] = useState(''); const [drag, setDrag] = useState<string | null>(null);

  const load = async (sid = id) => {
    const r = await api(`/schedules/${sid}`);
    if (!r.ok) { setMsg(r.error ?? 'error'); return; }
    setSlots(r.data.slots); setStatus(r.data.schedule.status); setMsg(r.data.conflicts.length ? `${r.data.conflicts.length} conflit(s)` : '');
    const subj = await api('/subjects'); setNames(Object.fromEntries((subj.data ?? []).map((s: any) => [s.id, s.name])));
  };
  useEffect(() => { const q = new URLSearchParams(window.location.search).get('id'); if (q) { setId(q); void load(q); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const drop = async (day: number, period: number) => {
    if (!drag) return;
    const r = await api(`/schedules/${id}/slots/${drag}`, { method: 'PATCH', body: { weekday: day, period_index: period } });
    setMsg(r.ok ? '' : `Refusé : ${r.error}`); setDrag(null); if (r.ok && !r.queued) await load();
  };
  const act = async (a: 'validate' | 'publish') => { const r = await api(`/schedules/${id}/${a}`, { method: 'POST', body: {} }); setMsg(r.ok ? '' : `Refusé : ${r.error}`); await load(); };
  const ical = `${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000'}/schedules/${id}/ical`;

  return (
    <Shell>
      <h1>Emploi du temps</h1>
      <label>Identifiant <input value={id} onChange={(e) => setId(e.target.value)} /></label> <button onClick={() => load()}>Charger</button>
      {status && <p>Statut : <strong>{status}</strong> {status === 'draft' && '(glisser-déposer actif)'}</p>}
      {msg && <p role="alert" style={{ color: 'crimson' }}>{msg}</p>}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th />{DAYS.map((d) => <th key={d}>J{d}</th>)}</tr></thead>
        <tbody>{PERIODS.map((p) => (
          <tr key={p}><th scope="row">P{p + 1}</th>{DAYS.map((d) => (
            <td key={d} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(d, p)} style={{ border: '1px solid #ccc', height: 44, verticalAlign: 'top' }}>
              {slots.filter((s) => s.day === d && s.period === p).map((s) => (
                <div key={s.id} draggable={status === 'draft'} onDragStart={() => setDrag(s.id)} style={{ background: '#dbeafe', padding: 2, cursor: status === 'draft' ? 'grab' : 'default' }}>{names[s.subjectId] ?? s.subjectId.slice(0, 6)}</div>
              ))}
            </td>))}</tr>))}</tbody>
      </table>
      <p>
        <button disabled={status !== 'draft'} onClick={() => act('validate')}>Valider (direction)</button>{' '}
        <button disabled={status !== 'validated'} onClick={() => act('publish')}>Publier</button>{' '}
        {id && <span>iCal : <code>{ical}?first_monday=…&until=…</code></span>}
      </p>
    </Shell>
  );
}
