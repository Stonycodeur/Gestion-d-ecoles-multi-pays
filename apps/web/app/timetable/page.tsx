'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api, openPdf } from '../../lib/api';

interface Slot { id: string; class_id: string; class_name: string; subject_name: string; teacher_name: string; room: string | null; weekday: number; period_index: number }
interface Sub { id: string; slot_id: string; on_date: string; substitute_name: string }
const DAYS = [1, 2, 3, 4, 5], PERIODS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Timetable for every role: student/guardian (own class), teacher (mine), staff (class). Week grid with substitutions, month view, PDF, drag-and-drop on a draft. */
export default function TimetablePage() {
  const [view, setView] = useState<'week' | 'month'>('week');
  const [classes, setClasses] = useState<any[]>([]); const [cls, setCls] = useState(''); const [mine, setMine] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]); const [subs, setSubs] = useState<Sub[]>([]); const [sch, setSch] = useState<any>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); const [days, setDays] = useState<any[]>([]);
  const [msg, setMsg] = useState(''); const [drag, setDrag] = useState<string | null>(null); const [staff, setStaff] = useState(false);

  const query = () => (mine ? 'mine=1' : cls ? `class_id=${cls}` : '');
  const load = async () => {
    const r = await api(`/timetable?${query()}`);
    if (!r.ok) { setMsg(r.error ?? 'error'); return; }
    setMsg(''); setSch(r.data.schedule); setSlots(r.data.slots); setSubs(r.data.substitutions);
  };
  const loadMonth = async () => { const r = await api(`/timetable/month?month=${month}&${query()}`); if (r.ok) setDays(r.data.days); else setMsg(r.error ?? 'error'); };
  useEffect(() => { void (async () => {
    const c = await api('/classes'); if (c.ok) { setClasses(c.data); setStaff(true); }
  })(); }, []);
  useEffect(() => { void load(); if (view === 'month') void loadMonth(); }, [cls, mine, view, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const drop = async (day: number, period: number) => {
    if (!drag || !sch) return;
    const r = await api(`/schedules/${sch.id}/slots/${drag}`, { method: 'PATCH', body: { weekday: day, period_index: period } });
    setMsg(r.ok ? '' : `Refusé / Refused: ${r.error}`); setDrag(null); if (r.ok && !r.queued) await load();
  };
  const act = async (a: 'validate' | 'publish') => { const r = await api(`/schedules/${sch.id}/${a}`, { method: 'POST', body: {} }); setMsg(r.ok ? '' : `Refusé / Refused: ${r.error}`); await load(); };
  const subOf = (slotId: string) => subs.find((x) => x.slot_id === slotId);
  const draft = sch?.status === 'draft' && staff;

  return (
    <Shell>
      <h1>Emploi du temps / Timetable</h1>
      <p>
        <button onClick={() => setView('week')} aria-pressed={view === 'week'}>Semaine / Week</button>{' '}
        <button onClick={() => setView('month')} aria-pressed={view === 'month'}>Mois / Month</button>{' '}
        {view === 'month' && <input aria-label="mois" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}{' '}
        {staff && <select aria-label="classe" value={cls} onChange={(e) => { setCls(e.target.value); setMine(false); }}><option value="">Classe / Class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}{' '}
        <label><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mes cours (enseignant) / My lessons (teacher)</label>{' '}
        <button onClick={async () => { if (!(await openPdf(`/timetable.pdf?${query()}`))) setMsg('PDF indisponible / unavailable'); }}>PDF</button>
      </p>
      {sch && <p>Statut / Status : <strong>{sch.status}</strong> {draft && '(glisser-déposer actif / drag and drop enabled)'}</p>}
      {msg && <p role="alert" style={{ color: 'crimson' }}>{msg}</p>}
      {!sch && !msg && <p>Aucun emploi du temps publié / No published timetable.</p>}
      {view === 'week' && sch && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <caption className="sr-only">Emploi du temps hebdomadaire / Weekly timetable</caption>
          <thead><tr><th />{DAYS.map((d) => <th key={d} scope="col">J{d}</th>)}</tr></thead>
          <tbody>{PERIODS.map((p) => (
            <tr key={p}><th scope="row">P{p + 1}</th>{DAYS.map((d) => (
              <td key={d} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(d, p)} style={{ border: '1px solid var(--border)', height: 48, verticalAlign: 'top' }}>
                {slots.filter((s) => s.weekday === d && s.period_index === p).map((s) => {
                  const sb = subOf(s.id);
                  return (
                    <div key={s.id} draggable={draft} onDragStart={() => setDrag(s.id)} style={{ background: sb ? '#fed7aa' : '#dbeafe', padding: 2, cursor: draft ? 'grab' : 'default' }}>
                      <strong>{s.subject_name}</strong>{!cls && !mine ? null : ` · ${s.class_name}`}<br /><small>{sb ? `↔ ${sb.substitute_name} (${String(sb.on_date).slice(0, 10)})` : s.teacher_name}{s.room ? ` · ${s.room}` : ''}</small>
                    </div>);
                })}
              </td>))}</tr>))}</tbody>
        </table>)}
      {view === 'month' && (
        <ul>{days.map((d: any) => (
          <li key={d.date}><strong>{d.date}</strong> : {d.slots.length ? d.slots.map((s: any) => `P${s.period_index + 1} ${s.subject_name}${s.substitute_name ? ` (↔ ${s.substitute_name})` : ''}`).join(', ') : '—'}</li>))}</ul>)}
      {staff && sch && (
        <p>
          <button disabled={sch.status !== 'draft'} onClick={() => act('validate')}>Valider (direction) / Validate</button>{' '}
          <button disabled={sch.status !== 'validated'} onClick={() => act('publish')}>Publier / Publish</button>
        </p>)}
    </Shell>
  );
}
