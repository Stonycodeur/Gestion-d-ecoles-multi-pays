'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function NewsPage() {
  const [news, setNews] = useState<any[]>([]); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [audience, setAudience] = useState('all'); const [note, setNote] = useState('');
  const load = async () => { const r = await api('/news'); setNews(r.data ?? []); };
  useEffect(() => { void load(); }, []);
  const publish = async () => { const r = await api('/news', { method: 'POST', body: { title, body, audience } }); setNote(r.ok ? 'Publié' : r.status === 403 ? 'Réservé à la direction' : `Erreur : ${r.error}`); if (r.ok) { setTitle(''); setBody(''); await load(); } };
  return (
    <Shell>
      <h1>Actualités</h1>
      <section aria-label="publier">
        <input aria-label="titre" placeholder="Titre" value={title} onChange={(e) => setTitle(e.target.value)} />{' '}
        <input aria-label="texte" placeholder="Texte" value={body} onChange={(e) => setBody(e.target.value)} />{' '}
        <select aria-label="public" value={audience} onChange={(e) => setAudience(e.target.value)}><option value="all">Tous</option><option value="staff">Personnel</option><option value="students">Élèves</option><option value="guardians">Parents</option></select>{' '}
        <button disabled={!title || !body} onClick={publish}>Publier</button>
      </section>
      {note && <p role="status">{note}</p>}
      {news.map((n) => <article key={n.id}><h2>{n.title}</h2><p>{n.body}</p></article>)}
    </Shell>
  );
}
