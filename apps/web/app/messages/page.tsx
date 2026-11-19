'use client';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import Shell from '../../components/Shell';
import { API_BASE, api, getSession } from '../../lib/api';

export default function MessagesPage() {
  const [threads, setThreads] = useState<any[]>([]); const [open, setOpen] = useState<string>(''); const [msgs, setMsgs] = useState<any[]>([]);
  const [dir, setDir] = useState<any[]>([]); const [to, setTo] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [note, setNote] = useState('');
  const loadThreads = async () => { const r = await api('/threads'); setThreads(r.data ?? []); };
  const loadThread = async (id: string) => { setOpen(id); const r = await api(`/threads/${id}`); setMsgs(r.data ?? []); };
  useEffect(() => {
    void loadThreads(); api('/directory').then((r) => setDir(r.data ?? []));
    const s = getSession(); if (!s) return;
    const sock = io(API_BASE, { auth: { token: s.token } });   // realtime: new messages appear without refresh
    sock.on('message', () => { void loadThreads(); });
    return () => { sock.close(); };
  }, []);
  useEffect(() => { if (open) { const s = getSession(); if (!s) return; const sock = io(API_BASE, { auth: { token: s.token } }); sock.on('message', (m: any) => { if (m.thread_id === open) void loadThread(open); }); return () => { sock.close(); }; } }, [open]);
  const create = async () => {
    const r = await api('/threads', { method: 'POST', body: { subject, member_ids: [to], body } });
    setNote(r.ok ? (r.queued ? 'Hors ligne : mis en file' : 'Envoyé') : `Refusé : ${r.error}`); if (r.ok && !r.queued) { setBody(''); await loadThreads(); }
  };
  const reply = async () => { const r = await api(`/threads/${open}/messages`, { method: 'POST', body: { body } }); setNote(r.ok ? '' : `Refusé : ${r.error}`); setBody(''); if (r.ok && !r.queued) await loadThread(open); };
  return (
    <Shell>
      <h1>Messages</h1>
      <section aria-label="nouvelle conversation">
        <select aria-label="destinataire" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Destinataire…</option>{dir.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name} ({d.role})</option>)}</select>{' '}
        <input aria-label="objet" placeholder="Objet" value={subject} onChange={(e) => setSubject(e.target.value)} />{' '}
        <input aria-label="message" placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} />{' '}
        <button disabled={!to || !subject || !body} onClick={create}>Créer</button>
      </section>
      {note && <p role="status">{note}</p>}
      <ul>{threads.map((t) => <li key={t.id}><button onClick={() => loadThread(t.id)}>{t.subject}{t.unread > 0 ? ` (${t.unread})` : ''}</button></li>)}</ul>
      {open && <section aria-label="conversation"><ul>{msgs.map((m) => <li key={m.id}>{m.body}</li>)}</ul>
        <input aria-label="réponse" value={body} onChange={(e) => setBody(e.target.value)} /> <button disabled={!body} onClick={reply}>Répondre</button></section>}
    </Shell>
  );
}
