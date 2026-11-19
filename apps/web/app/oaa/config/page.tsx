'use client';
import { useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import { api } from '../../../lib/api';

export default function OaaConfigPage() {
  const [cfg, setCfg] = useState<any>(null); const [msg, setMsg] = useState('');
  useEffect(() => { api('/oaa/config').then((r) => setCfg(r.ok ? r.data : null)); }, []);
  if (!cfg) return <Shell><h1>Configuration OAA</h1><p>Chargement…</p></Shell>;
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const save = async () => {
    const body = { ranking_enabled: cfg.ranking_enabled, thresholds: cfg.thresholds, weights: cfg.weights, initial_value: cfg.initial_value, feed_weights: cfg.feed_weights };
    const r = await api('/oaa/config', { method: 'PUT', body }); setMsg(r.ok ? 'Configuration enregistrée' : `Refusé : ${r.error}`);
  };
  const th = cfg.thresholds ?? { warning: 50, penalty: 40 };
  return (
    <Shell>
      <h1>Configuration OAA</h1>
      <p>Les seuils sont des pourcentages du maximum de l’échelle (50 % = 10/20 ou 5/10).</p>
      <label>Avertissement (%) <input type="number" min={0} max={100} value={th.warning} onChange={(e) => setCfg({ ...cfg, thresholds: { ...th, warning: num(e.target.value) } })} /></label>{' '}
      <label>Pénalité (%) <input type="number" min={0} max={100} value={th.penalty} onChange={(e) => setCfg({ ...cfg, thresholds: { ...th, penalty: num(e.target.value) } })} /></label>
      <h2>Pondérations des axes</h2>
      {Object.entries(cfg.weights ?? {}).map(([k, v]) => (
        <label key={k} style={{ display: 'block' }}>{k} <input type="number" step="0.1" min={0} value={v as number} onChange={(e) => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: num(e.target.value) } })} /></label>))}
      <label style={{ display: 'block' }}><input type="checkbox" checked={!!cfg.ranking_enabled} onChange={(e) => setCfg({ ...cfg, ranking_enabled: e.target.checked })} /> Classement visible</label>
      <button onClick={save}>Enregistrer</button> <span role="status">{msg}</span>
    </Shell>
  );
}
