'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, getContext, getSession, isRootSession, replayQueue, setContext, setSession } from '../lib/api';
import { fetchAuthConfig, logoutUrl } from '../lib/oidc';
import { getLocale, setLocale, t, type Locale } from '../lib/i18n';
import { pendingOps } from '../lib/offline-queue';
import { HOME, NAV, PLATFORM, findAny, pick } from '../lib/nav';
import Icon from './Icon';

export default function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname() ?? '/';
  const [locale, setL] = useState<Locale>('fr');
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [ctx, setCtx] = useState('');
  const [schools, setSchools] = useState<{ slug: string; name: string; active: boolean }[]>([]);
  useEffect(() => {
    setL(getLocale()); setLocale(getLocale());
    const s = getSession();
    if (!s) router.replace('/login'); else setWho(s.school || 'root');
    if (isRootSession(s)) {
      setCtx(getContext());
      api('/tenants').then((r) => setSchools(r.data ?? []));
      if (!getContext() && window.location.pathname === '/') router.replace('/root');   // the platform owner starts in the root console
    }
    const up = async () => { setOnline(true); await replayQueue(); setPending(pendingOps().length); };
    const down = () => setOnline(false);
    setOnline(navigator.onLine); setPending(pendingOps().length);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, [router]);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, []);
  const pickLocale = (l: Locale) => { setLocale(l); setL(l); window.location.reload(); };   // pages read the language once: reload keeps every screen consistent
  const enter = (slug: string) => { setContext(slug); window.location.assign(slug ? '/' : '/root'); };
  const fr = locale === 'fr';
  const found = findAny(path);
  const title = path === '/' ? pick(HOME.label, locale) : found ? pick(found.label, locale) : path.startsWith('/account') ? (fr ? 'Mon compte' : 'My account') : t('app', locale);
  const isRoot = who === 'root';
  const groups = isRoot ? [PLATFORM, ...(ctx ? NAV : [])] : NAV;
  const needsSchool = isRoot && !ctx && path !== '/' && !path.startsWith('/root') && !path.startsWith('/account');
  const initials = (isRoot ? 'SA' : who.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '··').toUpperCase();
  const link = (href: string, icon: string, label: string) => (
    <Link key={href} href={href} className="nav-link" aria-current={(href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)) ? 'page' : undefined}>
      <Icon name={icon} /><span>{label}</span>
    </Link>
  );
  return (
    <div className={`app${open ? ' nav-open' : ''}`}>
      <a href="#contenu" className="skip-link">{fr ? 'Aller au contenu' : 'Skip to content'}</a>
      <aside className="sidebar" id="menu-principal">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">É</span>
          <span className="brand-name">ÉcoleManager<small>Pro · STONY-TECHNOLOGIE</small></span>
        </Link>
        <nav aria-label={fr ? 'Navigation principale' : 'Main navigation'}>
          {(!isRoot || ctx) && link(HOME.href, HOME.icon, pick(HOME.label, locale))}
          {groups.map((g) => (
            <div className="nav-group" key={g.title.fr} role="group" aria-label={pick(g.title, locale)}>
              <div className="nav-title" aria-hidden="true">{pick(g.title, locale)}</div>
              {g.items.map((i) => link(i.href, i.icon, pick(i.label, locale)))}
            </div>
          ))}
        </nav>
        <div className="side-foot">© STONY-TECHNOLOGIE</div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="main-col">
        <header className="topbar">
          <button className="menu-btn" aria-label={fr ? 'Ouvrir le menu' : 'Open menu'} aria-expanded={open} aria-controls="menu-principal" onClick={() => setOpen(!open)}><Icon name="menu" /></button>
          <div className="topbar-title">{title}</div>
          {isRoot && (
            <select className="ctx-select" aria-label={fr ? 'École dans laquelle vous agissez' : 'School you are acting in'} value={ctx} onChange={(e) => enter(e.target.value)}>
              <option value="">{fr ? '— Aucune école (console) —' : '— No school (console) —'}</option>
              {schools.map((x) => <option key={x.slug} value={x.slug}>{x.name}{x.active ? '' : ' (inactive)'}</option>)}
            </select>
          )}
          <div role="status" className={`pill ${online ? 'ok' : 'warn'}`}>{online ? (pending ? `${pending} ${fr ? 'en attente' : 'pending'}` : t('synced', locale)) : t('offline', locale)}</div>
          <select aria-label={fr ? 'Langue' : 'Language'} value={locale} onChange={(e) => pickLocale(e.target.value as Locale)}>
            <option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option>
          </select>
          <Link href="/account/password" className="who" title={fr ? 'Mon compte et mot de passe' : 'My account and password'}><span className="avatar" aria-hidden="true">{initials}</span><span className="who-name">{isRoot ? 'Super-Admin' : who}</span></Link>
          <button className="btn-ghost btn-out" aria-label={t('signout', locale)} onClick={async () => {
            const oidc = !!getSession()?.refresh; setSession(null);
            if (oidc) { try { const u = logoutUrl(await fetchAuthConfig()); if (u) { window.location.assign(u); return; } } catch { /* offline: local sign-out only */ } }
            router.replace('/login');
          }}><Icon name="logout" /><span className="btn-label">{t('signout', locale)}</span></button>
        </header>
        <main id="contenu" className="content" tabIndex={-1}>
          {needsSchool ? (
            <section className="need-ctx" aria-labelledby="need-h">
              <h1 id="need-h">{fr ? 'Choisissez une école' : 'Choose a school'}</h1>
              <p>{fr ? 'Cet écran travaille dans une école. En tant que Super-Admin racine vous avez tous les droits dans chacune : sélectionnez celle où agir.' : 'This screen works inside a school. As root super-admin you have every right in each of them: pick the one to act in.'}</p>
              <select aria-label={fr ? 'École' : 'School'} value="" onChange={(e) => e.target.value && enter(e.target.value)}>
                <option value="">{schools.length ? (fr ? 'Choisir une école…' : 'Choose a school…') : (fr ? 'Aucune école pour le moment' : 'No school yet')}</option>
                {schools.map((x) => <option key={x.slug} value={x.slug}>{x.name}</option>)}
              </select>
              <p><Link className="btn-link" href="/root">{fr ? 'Ouvrir la console racine pour créer une école' : 'Open the root console to create a school'}</Link></p>
            </section>
          ) : children}
        </main>
      </div>
    </div>
  );
}
