'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

const KEYS = ['history', 'values', 'facilities', 'faculty', 'programs', 'contact_info', 'tour360'];

export default function VisitorAdminPage() {
  const [apps, setApps] = useState<any[]>([]); const [contacts, setContacts] = useState<any[]>([]); const [classes, setClasses] = useState<any[]>([]); const [cls, setCls] = useState('');
  const [key, setKey] = useState('history'); const [value, setValue] = useState('{"text": ""}'); const [msg, setMsg] = useState('');
  const load = async () => { const a = await api('/visitor/applications'); if (a.ok) setApps(a.data); else setMsg(`Accès refusé : ${a.error}`); const c = await api('/visitor/contact'); if (c.ok) setContacts(c.data); const k = await api('/classes'); if (k.ok) setClasses(k.data); };
  useEffect(() => { void load(); }, []);
  const decide = async (id: string, accept: boolean) => { const r = await api(`/visitor/applications/${id}/decision`, { method: 'POST', body: { accept, class_id: cls || undefined }, online: true }); setMsg(r.ok ? (accept ? 'Élève créé (OAA et facture initialisés)' : 'Demande refusée') : `Refusé : ${r.error}`); await load(); };
  const save = async () => { let v: unknown; try { v = JSON.parse(value); } catch { setMsg('JSON invalide'); return; } const r = await api(`/visitor/site/${key}`, { method: 'PUT', body: { value: v }, online: true }); setMsg(r.ok ? 'Site mis à jour' : `Refusé : ${r.error}`); };
  return (
    <Shell>
      <h1>Espace visiteur — administration</h1><p role="status">{msg}</p>
      <h2>Demandes d’inscription</h2>
      <label>Classe d’affectation <select value={cls} onChange={(e) => setCls(e.target.value)}><option value="">(aucune)</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <ul>{apps.map((a) => <li key={a.id}>{a.first_name} {a.last_name} — {a.level_code} — {a.guardian_name} ({a.guardian_email ?? a.guardian_phone}) — <em>{a.status}</em>
        {a.status === 'pending' && <> <button onClick={() => decide(a.id, true)}>Accepter</button> <button onClick={() => decide(a.id, false)}>Refuser</button></>}</li>)}</ul>
      <h2>Messages de contact</h2>
      <ul>{contacts.map((c) => <li key={c.id}><strong>{c.subject}</strong> — {c.name} &lt;{c.email}&gt; : {c.body} {c.handled ? '✔' : <button onClick={async () => { await api(`/visitor/contact/${c.id}/handled`, { method: 'POST', body: {}, online: true }); await load(); }}>Traité</button>}</li>)}</ul>
      <h2>Contenu du site vitrine</h2>
      <label>Section <select value={key} onChange={(e) => setKey(e.target.value)}>{KEYS.map((k) => <option key={k}>{k}</option>)}</select></label><br />
      <label>Valeur (JSON ; <code>{'{"text": "…"}'}</code> ; tour360 : <code>{'{"scenes":[{"id","title","image_url"}]}'}</code>)<br /><textarea rows={6} cols={60} value={value} onChange={(e) => setValue(e.target.value)} /></label><br />
      <button onClick={save}>Enregistrer</button>
    </Shell>
  );
}
