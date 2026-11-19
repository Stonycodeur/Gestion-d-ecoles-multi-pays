'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function RiskPage() {
  const [dash, setDash] = useState<any>(null); const [detail, setDetail] = useState<any>(null); const [msg, setMsg] = useState('');
  const load = async () => { const r = await api('/predictive/dashboard'); if (r.ok) setDash(r.data); else setMsg(r.error ?? 'error'); };
  useEffect(() => { void load(); }, []);
  const run = async () => { const r = await api('/predictive/run', { method: 'POST', body: {} }); setMsg(r.ok ? `${r.data.scored} élève(s) analysé(s)` : `Refusé : ${r.error}`); await load(); };
  const open = async (id: string) => { const r = await api(`/predictive/students/${id}`); setDetail(r.ok ? r.data : null); };
  return (
    <Shell>
      <h1>Risque de décrochage et d’échec</h1>
      <p><strong>Aide à la décision uniquement.</strong> Aucune décision n’est prise automatiquement ; les données de paiement sont exclues.</p>
      <button onClick={run}>Recalculer</button> <span role="status">{msg}</span>
      {dash && <>
        <p>Élevé : {dash.counts?.high ?? 0} · Moyen : {dash.counts?.medium ?? 0} · Faible : {dash.counts?.low ?? 0}</p>
        <ul>{(dash.high_risk ?? []).map((s: any) => <li key={s.student_id}><button onClick={() => open(s.student_id)}>{s.name}</button> — {Math.round((s.probability ?? 0) * 100)} %</li>)}</ul>
      </>}
      {detail && <section>
        <h2>Facteurs explicatifs</h2>
        <ul>{detail.latest?.factors?.map((f: any) => <li key={f.feature}>{f.label ?? f.feature} : {f.contribution > 0 ? '▲ augmente' : '▼ réduit'} le risque</li>)}</ul>
        <h3>Pistes d’accompagnement</h3>
        <ul>{detail.recommendations?.map((r: string) => <li key={r}>{r}</li>)}</ul>
        <p>{detail.notice}</p>
      </section>}
    </Shell>
  );
}
