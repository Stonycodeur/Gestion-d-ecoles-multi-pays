'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Shell from '../../components/Shell';
import XrViewer, { type XrAsset } from '../../components/XrViewer';
import { api } from '../../lib/api';

function Content() {
  const lessonId = useSearchParams().get('lesson_id') ?? '';
  const [items, setItems] = useState<(XrAsset & { format: string })[]>([]); const [sel, setSel] = useState(0); const [msg, setMsg] = useState('');
  const [f, setF] = useState({ title: '', kind: 'model_3d', format: 'glb', url: '', ios_url: '', size_bytes: '', alt_text: '', lesson_id: lessonId, is_public: false });
  const load = async () => { const r = await api(`/xr/assets${lessonId ? `?lesson_id=${lessonId}` : ''}`); if (r.ok) setItems(r.data); else setMsg(`Module indisponible : ${r.error}`); };
  useEffect(() => { void load(); }, []);
  const add = async () => {
    const body: any = { ...f, size_bytes: Number(f.size_bytes), ios_url: f.ios_url || undefined, lesson_id: f.lesson_id || undefined };
    const r = await api('/xr/assets', { method: 'POST', body, online: true }); setMsg(r.ok ? 'Contenu ajouté' : `Refusé : ${r.error}`); if (r.ok) await load();
  };
  const cur = items[sel];
  return (
    <Shell>
      <h1>Réalité virtuelle et augmentée</h1><p role="status">{msg}</p>
      <ul>{items.map((a, i) => <li key={a.id}><button aria-pressed={i === sel} onClick={() => setSel(i)}>{a.title}</button> ({a.kind === 'model_3d' ? '3D / AR' : '360°'})</li>)}</ul>
      {cur ? <XrViewer asset={cur} /> : <p>Aucun contenu{lessonId ? ' pour cette leçon' : ''}.</p>}
      <fieldset><legend>Ajouter un contenu (enseignants)</legend>
        <input aria-label="titre" placeholder="Titre" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />{' '}
        <select aria-label="type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, format: e.target.value === 'model_3d' ? 'glb' : 'jpg' })}><option value="model_3d">Modèle 3D</option><option value="panorama_360">Panorama 360°</option></select>{' '}
        <input aria-label="format" placeholder="format" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} />{' '}
        <input aria-label="adresse du fichier" placeholder="https://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />{' '}
        {f.kind === 'model_3d' && <input aria-label="adresse usdz (iOS)" placeholder="https://… .usdz (facultatif)" value={f.ios_url} onChange={(e) => setF({ ...f, ios_url: e.target.value })} />}{' '}
        <input aria-label="taille en octets" placeholder="Taille (octets)" value={f.size_bytes} onChange={(e) => setF({ ...f, size_bytes: e.target.value })} />{' '}
        <input aria-label="description textuelle" placeholder="Description pour l’accessibilité" value={f.alt_text} onChange={(e) => setF({ ...f, alt_text: e.target.value })} />{' '}
        <label><input type="checkbox" checked={f.is_public} onChange={(e) => setF({ ...f, is_public: e.target.checked })} /> Visite publique (panorama, administration)</label>{' '}
        <button onClick={add} disabled={!f.title || !f.url || !f.alt_text || !f.size_bytes}>Ajouter</button></fieldset>
    </Shell>
  );
}
export default function XrPage() { return <Suspense fallback={<p>Chargement…</p>}><Content /></Suspense>; }
