'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

const box = {} as const;   // card look comes from the global stylesheet (main section)
const err = (r: { ok: boolean; error?: string }) => (r.ok ? '' : `Refusé / Refused: ${r.error}`);

/** School administration: grading scale (7.3), staff contracts and workload (6.4), teacher substitution (6.5), schools (6.2, root only). */
export default function AdministrationPage() {
  return (
    <Shell>
      <h1>Administration</h1>
      <Grading /><Staff /><Substitutions /><Schools />
    </Shell>
  );
}

function Grading() {
  const [g, setG] = useState<any>(null); const [code, setCode] = useState(''); const [from, setFrom] = useState(''); const [msg, setMsg] = useState('');
  const [bands, setBands] = useState('');
  const load = async () => { const r = await api('/settings/grading'); if (r.ok) { setG(r.data); setCode(r.data.active.code); setBands(JSON.stringify(r.data.color_bands)); } else setMsg(err(r)); };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    let color_bands: unknown = undefined;
    try { color_bands = bands ? JSON.parse(bands) : undefined; } catch { setMsg('Couleurs : JSON invalide / invalid JSON'); return; }
    const r = await api('/settings/grading', { method: 'PUT', online: true, body: { grading_scale_code: code, effective_from: from || undefined, color_bands } });
    setMsg(err(r) || 'Enregistré / Saved'); if (r.ok) setG(r.data);
  };
  return (
    <section style={box} aria-labelledby="h-grading">
      <h2 id="h-grading">Échelle de notation / Grading scale</h2>
      {g && <>
        <p>Active : <strong>{g.active.code}</strong> ({g.active.min}–{g.active.max}, pas/step {g.active.step}, passage/pass {g.active.passMark}). Défaut du pays / country default : {g.country_default}.</p>
        <p>Seuils / thresholds : alerte/warning {g.thresholds.warning_pct} % = {(g.active.max - g.active.min) * g.thresholds.warning_pct / 100 + g.active.min}, pénalité/penalty {g.thresholds.penalty_pct} % = {(g.active.max - g.active.min) * g.thresholds.penalty_pct / 100 + g.active.min}</p>
        <label>Échelle / Scale <select value={code} onChange={(e) => setCode(e.target.value)}>{g.available.map((s: any) => <option key={s.code} value={s.code}>{s.code} ({s.type}, {s.min_value}–{s.max_value})</option>)}</select></label>{' '}
        <label>À partir du / From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <p><label>Couleurs / Colours (JSON) <br /><textarea rows={3} cols={80} value={bands} onChange={(e) => setBands(e.target.value)} /></label></p>
        <button onClick={save}>Appliquer / Apply</button>
        <p><small>Les notes déjà saisies gardent leur échelle d’origine. / Grades already entered keep their original scale.</small></p>
      </>}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}

function Staff() {
  const [rows, setRows] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ teacher_id: '', kind: 'CDI', start_date: '', end_date: '', weekly_hours: '' });
  const load = async () => { const r = await api('/staff/workload'); if (r.ok) setRows(r.data); else setMsg(err(r)); };
  useEffect(() => { void load(); }, []);
  const add = async () => {
    const r = await api('/staff/contracts', { method: 'POST', online: true, body: { ...f, end_date: f.end_date || undefined, weekly_hours: f.weekly_hours ? Number(f.weekly_hours) : undefined } });
    setMsg(err(r) || 'Contrat enregistré / Contract saved'); if (r.ok) await load();
  };
  return (
    <section style={box} aria-labelledby="h-staff">
      <h2 id="h-staff">Personnel : charge horaire et contrats / Staff workload and contracts</h2>
      <table><thead><tr><th>Enseignant</th><th>Affectées</th><th>Plafond</th><th>Contrat</th><th /></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.teacher_id}><td>{r.last_name} {r.first_name}</td><td>{r.assigned_hours} h</td><td>{r.limit_hours} h</td><td>{r.contract_hours ?? '-'}</td><td>{r.overloaded && <strong role="alert" style={{ color: 'crimson' }}>Surcharge / Overloaded</strong>}</td></tr>)}</tbody></table>
      <h3>Nouveau contrat / New contract</h3>
      <select aria-label="enseignant" value={f.teacher_id} onChange={(e) => setF({ ...f, teacher_id: e.target.value })}><option value="">—</option>{rows.map((r) => <option key={r.teacher_id} value={r.teacher_id}>{r.last_name} {r.first_name}</option>)}</select>{' '}
      <input aria-label="type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} size={6} />{' '}
      <input aria-label="début" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />{' '}
      <input aria-label="fin" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />{' '}
      <input aria-label="heures hebdo" placeholder="h/sem" size={5} value={f.weekly_hours} onChange={(e) => setF({ ...f, weekly_hours: e.target.value })} />{' '}
      <button onClick={add} disabled={!f.teacher_id || !f.start_date}>Ajouter / Add</button>
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}

function Substitutions() {
  const [classes, setClasses] = useState<any[]>([]); const [cls, setCls] = useState(''); const [slots, setSlots] = useState<any[]>([]); const [teachers, setTeachers] = useState<any[]>([]);
  const [list, setList] = useState<any[]>([]); const [f, setF] = useState({ slot_id: '', on_date: '', substitute_teacher_id: '', note: '' }); const [msg, setMsg] = useState('');
  const loadList = async () => { const r = await api('/substitutions'); if (r.ok) setList(r.data); };
  useEffect(() => { void (async () => {
    const c = await api('/classes'); if (c.ok) setClasses(c.data);
    const t = await api('/staff/workload'); if (t.ok) setTeachers(t.data);
    await loadList();
  })(); }, []);
  useEffect(() => { if (!cls) return; void (async () => { const r = await api(`/timetable?class_id=${cls}`); if (r.ok) setSlots(r.data.slots); })(); }, [cls]);
  const add = async () => { const r = await api('/substitutions', { method: 'POST', online: true, body: { ...f, note: f.note || undefined } }); setMsg(err(r) || 'Remplacement enregistré, familles notifiées / Saved, families notified'); if (r.ok) await loadList(); };
  const del = async (id: string) => { const r = await api(`/substitutions/${id}`, { method: 'DELETE', online: true }); setMsg(err(r)); await loadList(); };
  return (
    <section style={box} aria-labelledby="h-sub">
      <h2 id="h-sub">Remplacement de professeur / Teacher substitution</h2>
      <select aria-label="classe" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Classe / Class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{' '}
      <select aria-label="créneau" value={f.slot_id} onChange={(e) => setF({ ...f, slot_id: e.target.value })}><option value="">Créneau / Slot</option>{slots.map((s) => <option key={s.id} value={s.id}>J{s.weekday} P{s.period_index + 1} {s.subject_name} ({s.teacher_name})</option>)}</select>{' '}
      <input aria-label="date" type="date" value={f.on_date} onChange={(e) => setF({ ...f, on_date: e.target.value })} />{' '}
      <select aria-label="remplaçant" value={f.substitute_teacher_id} onChange={(e) => setF({ ...f, substitute_teacher_id: e.target.value })}><option value="">Remplaçant / Substitute</option>{teachers.map((t) => <option key={t.teacher_id} value={t.teacher_id}>{t.last_name} {t.first_name}</option>)}</select>{' '}
      <input aria-label="note" placeholder="note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />{' '}
      <button onClick={add} disabled={!f.slot_id || !f.on_date || !f.substitute_teacher_id}>Remplacer / Replace</button>
      {msg && <p role="status">{msg}</p>}
      <ul>{list.map((s) => <li key={s.id}>{String(s.on_date).slice(0, 10)} · P{s.period_index + 1} · {s.original_last_name} → {s.substitute_last_name} <button onClick={() => del(s.id)} aria-label="annuler">✕</button></li>)}</ul>
    </section>
  );
}

function Schools() {
  const [isRoot, setIsRoot] = useState(false);
  useEffect(() => { void api('/tenants').then((r) => setIsRoot(r.ok)); }, []);
  if (!isRoot) return null;   // visible to the root super-admin only
  return (
    <section style={box} aria-labelledby="h-schools">
      <h2 id="h-schools">Établissements / Schools</h2>
      <p>La création des écoles (continent, pays, province, ville), des comptes et l’audit se font dans la console racine. / Schools, accounts and audit live in the root console.</p>
      <p><Link href="/root">Ouvrir la console racine / Open the root console →</Link></p>
    </section>
  );
}
