'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

/** Ministry transmissions: prepare → preview → direction validates (checksum) → send → exchange log. Every step is a human decision. */
export default function MinistryPage() {
  const [conn, setConn] = useState<any[]>([]); const [mode, setMode] = useState(''); const [list, setList] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ connector: '', dataset: '', format: '', school_year: '' }); const [sel, setSel] = useState<any>(null); const [insp, setInsp] = useState<any[]>([]);
  const [i, setI] = useState({ user_id: '', display_name: '', expires_at: '' });
  const load = async () => {
    const c = await api('/ministry/connectors'); if (c.ok) { setConn(c.data.connectors); setMode(c.data.mode); } else setMsg(`Accès refusé ou module inactif : ${c.error}`);
    const l = await api('/ministry/transmissions'); if (l.ok) setList(l.data);
    const n = await api('/ministry/inspectors'); if (n.ok) setInsp(n.data);
  };
  useEffect(() => { void load(); }, []);
  const cur = conn.find((c) => c.code === f.connector);
  const act = async (path: string, body?: unknown) => { const r = await api(path, { method: 'POST', body, online: true }); setMsg(r.ok ? 'Fait' : `Refusé : ${r.error}`); await load(); if (sel) await open(sel.id); return r; };
  const open = async (id: string) => { const r = await api(`/ministry/transmissions/${id}`); const p = await api(`/ministry/transmissions/${id}/preview`); if (r.ok) setSel({ ...r.data, preview: p.ok ? p.data : null }); };
  return (
    <Shell>
      <h1>Transmissions aux ministères</h1><p role="status">{msg}</p>
      <p>Mode : <strong>{mode === 'live' ? 'production' : 'simulé (sandbox)'}</strong>. Aucune transmission n’est envoyée sans validation de la direction.</p>
      <fieldset><legend>Préparer une transmission</legend>
        <label>Connecteur <select value={f.connector} onChange={(e) => setF({ ...f, connector: e.target.value, dataset: '', format: '' })}><option value="">—</option>{conn.map((c) => <option key={c.code} value={c.code}>{c.label_fr}</option>)}</select></label>{' '}
        <label>Jeu de données <select value={f.dataset} onChange={(e) => setF({ ...f, dataset: e.target.value })}><option value="">—</option>{cur?.datasets?.map((d: string) => <option key={d}>{d}</option>)}</select></label>{' '}
        <label>Format <select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}><option value="">—</option>{cur?.formats?.map((d: string) => <option key={d}>{d}</option>)}</select></label>{' '}
        <label>Année scolaire <input placeholder="2026-2027" value={f.school_year} onChange={(e) => setF({ ...f, school_year: e.target.value })} /></label>{' '}
        <button disabled={!f.connector || !f.dataset || !f.format || !f.school_year} onClick={() => act('/ministry/transmissions', f)}>Préparer</button></fieldset>
      <table><caption>Historique</caption><thead><tr><th>Jeu</th><th>Année</th><th>Format</th><th>Lignes</th><th>Statut</th><th></th></tr></thead>
        <tbody>{list.map((t) => <tr key={t.id}><td>{t.dataset}</td><td>{t.school_year}</td><td>{t.format}</td><td>{t.rows_count}</td><td>{t.status}</td><td><button onClick={() => open(t.id)}>Ouvrir</button></td></tr>)}</tbody></table>
      {sel && <section aria-label="détail"><h2>{sel.dataset} — {sel.status}</h2>
        <p>Empreinte SHA-256 : <code>{sel.checksum}</code></p>
        {sel.preview && <pre style={{ maxHeight: 200, overflow: 'auto' }}>{sel.preview.payload}</pre>}
        <p>
          {sel.status === 'prepared' && <><button onClick={() => act(`/ministry/transmissions/${sel.id}/validate`, { approve: true, checksum: sel.checksum })}>Valider (direction)</button>{' '}<button onClick={() => act(`/ministry/transmissions/${sel.id}/validate`, { approve: false, checksum: sel.checksum })}>Rejeter</button>{' '}</>}
          {['validated', 'failed'].includes(sel.status) && <button onClick={() => act(`/ministry/transmissions/${sel.id}/send`)}>Envoyer</button>}{' '}
          {['prepared', 'validated', 'failed'].includes(sel.status) && <button onClick={() => act(`/ministry/transmissions/${sel.id}/cancel`)}>Annuler</button>}
        </p>
        <h3>Journal des échanges</h3><ul>{sel.logs?.map((l: any, k: number) => <li key={k}>{new Date(l.at).toLocaleString()} — {l.event} {l.detail ? `: ${typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail)}` : ''}</li>)}</ul></section>}
      <h2>Comptes d’inspecteurs (durée limitée, 90 jours max)</h2>
      <ul>{insp.map((x) => <li key={x.id}>{x.display_name} — jusqu’au {new Date(x.expires_at).toLocaleDateString()} {x.revoked ? '(révoqué)' : <button onClick={() => act(`/ministry/inspectors/${x.id}/revoke`)}>Révoquer</button>}</li>)}</ul>
      <fieldset><legend>Créer un compte d’inspecteur</legend>
        <input aria-label="identifiant utilisateur" placeholder="Identifiant (UUID)" value={i.user_id} onChange={(e) => setI({ ...i, user_id: e.target.value })} />{' '}
        <input aria-label="nom" placeholder="Nom" value={i.display_name} onChange={(e) => setI({ ...i, display_name: e.target.value })} />{' '}
        <label>Expire le <input type="date" value={i.expires_at.slice(0, 10)} onChange={(e) => setI({ ...i, expires_at: e.target.value ? new Date(`${e.target.value}T23:59:00`).toISOString() : '' })} /></label>{' '}
        <button disabled={!i.user_id || !i.display_name || !i.expires_at} onClick={() => act('/ministry/inspectors', i)}>Créer</button></fieldset>
    </Shell>
  );
}
