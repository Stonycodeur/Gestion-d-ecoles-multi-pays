'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Shell from './Shell';
import Modal from './Modal';
import Confirm from './Confirm';
import { api } from '../lib/api';
import { useLang } from '../lib/useLang';
import { useNavigation } from '../lib/navigation';

export interface Field { key: string; fr: string; en: string; type?: 'text' | 'number' | 'date' | 'select'; options?: { value: string; fr: string; en: string }[]; required?: boolean; step?: string; editOnly?: boolean }
export interface Col { key: string; fr: string; en: string; render?: (row: any, lookups: Record<string, any[]>) => ReactNode }
interface Props {
  titleFr: string; titleEn: string; endpoint: string; readRight: string; writeRight: string; fields: Field[]; cols: Col[];
  /** Other lists needed by selects and columns (loaded once): name -> endpoint. */
  lookups?: Record<string, string>; lookupOptions?: (key: string, lookups: Record<string, any[]>) => { value: string; fr: string; en: string }[];
  defaults?: Record<string, unknown>; canDelete?: boolean; canEdit?: boolean; intro?: ReactNode;
}
const msg = (r: { status: number; error?: string }, t: (a: string, b: string) => string) =>
  r.status === 409 ? t('Impossible : cet élément est utilisé ailleurs (notes, emploi du temps, élèves…). Retirez d’abord ces liens.', 'Not possible: this item is used elsewhere (grades, timetable, students…). Remove those links first.')
    : r.status === 403 ? t('Vous n’avez pas le droit de faire cela.', 'You are not allowed to do this.') : `${t('Erreur', 'Error')} : ${r.error ?? r.status}`;

/** List + create + edit + delete for one kind of school data. Buttons only appear for the rights the person holds. */
export default function ResourcePage(p: Props) {
  const { t, fr } = useLang(); const { has, loaded } = useNavigation();
  const [rows, setRows] = useState<any[] | null>(null); const [lk, setLk] = useState<Record<string, any[]>>({}); const [q, setQ] = useState(''); const [err, setErr] = useState('');
  const [form, setForm] = useState<{ row: any | null } | null>(null); const [del, setDel] = useState<any | null>(null);
  const load = async () => { const r = await api(p.endpoint); if (r.ok) { setRows(Array.isArray(r.data) ? r.data : (r.data?.rows ?? [])); setErr(''); } else { setRows([]); setErr(msg(r, t)); } };
  useEffect(() => { void load(); for (const [k, ep] of Object.entries(p.lookups ?? {})) void api(ep).then((r) => setLk((o) => ({ ...o, [k]: Array.isArray(r.data) ? r.data : [] }))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const write = has(p.writeRight); const shown = useMemo(() => (rows ?? []).filter((r) => !q || JSON.stringify(Object.values(r)).toLowerCase().includes(q.toLowerCase())), [rows, q]);
  if (loaded && !has(p.readRight)) return <Shell><h1>{fr ? p.titleFr : p.titleEn}</h1><div className="empty-state"><p>{t('Vous n’avez pas accès à cette page.', 'You do not have access to this page.')}</p></div></Shell>;
  return (
    <Shell>
      <h1>{fr ? p.titleFr : p.titleEn}</h1>
      {p.intro}
      <div className="toolbar">
        <input type="search" aria-label={t('Rechercher', 'Search')} placeholder={t('Rechercher…', 'Search…')} value={q} onChange={(e) => setQ(e.target.value)} />
        {write && <button type="button" onClick={() => setForm({ row: null })}>{t('Ajouter', 'Add')}</button>}
      </div>
      {err && <p role="alert">{err}</p>}
      {rows === null ? <p aria-busy="true">{t('Chargement…', 'Loading…')}</p> : shown.length === 0 ? <div className="empty-state"><p>{rows.length ? t('Aucun résultat.', 'No result.') : t('Rien pour le moment.', 'Nothing yet.')}</p></div> : (
        <div className="table-wrap"><table>
          <thead><tr>{p.cols.map((c) => <th key={c.key} scope="col">{fr ? c.fr : c.en}</th>)}{write && <th scope="col"><span className="sr-only">{t('Actions', 'Actions')}</span></th>}</tr></thead>
          <tbody>{shown.map((r) => <tr key={r.id}>{p.cols.map((c) => <td key={c.key}>{c.render ? c.render(r, lk) : String(r[c.key] ?? '—')}</td>)}
            {write && <td className="row-actions">{p.canEdit !== false && <button type="button" className="btn-sec" onClick={() => setForm({ row: r })}>{t('Modifier', 'Edit')}</button>}{p.canDelete !== false && <button type="button" className="btn-sec" onClick={() => setDel(r)}>{t('Supprimer', 'Delete')}</button>}</td>}</tr>)}</tbody>
        </table></div>)}
      {form && <FormDialog {...p} lk={lk} row={form.row} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await load(); }} />}
      {del && <Confirm title={t('Supprimer', 'Delete')} body={t('Cette suppression est définitive.', 'This deletion is permanent.')} label={t('Supprimer', 'Delete')} onClose={() => setDel(null)}
        onConfirm={async () => { const r = await api(`${p.endpoint}/${del.id}`, { method: 'DELETE' }); setErr(r.ok ? '' : msg(r, t)); setDel(null); await load(); }} />}
    </Shell>
  );
}

function FormDialog(p: Props & { lk: Record<string, any[]>; row: any | null; onClose: () => void; onSaved: () => void }) {
  const { t, fr } = useLang(); const edit = !!p.row; const [err, setErr] = useState('');
  const [v, setV] = useState<Record<string, any>>(() => { const o: Record<string, any> = { ...(p.defaults ?? {}) }; for (const f of p.fields) if (p.row) o[f.key] = p.row[f.key] ?? ''; return o; });
  const fields = p.fields.filter((f) => edit || !f.editOnly);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    const body: Record<string, unknown> = {}; for (const f of fields) { const x = v[f.key]; body[f.key] = f.type === 'number' ? (x === '' || x === undefined ? undefined : Number(x)) : (x === '' ? (edit ? null : undefined) : x); }
    const r = await api(edit ? `${p.endpoint}/${p.row.id}` : p.endpoint, { method: edit ? 'PATCH' : 'POST', body });
    if (r.ok) p.onSaved(); else setErr(msg(r, t));
  };
  return (
    <Modal title={edit ? t('Modifier', 'Edit') : t('Ajouter', 'Add')} onClose={p.onClose}>
      <form onSubmit={submit} className="school-form">
        {fields.map((f) => {
          const opts = f.type === 'select' ? (f.options ?? p.lookupOptions?.(f.key, p.lk) ?? []) : [];
          return <label key={f.key}>{fr ? f.fr : f.en}
            {f.type === 'select' ? <select required={f.required} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}><option value="">—</option>{opts.map((o) => <option key={o.value} value={o.value}>{fr ? o.fr : o.en}</option>)}</select>
              : <input type={f.type ?? 'text'} step={f.step} required={f.required} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}</label>;
        })}
        {err && <p role="alert">{err}</p>}
        <div className="modal-foot"><button type="button" className="btn-sec" onClick={p.onClose}>{t('Annuler', 'Cancel')}</button><button type="submit">{t('Enregistrer', 'Save')}</button></div>
      </form>
    </Modal>
  );
}
