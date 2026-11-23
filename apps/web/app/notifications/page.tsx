'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [prefs, setPrefs] = useState<any>(null);
  useEffect(() => { void (async () => { const r = await api('/me/notification-preferences'); if (r.ok) setPrefs(r.data); })(); }, []);
  const setPref = async (k: 'sms' | 'email', v: boolean) => { const r = await api('/me/notification-preferences', { method: 'PUT', online: true, body: { [k]: v } }); if (r.ok) setPrefs(r.data); };
  const load = async () => { const r = await api('/notifications'); setItems(r.data ?? []); };
  useEffect(() => { void load(); }, []);
  const read = async (id: string) => { await api(`/notifications/${id}/read`, { method: 'POST', body: {} }); await load(); };
  return (
    <Shell>
      <h1>Notifications</h1>
      {prefs && (
        <fieldset>
          <legend>Canaux supplémentaires / Extra channels</legend>
          <label><input type="checkbox" checked={prefs.sms} onChange={(e) => setPref('sms', e.target.checked)} /> SMS (absences, rappels) {!prefs.has_phone && '— aucun numéro / no number'}</label>{' '}
          <label><input type="checkbox" checked={prefs.email} onChange={(e) => setPref('email', e.target.checked)} /> E-mail {!prefs.has_email && '— aucune adresse / no address'}</label>
        </fieldset>
      )}
      <ul>{items.map((n) => <li key={n.id} style={{ fontWeight: n.read_at ? 'normal' : 'bold' }}>{n.title} — {n.body}{!n.read_at && <> <button onClick={() => read(n.id)}>Marquer lu</button></>}</li>)}</ul>
    </Shell>
  );
}
