'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import { api } from '../lib/api';
import { getLocale, type Locale } from '../lib/i18n';
import { NAV, pick } from '../lib/nav';

export default function Home() {
  const [mods, setMods] = useState<{ name: string; version: string; mobile_screens: string[] }[]>([]);
  const [l, setL] = useState<Locale>('fr');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setL(getLocale()); api('/modules/active').then((r) => setMods(r.data ?? [])).finally(() => setLoaded(true)); }, []);
  const fr = l === 'fr';
  return (
    <Shell>
      <div className="hero">
        <h1>ÉcoleManager Pro</h1>
        <p>{fr ? 'Pédagogie, communication, suivi des élèves et finances de votre établissement, au même endroit.' : 'Teaching, communication, student follow-up and finance for your school, in one place.'}</p>
      </div>

      <h2 style={{ marginTop: 0 }}>{fr ? 'Modules actifs' : 'Active modules'}</h2>
      {mods.length > 0
        ? <ul className="chips" style={{ listStyle: 'none', padding: 0 }}>{mods.map((m) => <li className="chip" key={m.name} style={{ margin: 0 }}>{m.name} <small>v{m.version}</small></li>)}</ul>
        : <p className="empty">{loaded ? (fr ? 'Aucun module actif pour le moment.' : 'No active module yet.') : (fr ? 'Chargement…' : 'Loading…')}</p>}

      {NAV.map((g) => (
        <section key={g.title.fr} aria-label={pick(g.title, l)} style={{ background: 'none', border: 0, boxShadow: 'none', padding: 0, margin: '1.4rem 0 0' }}>
          <h2 style={{ marginTop: 0, fontSize: '1rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{pick(g.title, l)}</h2>
          <div className="grid-cards">
            {g.items.map((i) => (
              <Link key={i.href} href={i.href} className="card-link">
                <span className="card-ico"><Icon name={i.icon} /></span>
                <span><strong>{pick(i.label, l)}</strong><span className="desc">{pick(i.desc, l)}</span></span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </Shell>
  );
}
