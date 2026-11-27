'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import Confirm from '../../../components/Confirm';
import Icon from '../../../components/Icon';
import { api } from '../../../lib/api';
import { msgOf } from '../../../lib/profile';
import { useLang } from '../../../lib/useLang';

interface Item { kind: 'school' | 'account' | 'geo'; id: string; label: string; detail: string; deleted_at: string; deleted_by: string | null; purge_at: string; overdue: boolean }

/** Trash: everything deleted by the root can be restored here, or erased for good. Items are kept 90 days. */
export default function TrashPage() {
  const { t, fr } = useLang();
  const [kind, setKind] = useState(''); const [items, setItems] = useState<Item[]>([]); const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [purge, setPurge] = useState<Item | null>(null); const [empty, setEmpty] = useState(false);
  const load = useCallback(async () => { const r = await api<Item[]>(`/trash${kind ? `?kind=${kind}` : ''}`); if (r.ok) setItems(r.data ?? []); else setErr(msgOf(r)); setLoaded(true); }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const kinds: [string, string][] = [['', t('Tout', 'All')], ['school', t('Établissements', 'Schools')], ['account', t('Comptes', 'Accounts')], ['geo', t('Géographie', 'Geography')]];
  const kindName = (k: string) => (k === 'school' ? t('Établissement', 'School') : k === 'account' ? t('Compte', 'Account') : t('Géographie', 'Geography'));
  const date = (s: string) => new Date(s).toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const left = (s: string) => Math.max(0, Math.ceil((new Date(s).getTime() - Date.now()) / 86400000));
  const nonSchool = items.filter((i) => i.kind !== 'school').length;

  const restore = async (i: Item) => {
    const r = await api(`/trash/${i.kind}/${encodeURIComponent(i.id)}/restore`, { method: 'POST', online: true });
    if (!r.ok) { setErr(r.status === 409 ? t(`« ${i.label} » ne peut pas être restauré : un élément identique existe déjà.`, `“${i.label}” cannot be restored: an identical item already exists.`) : msgOf(r)); return; }
    setErr(''); setMsg(t(`« ${i.label} » est restauré.`, `“${i.label}” is restored.`)); await load();
  };
  const erase = async () => {
    if (!purge) return; const i = purge;
    const r = await api(`/trash/${i.kind}/${encodeURIComponent(i.id)}${i.kind === 'school' ? `?confirm=${encodeURIComponent(i.id)}` : ''}`, { method: 'DELETE', online: true });
    setPurge(null); if (!r.ok) { setErr(msgOf(r)); return; }
    setErr(''); setMsg(t(`« ${i.label} » est supprimé définitivement.`, `“${i.label}” is permanently deleted.`)); await load();
  };
  const emptyAll = async () => {
    const r = await api<{ purged: number; failed: string[] }>('/trash', { method: 'DELETE', online: true });
    setEmpty(false); if (!r.ok) { setErr(msgOf(r)); return; }
    const f = r.data?.failed ?? [];
    setErr(f.length ? t(`Non supprimés : ${f.join(', ')}.`, `Not deleted: ${f.join(', ')}.`) : ''); setMsg(t(`${r.data?.purged ?? 0} élément(s) supprimé(s) définitivement. Les établissements se suppriment un par un.`, `${r.data?.purged ?? 0} item(s) permanently deleted. Schools are deleted one by one.`)); await load();
  };

  return (
    <Shell>
      <div className="page-head"><div><h1>{t('Corbeille', 'Trash')}</h1><small>{t('Les éléments supprimés restent restaurables. Au-delà de 90 jours ils sont signalés « à supprimer », mais rien n’est effacé sans votre action.', 'Deleted items can be restored. After 90 days they are flagged “due”, but nothing is erased without your action.')}</small></div>
        <button type="button" className="btn-danger btn-ico" disabled={nonSchool === 0} onClick={() => setEmpty(true)}><Icon name="trash" />{t('Vider la corbeille', 'Empty the trash')}</button></div>
      {err && <p role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}
      <div className="tabs" role="tablist">{kinds.map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setMsg(''); setErr(''); }}>{l}</button>)}</div>
      {loaded && items.length === 0 ? <div className="empty-state"><Icon name="inbox" />{t('La corbeille est vide.', 'The trash is empty.')}</div> : (
        <table>
          <thead><tr><th>{t('Élément', 'Item')}</th><th>{t('Type', 'Type')}</th><th>{t('Supprimé le', 'Deleted on')}</th><th>{t('Suppression définitive', 'Permanent deletion')}</th><th><span className="sr-only">{t('Actions', 'Actions')}</span></th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={`${i.kind}:${i.id}`}>
              <td><strong>{i.label}</strong><small>{i.detail}</small></td>
              <td>{kindName(i.kind)}</td>
              <td>{date(i.deleted_at)}{i.deleted_by && <small>{i.deleted_by}</small>}</td>
              <td>{i.overdue ? <span className="badge warn">{t('À supprimer', 'Due')}</span> : t(`dans ${left(i.purge_at)} j`, `in ${left(i.purge_at)} d`)}</td>
              <td><div className="row-actions">
                <button type="button" className="btn-ico" onClick={() => restore(i)}><Icon name="restore" />{t('Restaurer', 'Restore')}</button>
                <button type="button" className="btn-danger" aria-label={`${t('Supprimer définitivement', 'Delete permanently')} : ${i.label}`} onClick={() => setPurge(i)}><Icon name="trash" /></button>
              </div></td>
            </tr>))}</tbody>
        </table>)}
      {purge && <Confirm title={t('Supprimer définitivement ?', 'Delete permanently?')} requireText={purge.kind === 'school' ? purge.id : undefined}
        body={purge.kind === 'school' ? t(`Toutes les données de l’établissement « ${purge.label} » seront effacées. Cette action est irréversible.`, `All data of the school “${purge.label}” will be erased. This cannot be undone.`) : t(`« ${purge.label} » sera effacé pour toujours.`, `“${purge.label}” will be erased for good.`)}
        label={t('Supprimer définitivement', 'Delete permanently')} onConfirm={erase} onClose={() => setPurge(null)} />}
      {empty && <Confirm title={t('Vider la corbeille ?', 'Empty the trash?')} body={t(`${nonSchool} compte(s) et élément(s) géographiques seront effacés pour toujours. Les établissements ne sont pas concernés : ils se suppriment un par un.`, `${nonSchool} account(s) and geography item(s) will be erased for good. Schools are not affected: they are deleted one by one.`)} label={t('Vider', 'Empty')} onConfirm={emptyAll} onClose={() => setEmpty(false)} />}
    </Shell>
  );
}
