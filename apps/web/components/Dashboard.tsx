'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Shell from './Shell';
import Icon from './Icon';
import { api, getSession, isRootSession } from '../lib/api';
import { useNavigation } from '../lib/navigation';
import { useLang } from '../lib/useLang';
import { useProfile } from '../lib/profile';

const ROLE: Record<string, [string, string]> = { tenant_super_admin: ['Super-Admin de l’établissement', 'School super-admin'], admin: ['Administrateur', 'Administrator'], head: ['Direction', 'School head'], teacher: ['Enseignant', 'Teacher'], education_assistant: ['Assistant d’éducation', 'Education assistant'], accountant: ['Comptabilité', 'Accounting'], student: ['Élève', 'Student'], guardian: ['Parent', 'Parent'], inspector: ['Inspecteur', 'Inspector'], root_super_admin: ['Super-Admin racine', 'Root super-admin'] };

/** Personal home: signed-in people land here, with only what their role, the school's modules and the school level allow. */
export default function Dashboard() {
  const { t, l, fr } = useLang(); const { nav, loaded, has, term } = useNavigation(); const { profile } = useProfile();
  const [counts, setCounts] = useState<{ students?: number; classes?: number; teachers?: number }>({}); const [news, setNews] = useState<any[]>([]); const [unread, setUnread] = useState(0);
  const root = isRootSession(); const roles = (() => { try { return JSON.parse(atob((getSession()?.token ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).roles as string[] ?? []; } catch { return []; } })();
  useEffect(() => {
    if (!nav.school) return;
    void (async () => {
      if (has('students:read')) { const [s, c] = await Promise.all([api<any[]>('/students?limit=500'), api<any[]>('/classes')]); setCounts((x) => ({ ...x, students: Array.isArray(s.data) ? s.data.length : undefined, classes: Array.isArray(c.data) ? c.data.length : undefined })); }
      if (has('staff:read')) { const r = await api<any[]>('/teachers'); setCounts((x) => ({ ...x, teachers: Array.isArray(r.data) ? r.data.length : undefined })); }
      if (has('news:read')) { const r = await api<any[]>('/news'); setNews(Array.isArray(r.data) ? r.data.slice(0, 3) : []); }
      const n = await api<any[]>('/notifications'); setUnread(Array.isArray(n.data) ? n.data.filter((x) => !x.read_at).length : 0);
    })();
  }, [nav.school, nav.rights.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = profile?.full_name?.split(' ')[0];
  const role = roles.map((r) => ROLE[r]?.[fr ? 0 : 1] ?? r)[0] ?? '';
  const quick = nav.groups.flatMap((g) => g.items).filter((i) => !['/notifications'].includes(i.href));
  return (
    <Shell>
      <div className="hero">
        <p className="eyebrow">{nav.school ? `${nav.school.name}${nav.profile ? ` · ${fr ? nav.profile.label.fr : nav.profile.label.en}` : ''}` : 'ÉcoleManager Pro'}</p>
        <h1>{name ? t(`Bonjour ${name}`, `Hello ${name}`) : t('Bonjour', 'Hello')}</h1>
        <p>{role && <strong>{role}</strong>}{role ? ' — ' : ''}{root && !nav.school ? t('Choisissez une école en haut pour y agir, ou ouvrez la console racine.', 'Pick a school above to act in it, or open the root console.') : t('Voici votre espace personnel.', 'This is your personal space.')}</p>
      </div>

      {nav.school && (
        <div className="tiles">
          {unread > 0 && <Link href="/notifications" className="tile"><Icon name="bell" /><strong>{unread}</strong><span>{t('notification(s) non lue(s)', 'unread notification(s)')}</span></Link>}
          {counts.students !== undefined && <Link href="/school/students" className="tile"><Icon name="users" /><strong>{counts.students}</strong><span>{term('students', l)}</span></Link>}
          {counts.classes !== undefined && <Link href="/school/classes" className="tile"><Icon name="school" /><strong>{counts.classes}</strong><span>{term('classes', l)}</span></Link>}
          {counts.teachers !== undefined && <Link href="/school/staff" className="tile"><Icon name="user" /><strong>{counts.teachers}</strong><span>{term('teachers', l)}</span></Link>}
        </div>)}

      {news.length > 0 && (
        <section aria-labelledby="dn" style={{ background: 'none', border: 0, boxShadow: 'none', padding: 0 }}>
          <h2 id="dn">{t('Dernières actualités', 'Latest news')}</h2>
          <ul className="plain">{news.map((n) => <li key={n.id}><strong>{n.title}</strong><small>{n.published_at ? new Date(n.published_at).toLocaleDateString(fr ? 'fr-FR' : 'en-GB') : ''}</small></li>)}</ul>
        </section>)}

      {!loaded && <p>{t('Chargement de votre espace…', 'Loading your space…')}</p>}
      {loaded && nav.school && quick.length === 0 && <div className="empty-state"><Icon name="lock" />{t('Aucune fonctionnalité n’est encore ouverte à votre compte. Contactez l’administrateur de votre établissement.', 'No feature is open to your account yet. Contact your school administrator.')}</div>}
      {nav.groups.map((g) => (
        <section key={g.key} aria-label={fr ? g.title.fr : g.title.en} style={{ background: 'none', border: 0, boxShadow: 'none', padding: 0, margin: '1.4rem 0 0' }}>
          <h2 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{fr ? g.title.fr : g.title.en}</h2>
          <div className="grid-cards">{g.items.map((i) => (
            <Link key={i.href} href={i.href} className="card-link"><span className="card-ico"><Icon name={i.icon} /></span><span><strong>{fr ? i.label.fr : i.label.en}</strong><span className="desc">{fr ? i.desc.fr : i.desc.en}</span></span></Link>))}</div>
        </section>))}
    </Shell>
  );
}
