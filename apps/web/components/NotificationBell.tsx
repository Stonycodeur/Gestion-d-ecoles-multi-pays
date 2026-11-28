'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { api } from '../lib/api';
import { loadPrefs, playRing } from '../lib/prefs';
import { useLang } from '../lib/useLang';

interface Note { id: string; title: string; body: string | null; created_at: string; read_at: string | null }

/** Bell with an unread badge, a drop-down of the latest notifications, "mark all as read", and the person's ringtone for new ones. */
export default function NotificationBell({ active }: { active: boolean }) {
  const { t, fr } = useLang();
  const [items, setItems] = useState<Note[]>([]); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const last = useRef<number | null>(null);
  const unread = items.filter((n) => !n.read_at).length;
  const load = useCallback(async () => {
    if (!navigator.onLine) return;
    const r = await api<Note[]>('/notifications'); if (!r.ok || !Array.isArray(r.data)) return;
    setItems(r.data); const n = r.data.filter((x) => !x.read_at).length;
    if (last.current !== null && n > last.current) void playRing(loadPrefs().ringVolume);
    last.current = n;
  }, []);
  useEffect(() => { if (!active) { setItems([]); return; } void load(); const h = setInterval(load, 60_000); return () => clearInterval(h); }, [active, load]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  const readAll = async () => { await api('/notifications/read-all', { method: 'POST', body: {} }); setItems(items.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))); last.current = 0; };
  const readOne = async (n: Note) => { if (n.read_at) return; await api(`/notifications/${n.id}/read`, { method: 'POST', body: {} }); setItems(items.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))); };
  const when = (s: string) => new Date(s).toLocaleString(fr ? 'fr-FR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="usermenu" ref={ref}>
      <button type="button" className="iconbtn" aria-expanded={open} aria-controls="notif-pop" aria-label={`Notifications${unread ? ` (${unread})` : ''}`} onClick={() => { setOpen(!open); if (!open) void load(); }}>
        <Icon name="bell" />{unread > 0 && <span className="badge-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="menu-pop notif-pop" id="notif-pop" role="dialog" aria-label="Notifications">
          <div className="notif-head"><strong>Notifications</strong>
            <button type="button" className="btn-sec btn-ico" disabled={unread === 0} onClick={readAll}><Icon name="check" />{t('Tout marquer comme lu', 'Mark all as read')}</button></div>
          {items.length === 0 ? <div className="empty-state" style={{ border: 0 }}><Icon name="inbox" />{t('Aucune notification.', 'No notifications.')}</div> : (
            <ul className="notif-list">{items.slice(0, 30).map((n) => (
              <li key={n.id} className={n.read_at ? '' : 'unread'}>
                <button type="button" onClick={() => readOne(n)}><strong>{n.title}</strong>{n.body && <span>{n.body}</span>}<small>{when(n.created_at)}</small></button>
              </li>))}</ul>)}
          <Link href="/notifications" className="menu-item" onClick={() => setOpen(false)}>{t('Voir tout et régler les alertes', 'See all and set alerts')}</Link>
        </div>)}
    </div>
  );
}
