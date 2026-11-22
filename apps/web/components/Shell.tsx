'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { getSession, setSession, replayQueue } from '../lib/api';
import { getLocale, setLocale, t, type Locale } from '../lib/i18n';
import { pendingOps } from '../lib/offline-queue';

export default function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [locale, setL] = useState<Locale>('fr');
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    setL(getLocale()); setLocale(getLocale());
    if (!getSession()) router.replace('/login');
    const up = async () => { setOnline(true); await replayQueue(); setPending(pendingOps().length); };
    const down = () => setOnline(false);
    setOnline(navigator.onLine); setPending(pendingOps().length);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [router]);
  const pick = (l: Locale) => { setLocale(l); setL(l); };
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{t('app', locale)}</strong>
        <nav aria-label="principal" style={{ display: 'flex', gap: 12 }}>
          <Link href="/">{t('modules', locale)}</Link><Link href="/timetable">{t('timetable', locale)}</Link><Link href="/grades">{t('grades', locale)}</Link>
          <Link href="/absences">{t('absences', locale)}</Link><Link href="/lessons">{t('lessons', locale)}</Link><Link href="/messages">{locale === 'fr' ? 'Messages' : 'Messages'}</Link><Link href="/news">{locale === 'fr' ? 'Actualités' : 'News'}</Link><Link href="/notifications">Notifications</Link><Link href="/oaa">OAA</Link><Link href="/payments">{locale === 'fr' ? 'Paiements' : 'Payments'}</Link><Link href="/gps">GPS</Link><Link href="/play">{locale === 'fr' ? 'Jeux' : 'Games'}</Link><Link href="/risk">{locale === 'fr' ? 'Risque' : 'Risk'}</Link><Link href="/orientation">{locale === 'fr' ? 'Orientation' : 'Orientation'}</Link><Link href="/ministry">{locale === 'fr' ? 'Ministères' : 'Ministries'}</Link><Link href="/integrations">API</Link><Link href="/marketplace">Marketplace</Link><Link href="/assistant">{locale === 'fr' ? 'Assistant' : 'Assistant'}</Link><Link href="/xr">VR/AR</Link><Link href="/resources">{locale === 'fr' ? 'Ressources' : 'Resources'}</Link><Link href="/visitor">{locale === 'fr' ? 'Site public' : 'Public site'}</Link>
        </nav>
        <select aria-label="langue" value={locale} onChange={(e) => pick(e.target.value as Locale)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select>
        <button onClick={() => { setSession(null); router.replace('/login'); }}>{t('signout', locale)}</button>
      </header>
      <p role="status" style={{ color: online ? 'green' : '#b45309' }}>{online ? (pending ? `${pending} en attente` : t('synced', locale)) : t('offline', locale)}</p>
      <main>{children}</main>
    </div>
  );
}
