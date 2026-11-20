'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export default function GpsPage() {
  const [kids, setKids] = useState<any[]>([]); const [kid, setKid] = useState('');
  const [consent, setConsent] = useState<any>(null); const [live, setLive] = useState<any>(null); const [events, setEvents] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]); const [msg, setMsg] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]); const [start, setStart] = useState('07:00'); const [end, setEnd] = useState('18:00'); const [retention, setRetention] = useState('30');
  const [fence, setFence] = useState({ name: 'Maison', lat: '', lng: '', radius_m: '100' });

  useEffect(() => { api('/me/students').then((r) => { const k = r.ok ? r.data : []; setKids(k); if (k[0]) setKid(k[0].id); }); }, []);
  const refresh = async () => {
    if (!kid) return;
    const c = await api(`/gps/students/${kid}/consent`); setConsent(c.ok ? c.data : null);
    const l = await api(`/gps/students/${kid}/live`); setLive(l.ok ? l.data : null); if (!l.ok) setMsg(l.error ?? '');
    const e = await api(`/gps/students/${kid}/events`); setEvents(e.ok ? e.data : []);
    const a = await api(`/gps/students/${kid}/access-log`); setLog(a.ok ? a.data : []);
  };
  useEffect(() => { void refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [kid]);   // refreshed every 15 s

  const grant = async () => { const r = await api(`/gps/students/${kid}/consent`, { method: 'POST', body: { granted: true, window: { days, start, end }, retention_days: Number(retention) }, online: true }); setMsg(r.ok ? 'Consentement enregistré' : `Refusé : ${r.error}`); await refresh(); };
  const revoke = async () => { const r = await api(`/gps/students/${kid}/consent`, { method: 'POST', body: { granted: false }, online: true }); setMsg(r.ok ? `Consentement révoqué, ${r.data.positions_purged} position(s) supprimée(s)` : `Refusé : ${r.error}`); await refresh(); };
  const addFence = async () => { const r = await api('/gps/geofences', { method: 'POST', body: { student_id: kid, name: fence.name, kind: 'home', lat: Number(fence.lat), lng: Number(fence.lng), radius_m: Number(fence.radius_m) } }); setMsg(r.ok ? 'Zone ajoutée' : `Refusé : ${r.error}`); };

  const pos = live?.position;
  const bbox = pos ? `${pos.lng - 0.005},${pos.lat - 0.003},${pos.lng + 0.005},${pos.lat + 0.003}` : '';
  return (
    <Shell>
      <h1>Suivi de localisation</h1>
      <p>Le suivi n’existe que si vous l’activez. Il est limité à la plage choisie, chiffré, supprimé après la durée indiquée, et chaque consultation est journalisée. Vous pouvez le révoquer à tout moment ; l’élève aussi.</p>
      <select aria-label="enfant" value={kid} onChange={(e) => setKid(e.target.value)}>{kids.map((k) => <option key={k.id} value={k.id}>{k.first_name} {k.last_name}</option>)}</select>
      <p role="status">{msg}</p>
      <fieldset><legend>Consentement</legend>
        {DAYS.map((d, i) => <label key={d} style={{ marginRight: 8 }}><input type="checkbox" checked={days.includes(i + 1)} onChange={(e) => setDays(e.target.checked ? [...days, i + 1] : days.filter((x) => x !== i + 1))} /> {d}</label>)}
        <label> De <input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label> à <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label> Conservation (jours) <input type="number" min={1} max={consent?.limit_days ?? 30} value={retention} onChange={(e) => setRetention(e.target.value)} /></label>{' '}
        <button onClick={grant} disabled={!days.length}>J’autorise le suivi</button>{' '}
        {consent?.tracking_active && <button onClick={revoke}>Révoquer</button>}
      </fieldset>
      {pos ? (
        <section><h2>Dernière position</h2>
          <p>{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} · précision {Math.round(pos.accuracy_m)} m · {new Date(pos.recorded_at).toLocaleTimeString()} {live.state?.out_of_zone && <strong>· Hors zone attendue</strong>}</p>
          <iframe title="Carte" width="100%" height="280" src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${pos.lat},${pos.lng}`} />
          <p><a href={`https://www.openstreetmap.org/?mlat=${pos.lat}&mlon=${pos.lng}#map=17/${pos.lat}/${pos.lng}`}>Ouvrir la carte</a></p>
        </section>
      ) : <p>Aucune position visible.</p>}
      <h2>Événements</h2>
      <ul>{events.map((e, i) => <li key={i}>{new Date(e.occurred_at).toLocaleString()} — {e.type}{e.geofence ? ` (${e.geofence})` : ''}</li>)}</ul>
      <fieldset><legend>Ajouter une zone (domicile, lieu sûr)</legend>
        <input aria-label="nom" value={fence.name} onChange={(e) => setFence({ ...fence, name: e.target.value })} />
        <input aria-label="latitude" placeholder="Latitude" value={fence.lat} onChange={(e) => setFence({ ...fence, lat: e.target.value })} />
        <input aria-label="longitude" placeholder="Longitude" value={fence.lng} onChange={(e) => setFence({ ...fence, lng: e.target.value })} />
        <input aria-label="rayon" type="number" min={20} value={fence.radius_m} onChange={(e) => setFence({ ...fence, radius_m: e.target.value })} /> m{' '}
        <button onClick={addFence} disabled={!fence.lat || !fence.lng}>Ajouter</button>
      </fieldset>
      <h2>Qui a consulté la position</h2>
      <ul>{log.map((l, i) => <li key={i}>{new Date(l.at).toLocaleString()} — {l.action}</li>)}</ul>
    </Shell>
  );
}
