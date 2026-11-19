'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const load = async () => { const r = await api('/notifications'); setItems(r.data ?? []); };
  useEffect(() => { void load(); }, []);
  const read = async (id: string) => { await api(`/notifications/${id}/read`, { method: 'POST', body: {} }); await load(); };
  return (
    <Shell>
      <h1>Notifications</h1>
      <ul>{items.map((n) => <li key={n.id} style={{ fontWeight: n.read_at ? 'normal' : 'bold' }}>{n.title} — {n.body}{!n.read_at && <> <button onClick={() => read(n.id)}>Marquer lu</button></>}</li>)}</ul>
    </Shell>
  );
}
