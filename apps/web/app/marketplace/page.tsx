'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

/** Module marketplace: permissions are displayed and must be accepted before installation; updates only ask for added permissions. */
export default function MarketplacePage() {
  const [mods, setMods] = useState<any[]>([]); const [sel, setSel] = useState<any>(null); const [accept, setAccept] = useState<string[]>([]); const [msg, setMsg] = useState('');
  const [rate, setRate] = useState({ rating: 5, comment: '' }); const [subs, setSubs] = useState<any[]>([]); const [sub, setSub] = useState({ manifest: '', handlers: '' });
  const load = async () => { const r = await api('/marketplace/modules'); if (r.ok) setMods(r.data); else setMsg(`Accès refusé : ${r.error}`); const s = await api('/marketplace/submissions'); if (s.ok) setSubs(s.data); };
  useEffect(() => { void load(); }, []);
  const open = async (n: string) => { const r = await api(`/marketplace/modules/${n}`); if (r.ok) { setSel(r.data); setAccept([]); } };
  const act = async (path: string, body?: unknown) => { const r = await api(path, { method: 'POST', body, online: true }); setMsg(r.ok ? 'Fait' : `Refusé : ${r.error}`); await load(); if (sel) await open(sel.name); };
  const perms: string[] = sel?.permissions_to_accept ?? [];
  const submit = async () => { try { await act('/marketplace/submissions', { manifest: JSON.parse(sub.manifest), handlers_source: JSON.parse(sub.handlers || '{}') }); } catch { setMsg('JSON invalide'); } };
  return (
    <Shell>
      <h1>Marketplace de modules</h1><p role="status">{msg}</p>
      <ul>{mods.map((m) => <li key={m.name}><button onClick={() => open(m.name)}>{m.name}</button> v{m.version} — {m.description} {m.installed ? '(installé)' : ''} {m.rating ? `★ ${m.rating} (${m.reviews})` : ''} {m.update_available ? '— mise à jour disponible' : ''} <em>risque : {m.risk}</em></li>)}</ul>
      {sel && <section aria-label="détail du module"><h2>{sel.name} v{sel.version}</h2><p>{sel.manifest?.description}</p>{sel.findings?.length > 0 && <ul aria-label="constats de la revue">{sel.findings.map((f: any, k: number) => <li key={k}>{typeof f === 'string' ? f : JSON.stringify(f)}</li>)}</ul>}<p>Note moyenne : {sel.summary?.average ?? '—'} ({sel.summary?.count ?? 0} avis)</p>
        <h3>Permissions demandées</h3>
        <ul>{perms.map((p) => <li key={p}><label><input type="checkbox" checked={accept.includes(p)} onChange={() => setAccept(accept.includes(p) ? accept.filter((x) => x !== p) : [...accept, p])} /> {p}</label></li>)}</ul>
        <p>
          <button disabled={accept.length < perms.length} onClick={() => act(`/marketplace/modules/${sel.name}/install`, { accept_permissions: accept })}>Installer</button>{' '}
          <button onClick={() => act(`/marketplace/modules/${sel.name}/update`, { accept_permissions: accept })}>Mettre à jour</button>{' '}
          <button onClick={() => act(`/marketplace/modules/${sel.name}/uninstall`)}>Désinstaller</button></p>
        <fieldset><legend>Avis</legend><label>Note <input type="number" min={1} max={5} value={rate.rating} onChange={(e) => setRate({ ...rate, rating: Number(e.target.value) })} /></label>{' '}
          <input aria-label="commentaire" value={rate.comment} onChange={(e) => setRate({ ...rate, comment: e.target.value })} />{' '}
          <button onClick={() => act(`/marketplace/modules/${sel.name}/reviews`, rate)}>Publier</button></fieldset></section>}
      <h2>Soumettre un module</h2>
      <p>Le manifeste est vérifié automatiquement ; la publication est décidée par l’administrateur racine.</p>
      <label>Manifeste (JSON)<textarea rows={6} style={{ width: '100%' }} value={sub.manifest} onChange={(e) => setSub({ ...sub, manifest: e.target.value })} /></label>
      <label>Gestionnaires (JSON {'{"hook":"code"}'})<textarea rows={4} style={{ width: '100%' }} value={sub.handlers} onChange={(e) => setSub({ ...sub, handlers: e.target.value })} /></label>
      <button disabled={!sub.manifest} onClick={submit}>Soumettre</button>
      {subs.length > 0 && <><h2>Revue (administrateur racine)</h2><ul>{subs.map((s) => <li key={s.id}>{s.module_name} v{s.version} — {s.status} {['submitted', 'manual_review'].includes(s.status) && <><button onClick={() => act(`/marketplace/submissions/${s.id}/decision`, { approve: true, note: 'revue manuelle' })}>Approuver</button>{' '}<button onClick={() => act(`/marketplace/submissions/${s.id}/decision`, { approve: false, note: 'refusé' })}>Refuser</button></>}</li>)}</ul></>}
    </Shell>
  );
}
