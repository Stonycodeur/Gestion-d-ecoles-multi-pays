'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, getContext, getSession, getViewAs, setViewAs, isRootSession, replayQueue, setContext, setSession } from '../lib/api';
import { fetchAuthConfig, logoutUrl } from '../lib/oidc';
import { getLocale, setLocale, t, type Locale } from '../lib/i18n';
import { pendingOps } from '../lib/offline-queue';
import { HOME, PLATFORM, pick } from '../lib/nav';
import { useNavigation } from '../lib/navigation';
import NotificationBell from './NotificationBell';
import Icon from './Icon';
import PersonalizeDialog from './PersonalizeDialog';
import SyncDialog from './SyncDialog';
import { decodeClaims } from '../lib/pkce';
import { initialsOf, useProfile } from '../lib/profile';
import { loadPrefs, mergeRemote, savePrefs } from '../lib/prefs';

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
  const [menu, setMenu] = useState(false); const [dlg, setDlg] = useState<'' | 'perso' | 'sync'>('');
  const [email, setEmail] = useState(''); const [roles, setRoles] = useState<string[]>([]); const [install, setInstall] = useState<any>(null); const [hint, setHint] = useState(''); const [viewAs, setViewAsState] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => setViewAsState(getViewAs()), []);
  const { profile } = useProfile(); const menuRef = useRef<HTMLDivElement>(null); const { nav } = useNavigation();
  useEffect(() => {
    setL(getLocale()); setLocale(getLocale());
    const s = getSession();
    if (!s) router.replace('/login'); else {
      setWho(s.school || 'root');
      const c = decodeClaims(s.token); setEmail(typeof c.email === 'string' ? c.email : ''); setRoles(Array.isArray(c.roles) ? (c.roles as string[]) : []);
    }
    const bip = (e: Event) => { e.preventDefault(); setInstall(e); };
    window.addEventListener('beforeinstallprompt', bip);
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
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); window.removeEventListener('beforeinstallprompt', bip); };
  }, [router]);
  // Preferences saved on the account follow the person to this device.
  useEffect(() => { if (profile) { if (Object.keys(profile.preferences).length) mergeRemote(profile.preferences); if (profile.language && !localStorage.getItem('em_locale')) { setLocale(profile.language as Locale); setL(profile.language as Locale); } } }, [profile]);
  useEffect(() => {
    if (!menu) return;
    const out = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', out); return () => document.removeEventListener('mousedown', out);
  }, [menu]);
  useEffect(() => { setOpen(false); setMenu(false); }, [path]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setMenu(false); } };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, []);
  const enter = (slug: string) => { setContext(slug); window.location.assign(slug ? '/' : '/root'); };
  const fr = locale === 'fr';
  const navGroups = nav.groups.map((g) => ({ title: g.title, items: g.items }));
  const found = [...PLATFORM.items, ...navGroups.flatMap((g) => g.items)].filter((i) => path === i.href || path.startsWith(`${i.href}/`)).sort((x, y) => y.href.length - x.href.length)[0];
  const title = path === '/' ? pick(HOME.label, locale) : found ? pick(found.label, locale) : path.startsWith('/account') ? (fr ? 'Mon espace' : 'My space') : t('app', locale);
  const isRoot = who === 'root';
  const groups = isRoot ? [PLATFORM, ...(ctx ? navGroups : [])] : navGroups;
  const needsSchool = isRoot && !ctx && path !== '/' && !path.startsWith('/root') && !path.startsWith('/account');
  const initials = initialsOf(profile?.full_name, isRoot ? 'SA' : who.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '··');
  const display = profile?.full_name || email || (isRoot ? 'Super-Admin' : who);
  const t2 = (a: string, b: string) => (fr ? a : b);
  const cycleTheme = () => { const p = loadPrefs(); const next = p.mode === 'auto' ? 'light' : p.mode === 'light' ? 'dark' : 'auto'; savePrefs({ ...p, mode: next }); setHint(next === 'auto' ? t2('Thème : automatique', 'Theme: automatic') : next === 'light' ? t2('Thème clair', 'Light theme') : t2('Thème sombre', 'Dark theme')); };
  const logout = async () => {
    const oidc = !!getSession()?.refresh; setSession(null);
    if (oidc) { try { const u = logoutUrl(await fetchAuthConfig()); if (u) { window.location.assign(u); return; } } catch { /* offline: local sign-out only */ } }
    router.replace('/login');
  };
  const item = (icon: string, label: string, onClick: () => void) => (<button type="button" className="menu-item" onClick={() => { setMenu(false); onClick(); }}><Icon name={icon} />{label}</button>);
  const link = (href: string, icon: string, label: string) => (
    <Link key={href} href={href} className="nav-link" title={label} aria-current={(href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`)) ? 'page' : undefined}>
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
          <button type="button" className={`pill ${online ? 'ok' : 'warn'}`} style={{ minHeight: 0, border: 0 }} onClick={() => setDlg('sync')} aria-label={`${online ? (pending ? `${pending} ${fr ? 'en attente' : 'pending'}` : t('synced', locale)) : t('offline', locale)} — ${fr ? 'ouvrir la synchronisation' : 'open synchronisation'}`}>{online ? (pending ? `${pending} ${fr ? 'en attente' : 'pending'}` : t('synced', locale)) : t('offline', locale)}</button>
          <NotificationBell active={!!who && !(who === 'root' && !ctx)} />
          <div className="usermenu" ref={menuRef}>
            <button type="button" className="avatar-btn" aria-expanded={menu} aria-controls="menu-user" aria-label={`${fr ? 'Mon espace' : 'My space'} : ${display}`} onClick={() => setMenu(!menu)}>
              {profile?.avatar ? <img src={profile.avatar} alt="" /> : <span aria-hidden="true">{initials}</span>}
            </button>
            {menu && (
              <div className="menu-pop" id="menu-user">
                <div className="who-card"><strong>{display}</strong><small>{email && profile?.full_name ? email : ''}{roles.length ? `${email && profile?.full_name ? ' · ' : ''}${roles.join(', ')}` : ''}{!isRoot && who ? ` · ${who}` : ''}</small></div>
                {item('user', t2('Mon profil', 'My profile'), () => router.push('/account/profile'))}
                {item('palette', t2('Personnaliser', 'Personalize'), () => setDlg('perso'))}
                {item('sync', t2('Synchronisation', 'Synchronisation'), () => setDlg('sync'))}
                {item('lock', t2('Sécurité', 'Security'), () => router.push('/account/security'))}
                {item('download', t2('Installer l’application', 'Install the app'), async () => { if (install) { install.prompt(); setInstall(null); } else setHint(t2('Utilisez « Ajouter à l’écran d’accueil » ou « Installer » dans le menu de votre navigateur.', 'Use “Add to home screen” or “Install” in your browser menu.')); })}
                {item('sun', t2('Thème', 'Theme'), cycleTheme)}
                <button type="button" className="menu-item danger" onClick={logout}><Icon name="logout" />{t('signout', locale)}</button>
              </div>
            )}
          </div>
        </header>
        {viewAs && <p role="status" className="viewas-bar"><Icon name="eye" /> {fr ? `Vous consultez l’école comme ${viewAs.label} (lecture seule, tracé dans le journal d’audit).` : `You are viewing the school as ${viewAs.label} (read-only, recorded in the audit log).`} <button type="button" className="btn-sec" onClick={() => { setViewAs(null); location.assign('/school/users'); }}>{fr ? 'Quitter' : 'Exit'}</button></p>}
        {hint && <p role="status" className="note" style={{ margin: '8px clamp(14px,3vw,32px) 0' }}>{hint} <button type="button" className="btn-sec" onClick={() => setHint('')}>OK</button></p>}
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
      {dlg === 'perso' && <PersonalizeDialog onClose={() => setDlg('')} />}
      {dlg === 'sync' && <SyncDialog onClose={() => setDlg('')} onChange={() => setPending(pendingOps().length)} />}
    </div>
  );
}
