'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { pub } from '../../../lib/public';
import XrViewer from '../../../components/XrViewer';

/** Public showcase: no login. History, programmes, news, statistics, online enrolment, contact, 360° virtual tour. */
export default function PublicSchool() {
  const school = String(useParams().school);
  const [site, setSite] = useState<any>(null); const [news, setNews] = useState<any[]>([]); const [stats, setStats] = useState<any>(null); const [levels, setLevels] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [panos, setPanos] = useState<any[]>([]); const [pano, setPano] = useState(0); const [msg, setMsg] = useState(''); const [scene, setScene] = useState(0);
  const [form, setForm] = useState<any>({ first_name: '', last_name: '', birth_date: '', level_code: '', guardian_name: '', guardian_email: '', guardian_phone: '', message: '', consent: false, website: '' });
  const [contact, setContact] = useState<any>({ name: '', email: '', subject: '', body: '', website: '' });

  useEffect(() => { (async () => {
    const s = await pub(school, '/site'); if (!s.ok) { setErr(s.status === 404 ? 'Espace public indisponible / Public space unavailable' : String(s.error)); return; }
    setSite(s.data); setNews((await pub(school, '/news')).data ?? []); setStats((await pub(school, '/stats')).data); setLevels((await pub(school, '/levels')).data ?? []);
    const tr = await pub(school, '/tour'); if (tr.ok) setPanos(tr.data ?? []);
  })(); }, [school]);

  const apply = async (e: React.FormEvent) => { e.preventDefault(); const r = await pub(school, '/apply', { method: 'POST', body: { ...form, birth_date: form.birth_date || undefined } });
    setMsg(r.ok ? 'Demande envoyée. L’établissement vous contactera. / Request sent.' : `Erreur : ${r.error}`); };
  const send = async (e: React.FormEvent) => { e.preventDefault(); const r = await pub(school, '/contact', { method: 'POST', body: contact }); setMsg(r.ok ? 'Message envoyé. / Message sent.' : `Erreur : ${r.error}`); };
  const tour = site?.content?.tour360?.scenes ?? []; const cur = tour[scene];

  if (err) return <main><p role="alert">{err}</p></main>;
  if (!site) return <main><p>Chargement…</p></main>;
  const text = (k: string) => site.content?.[k]?.text as string | undefined;
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <header><h1>{site.school}</h1><p>{site.country?.name_fr}</p></header>
      <p role="status" aria-live="polite">{msg}</p>
      {(['history', 'values', 'facilities', 'faculty', 'programs'] as const).map((k) => text(k) && <section key={k}><h2>{({ history: 'Histoire', values: 'Valeurs', facilities: 'Infrastructures', faculty: 'Corps professoral', programs: 'Programmes et filières' } as any)[k]}</h2><p>{text(k)}</p></section>)}
      {panos.length > 0 && <section aria-label="Visite virtuelle immersive"><h2>Visite virtuelle à 360°</h2>
        <XrViewer asset={{ ...panos[pano], kind: 'panorama_360' }} />
        <p>{panos.map((a: any, i: number) => <button key={a.id} onClick={() => setPano(i)} aria-pressed={i === pano}>{a.title}</button>)}</p></section>}
      {!panos.length && cur && <section aria-label="Visite virtuelle"><h2>Visite virtuelle à 360°</h2>
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}><img src={cur.image_url} alt={cur.title} style={{ height: 320, maxWidth: 'none' }} /></div>
        <p>{cur.title} {tour.map((s: any, i: number) => <button key={s.id} onClick={() => setScene(i)} aria-pressed={i === scene}>{s.title}</button>)}</p></section>}
      <section><h2>Actualités</h2>{news.length ? <ul>{news.map((n) => <li key={n.id}><strong>{n.title}</strong> — {new Date(n.published_at).toLocaleDateString('fr')}<br />{n.body}</li>)}</ul> : <p>Aucune actualité.</p>}</section>
      {stats && <section><h2>Chiffres clés</h2><p>Effectifs : {stats.enrolled}</p>
        <ul>{stats.success.map((s: any) => <li key={s.exam_code + s.school_year}>{s.exam_code} {s.school_year} : {s.success_rate_pct === null ? 'non publié (effectif trop faible)' : `${s.success_rate_pct} % de réussite`}</li>)}</ul></section>}
      <section><h2>Inscription en ligne</h2>
        <form onSubmit={apply}>
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          {[['first_name', 'Prénom'], ['last_name', 'Nom'], ['guardian_name', 'Responsable légal'], ['guardian_email', 'Email du responsable'], ['guardian_phone', 'Téléphone du responsable']].map(([k, l]) =>
            <p key={k}><label>{l} <input required={k !== 'guardian_email' && k !== 'guardian_phone'} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label></p>)}
          <p><label>Date de naissance <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></label></p>
          <p><label>Niveau demandé <select required value={form.level_code} onChange={(e) => setForm({ ...form, level_code: e.target.value })}><option value="">—</option>{levels.map((l) => <option key={l}>{l}</option>)}</select></label></p>
          <p><label>Message <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label></p>
          <p><label><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} /> J’accepte le traitement de ces données personnelles (enfant mineur) — <a href="/legal/privacy">politique de confidentialité</a></label></p>
          <button type="submit">Envoyer la demande</button>
        </form></section>
      <section><h2>Contact</h2>
        <form onSubmit={send}>
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} value={contact.website} onChange={(e) => setContact({ ...contact, website: e.target.value })} />
          {[['name', 'Nom'], ['email', 'Email'], ['subject', 'Objet']].map(([k, l]) => <p key={k}><label>{l} <input required value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} /></label></p>)}
          <p><label>Message <textarea required value={contact.body} onChange={(e) => setContact({ ...contact, body: e.target.value })} /></label></p>
          <button type="submit">Envoyer</button>
        </form></section>
    </main>
  );
}
