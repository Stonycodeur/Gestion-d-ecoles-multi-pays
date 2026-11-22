'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

const SCOPES = ['students:read', 'classes:read', 'news:read', 'grades:read'];
const EVENTS = ['student.created', 'news.published', 'payment.confirmed'];

export default function IntegrationsPage() {
  const [clients, setClients] = useState<any[]>([]); const [hooks, setHooks] = useState<any[]>([]); const [dl, setDl] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [secret, setSecret] = useState('');
  const [c, setC] = useState({ name: '', scopes: [] as string[], quota_per_hour: 1000 }); const [h, setH] = useState({ url: '', events: [] as string[] });
  const load = async () => {
    const a = await api('/api-admin/clients'); if (a.ok) setClients(a.data); else setMsg(`Accès refusé : ${a.error}`);
    const b = await api('/api-admin/webhooks'); if (b.ok) setHooks(b.data);
    const d = await api('/api-admin/deliveries'); if (d.ok) setDl(d.data);
  };
  useEffect(() => { void load(); }, []);
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const post = async (path: string, body?: unknown, show?: string) => { const r = await api(path, { method: 'POST', body, online: true }); if (r.ok) { setMsg('Fait'); if (show && r.data?.[show]) setSecret(r.data[show]); } else setMsg(`Refusé : ${r.error}`); await load(); };
  return (
    <Shell>
      <h1>API et webhooks</h1><p role="status">{msg}</p>
      {secret && <p role="alert">Secret affiché une seule fois : <code>{secret}</code> <button onClick={() => setSecret('')}>J’ai noté le secret</button></p>}
      <h2>Clients OAuth2</h2>
      <table><thead><tr><th>Nom</th><th>client_id</th><th>Portées</th><th>Quota/h</th><th>Statut</th><th></th></tr></thead><tbody>
        {clients.map((x) => <tr key={x.id}><td>{x.name}</td><td><code>{x.client_id}</code></td><td>{x.scopes.join(' ')}</td><td>{x.quota_per_hour}</td><td>{x.active ? 'actif' : 'révoqué'}</td><td>{x.active && <button onClick={() => post(`/api-admin/clients/${x.id}/revoke`)}>Révoquer</button>}</td></tr>)}</tbody></table>
      <fieldset><legend>Nouveau client</legend>
        <input aria-label="nom du client" placeholder="Nom" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />{' '}
        {SCOPES.map((s) => <label key={s}><input type="checkbox" checked={c.scopes.includes(s)} onChange={() => setC({ ...c, scopes: toggle(c.scopes, s) })} /> {s} </label>)}
        <label>Quota/heure <input type="number" min={1} value={c.quota_per_hour} onChange={(e) => setC({ ...c, quota_per_hour: Number(e.target.value) })} /></label>{' '}
        <button disabled={!c.name || !c.scopes.length} onClick={() => post('/api-admin/clients', c, 'client_secret')}>Créer</button></fieldset>
      <h2>Webhooks sortants (signés HMAC-SHA256)</h2>
      <ul>{hooks.map((x) => <li key={x.id}>{x.url} — {x.events.join(', ')} <button onClick={() => post(`/api-admin/webhooks/${x.id}/test`)}>Tester</button>{' '}<button onClick={async () => { await api(`/api-admin/webhooks/${x.id}`, { method: 'DELETE', online: true }); await load(); }}>Supprimer</button></li>)}</ul>
      <fieldset><legend>Nouveau webhook</legend>
        <input aria-label="url" placeholder="https://…" value={h.url} onChange={(e) => setH({ ...h, url: e.target.value })} />{' '}
        {EVENTS.map((s) => <label key={s}><input type="checkbox" checked={h.events.includes(s)} onChange={() => setH({ ...h, events: toggle(h.events, s) })} /> {s} </label>)}
        <button disabled={!h.url || !h.events.length} onClick={() => post('/api-admin/webhooks', h, 'secret')}>Créer</button></fieldset>
      <h2>Livraisons <button onClick={() => post('/api-admin/deliveries/retry')}>Relancer les échecs</button></h2>
      <table><thead><tr><th>Événement</th><th>Statut</th><th>Tentatives</th><th>Erreur</th></tr></thead><tbody>{dl.map((d) => <tr key={d.id}><td>{d.event}</td><td>{d.status}</td><td>{d.attempts}</td><td>{d.last_error ?? ''}</td></tr>)}</tbody></table>
      <p>Documentation pour les développeurs : <a href="/developers">/developers</a></p>
    </Shell>
  );
}
