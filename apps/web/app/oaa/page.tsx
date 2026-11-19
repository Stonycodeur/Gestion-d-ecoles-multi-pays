'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

const AXES = ['academic', 'physical', 'adaptability', 'social_contribution'];

export default function OaaPage() {
  const [classes, setClasses] = useState<any[]>([]); const [cls, setCls] = useState('');
  const [rows, setRows] = useState<any>(null); const [detail, setDetail] = useState<any>(null);
  const [penalties, setPenalties] = useState<any[]>([]); const [msg, setMsg] = useState('');
  useEffect(() => { api('/classes').then((r) => setClasses(r.data ?? [])); void loadPenalties(); }, []);
  useEffect(() => { if (cls) api(`/classes/${cls}/oaa`).then((r) => setRows(r.ok ? r.data : null)); }, [cls]);
  const loadPenalties = async () => { const r = await api('/oaa/penalties?status=proposed'); setPenalties(r.ok ? r.data : []); };
  const open = async (id: string) => { const r = await api(`/students/${id}/oaa`); setDetail(r.ok ? r.data : null); };
  const decide = async (id: string, decision: string) => {
    const r = await api(`/oaa/penalties/${id}/decision`, { method: 'POST', body: { decision } });
    setMsg(r.ok ? 'Décision enregistrée' : `Refusé : ${r.error}`); await loadPenalties();
  };
  return (
    <Shell>
      <h1>OAA — Académique · Physique · Adaptabilité · Contribution sociale</h1>
      <select aria-label="classe" value={cls} onChange={(e) => setCls(e.target.value)}>
        <option value="">Classe…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {rows && (
        <table>
          <caption>Score affiché dans l’échelle active (calcul interne normalisé 0–100)</caption>
          <thead><tr><th>Rang</th><th>Élève</th><th>Score</th><th>Alerte</th></tr></thead>
          <tbody>{rows.students.map((s: any) => (
            <tr key={s.student_id}><td>{s.rank ?? '–'}</td><td><button onClick={() => open(s.student_id)}>{s.name}</button></td>
              <td style={{ color: s.display?.color }}>{s.display?.text}</td><td>{s.alert}</td></tr>))}
          </tbody>
        </table>
      )}
      {detail && (
        <section aria-live="polite">
          <h2>{detail.display?.text} <small>{detail.display?.mention}</small></h2>
          <p>Seuils : avertissement {detail.thresholds?.warning?.in_scale} · pénalité {detail.thresholds?.penalty?.in_scale}</p>
          <ul>{AXES.map((a) => <li key={a}>{a} : {Math.round(detail.axes?.[a] ?? 0)}/100</li>)}</ul>
          <h3>Historique</h3>
          <ol>{(detail.history ?? []).map((h: any, i: number) => <li key={i}>{h.created_at?.slice(0, 10)} — {h.score100}/100 ({h.reason})</li>)}</ol>
        </section>
      )}
      <h2>Pénalités proposées</h2>
      <p>Aucune pénalité n’est appliquée automatiquement : la direction décide.</p>
      <ul>{penalties.map((p) => (
        <li key={p.id}>{p.student_name ?? p.student_id} — {p.reason}{' '}
          <button onClick={() => decide(p.id, 'applied')}>Appliquer</button>{' '}
          <button onClick={() => decide(p.id, 'dismissed')}>Écarter</button></li>))}
      </ul>
      <p role="status">{msg}</p>
    </Shell>
  );
}
