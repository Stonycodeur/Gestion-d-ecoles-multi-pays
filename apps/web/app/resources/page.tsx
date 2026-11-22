'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function ResourcesPage() {
  const [q, setQ] = useState(''); const [items, setItems] = useState<any[]>([]); const [forums, setForums] = useState<any[]>([]); const [open, setOpen] = useState(''); const [posts, setPosts] = useState<any[]>([]);
  const [msg, setMsg] = useState(''); const [body, setBody] = useState(''); const [f, setF] = useState({ title: '', kind: 'link', url: '', subject_code: '', level_code: '', tags: '' }); const [fTitle, setFTitle] = useState('');
  const load = async () => { const r = await api(`/resources${q ? `?q=${encodeURIComponent(q)}` : ''}`); if (r.ok) setItems(r.data); else setMsg(`Module indisponible : ${r.error}`); const fo = await api('/forums'); if (fo.ok) setForums(fo.data); };
  useEffect(() => { void load(); }, []);
  const add = async () => { const r = await api('/resources', { method: 'POST', body: { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), shared: true }, online: true }); setMsg(r.ok ? 'Ressource ajoutée' : `Refusé : ${r.error}`); await load(); };
  const show = async (id: string) => { setOpen(id); const r = await api(`/forums/${id}/posts`); setPosts(r.ok ? r.data : []); };
  const post = async () => { const r = await api(`/forums/${open}/posts`, { method: 'POST', body: { body } }); setMsg(r.ok ? (r.queued ? 'Message en attente de connexion' : 'Publié') : `Refusé : ${r.error}`); setBody(''); await show(open); };
  return (
    <Shell>
      <h1>Ressources et forums</h1><p role="status">{msg}</p>
      <form role="search" onSubmit={(e) => { e.preventDefault(); void load(); }}><label>Recherche <input value={q} onChange={(e) => setQ(e.target.value)} /></label> <button type="submit">Chercher</button></form>
      <ul>{items.map((r) => <li key={r.id}><a href={r.url} rel="noopener noreferrer">{r.title}</a> [{r.kind}] {r.subject_code ?? ''} {r.level_code ?? ''} {r.tags?.map((t: string) => `#${t}`).join(' ')}<br />{r.description}</li>)}</ul>
      <fieldset><legend>Ajouter une ressource (enseignants)</legend>
        <input aria-label="titre" placeholder="Titre" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />{' '}
        <select aria-label="type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['link', 'pdf', 'video', 'file'].map((k) => <option key={k}>{k}</option>)}</select>{' '}
        <input aria-label="url" placeholder="https://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />{' '}
        <input aria-label="matière" placeholder="Matière" value={f.subject_code} onChange={(e) => setF({ ...f, subject_code: e.target.value })} />{' '}
        <input aria-label="niveau" placeholder="Niveau" value={f.level_code} onChange={(e) => setF({ ...f, level_code: e.target.value })} />{' '}
        <input aria-label="étiquettes" placeholder="étiquettes, séparées par des virgules" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />{' '}
        <button onClick={add} disabled={!f.title || !f.url}>Ajouter</button></fieldset>
      <h2>Forums</h2>
      <ul>{forums.map((fo) => <li key={fo.id}><button onClick={() => show(fo.id)}>{fo.title}</button></li>)}</ul>
      <fieldset><legend>Créer un forum (enseignants)</legend><input aria-label="titre du forum" value={fTitle} onChange={(e) => setFTitle(e.target.value)} /> <button onClick={async () => { const r = await api('/forums', { method: 'POST', body: { title: fTitle }, online: true }); setMsg(r.ok ? 'Forum créé' : `Refusé : ${r.error}`); setFTitle(''); await load(); }} disabled={!fTitle}>Créer</button></fieldset>
      {open && <section><ul>{posts.map((p) => <li key={p.id} style={{ marginLeft: p.parent_id ? 24 : 0 }}><strong>{p.author_name}</strong> : {p.body}</li>)}</ul>
        <label>Message <input value={body} onChange={(e) => setBody(e.target.value)} /></label> <button onClick={post} disabled={!body}>Publier</button></section>}
    </Shell>
  );
}
