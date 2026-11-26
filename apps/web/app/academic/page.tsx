'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api, openPdf } from '../../lib/api';

const box = {} as const;   // card look comes from the global stylesheet (main section)
const err = (r: { ok: boolean; error?: string }) => (r.ok ? '' : `Refusé / Refused: ${r.error}`);

/** Competencies (primary), course units / ECTS transcripts (university), lesson attachments. */
export default function AcademicPage() {
  const [students, setStudents] = useState<any[]>([]);
  useEffect(() => { void (async () => { const r = await api('/me/students'); if (r.ok) setStudents(r.data); })(); }, []);
  return (
    <Shell>
      <h1>Compétences, UE et pièces jointes / Competencies, course units and attachments</h1>
      <Competencies students={students} /><Units students={students} /><Attachments />
    </Shell>
  );
}

function Competencies({ students }: { students: any[] }) {
  const [list, setList] = useState<any[]>([]); const [sid, setSid] = useState(''); const [rep, setRep] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const [period, setPeriod] = useState('T1'); const [f, setF] = useState({ subject_id: '', code: '', label: '' }); const [subjects, setSubjects] = useState<any[]>([]);
  const load = async () => { const r = await api('/competencies'); if (r.ok) setList(r.data); };
  useEffect(() => { void load(); void (async () => { const s = await api('/subjects'); if (s.ok) setSubjects(s.data); })(); }, []);
  useEffect(() => { if (!sid) return; void (async () => { const r = await api(`/students/${sid}/competencies?period=${period}`); setRep(r.ok ? (Array.isArray(r.data) ? r.data : r.data.items ?? []) : []); })(); }, [sid, period]);
  const add = async () => { const r = await api('/competencies', { method: 'POST', online: true, body: f }); setMsg(err(r) || 'Ajoutée / Added'); if (r.ok) await load(); };
  const assess = async (competency_id: string, level: string) => {
    const r = await api('/competency-assessments', { method: 'PUT', online: true, body: { period_code: period, entries: [{ student_id: sid, competency_id, level }] } });
    setMsg(err(r) || 'Évaluation enregistrée / Saved'); if (r.ok) { const x = await api(`/students/${sid}/competencies?period=${period}`); if (x.ok) setRep(Array.isArray(x.data) ? x.data : x.data.items ?? []); }
  };
  return (
    <section style={box} aria-labelledby="h-comp">
      <h2 id="h-comp">Compétences / Competencies</h2>
      <select aria-label="matière" value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">Matière / Subject</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
      <input aria-label="code" placeholder="code" size={8} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />{' '}
      <input aria-label="libellé" placeholder="libellé / label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />{' '}
      <button onClick={add} disabled={!f.subject_id || !f.code || !f.label}>Ajouter / Add</button>
      <h3>Évaluer un élève / Assess a student</h3>
      <input aria-label="période" size={4} value={period} onChange={(e) => setPeriod(e.target.value)} />{' '}
      <select aria-label="élève" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Élève / Student</option>{students.map((s) => <option key={s.id} value={s.id}>{s.last_name} {s.first_name}</option>)}</select>
      {sid && <table><thead><tr><th>Compétence</th><th>Niveau / Level</th></tr></thead><tbody>{list.map((c) => {
        const cur = rep.find((x: any) => x.competency_id === c.id)?.level ?? '';
        return <tr key={c.id}><td>{c.code} — {c.label}</td><td><select aria-label={`niveau ${c.code}`} value={cur} onChange={(e) => assess(c.id, e.target.value)}><option value="">—</option>{['not_acquired', 'in_progress', 'acquired', 'mastered'].map((l) => <option key={l}>{l}</option>)}</select></td></tr>;
      })}</tbody></table>}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}

function Units({ students }: { students: any[] }) {
  const [units, setUnits] = useState<any[]>([]); const [sid, setSid] = useState(''); const [tr, setTr] = useState<any>(null); const [msg, setMsg] = useState('');
  const [year, setYear] = useState('2025-2026'); const [f, setF] = useState({ code: '', title: '', credits: '3', semester: 'S1' }); const [val, setVal] = useState<Record<string, string>>({});
  const load = async () => { const r = await api('/course-units'); if (r.ok) setUnits(r.data); };
  useEffect(() => { void load(); }, []);
  const loadT = async (id: string) => { const r = await api(`/students/${id}/transcript?school_year=${year}`); setTr(r.ok ? r.data : null); };
  useEffect(() => { if (sid) void loadT(sid); }, [sid, year]);
  const add = async () => { const r = await api('/course-units', { method: 'POST', online: true, body: { ...f, credits: Number(f.credits) } }); setMsg(err(r) || 'UE créée / Unit created'); if (r.ok) await load(); };
  const save = async (unit_id: string) => { const r = await api('/unit-results', { method: 'PUT', online: true, body: { school_year: year, entries: [{ student_id: sid, unit_id, value: Number(val[unit_id]) }] } }); setMsg(err(r) || 'Résultat enregistré / Saved'); if (r.ok) await loadT(sid); };
  return (
    <section style={box} aria-labelledby="h-ue">
      <h2 id="h-ue">Unités d’enseignement et relevé ECTS / Course units and ECTS transcript</h2>
      <input aria-label="code UE" placeholder="code" size={8} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />{' '}
      <input aria-label="intitulé" placeholder="intitulé / title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />{' '}
      <input aria-label="crédits" type="number" min={1} max={60} size={3} value={f.credits} onChange={(e) => setF({ ...f, credits: e.target.value })} />{' '}
      <input aria-label="semestre" size={4} value={f.semester} onChange={(e) => setF({ ...f, semester: e.target.value })} />{' '}
      <button onClick={add} disabled={!f.code || !f.title}>Créer / Create</button>
      <p><input aria-label="année" size={10} value={year} onChange={(e) => setYear(e.target.value)} />{' '}<select aria-label="étudiant" value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Étudiant / Student</option>{students.map((s) => <option key={s.id} value={s.id}>{s.last_name} {s.first_name}</option>)}</select></p>
      {sid && <>
        <table><thead><tr><th>UE</th><th>Crédits</th><th>Note / Result</th></tr></thead><tbody>{units.map((u) => (
          <tr key={u.id}><td>{u.code} — {u.title}</td><td>{u.credits}</td><td><input aria-label={`note ${u.code}`} size={6} value={val[u.id] ?? ''} onChange={(e) => setVal({ ...val, [u.id]: e.target.value })} /> <button onClick={() => save(u.id)} disabled={val[u.id] === undefined || val[u.id] === ''}>OK</button></td></tr>))}</tbody></table>
        {tr && <><pre style={{ whiteSpace: 'pre-wrap' }}>{`${tr.credits_acquired}/${tr.credits_total} ECTS · ${tr.general?.text ?? '-'} ${tr.general?.mention ?? ''}\n` + tr.lines.map((l: any) => `${l.code} ${l.grade} ${l.validated ? '✔' : '✘'}`).join('\n')}</pre><button onClick={async () => { if (!(await openPdf(`/students/${sid}/transcript.pdf?school_year=${year}`))) setMsg('PDF indisponible / unavailable'); }}>Relevé PDF / Transcript PDF</button></>}
      </>}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}

function Attachments() {
  const [lessons, setLessons] = useState<any[]>([]); const [id, setId] = useState(''); const [msg, setMsg] = useState('');
  useEffect(() => { void (async () => { const r = await api('/lessons'); if (r.ok) setLessons(r.data); })(); }, []);
  const upload = async (file: File | undefined) => {
    if (!file || !id) return;
    if (file.size > 5 * 1024 * 1024) { setMsg('Fichier > 5 Mo / file > 5 MB'); return; }
    const buf = new Uint8Array(await file.arrayBuffer()); let bin = ''; buf.forEach((b) => { bin += String.fromCharCode(b); });
    const r = await api(`/lessons/${id}/attachments`, { method: 'POST', online: true, body: { filename: file.name, content_type: file.type || 'application/octet-stream', content_base64: btoa(bin) } });
    setMsg(err(r) || 'Pièce jointe ajoutée / Attached');
  };
  return (
    <section style={box} aria-labelledby="h-att">
      <h2 id="h-att">Pièces jointes du cahier de textes / Lesson attachments</h2>
      <select aria-label="séance" value={id} onChange={(e) => setId(e.target.value)}><option value="">Séance / Lesson</option>{lessons.map((l) => <option key={l.id} value={l.id}>{String(l.on_date ?? '').slice(0, 10)} · {l.title}</option>)}</select>{' '}
      <input aria-label="fichier" type="file" disabled={!id} onChange={(e) => upload(e.target.files?.[0])} />
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
