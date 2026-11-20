'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api, openPdf } from '../../lib/api';

const money = (minor: number, cur: string, digits: number) => new Intl.NumberFormat('fr', { style: 'currency', currency: cur }).format(minor / 10 ** digits);

export default function PaymentsPage() {
  const [cfg, setCfg] = useState<any>(null); const [invoices, setInvoices] = useState<any[]>([]); const [staff, setStaff] = useState(false);
  const [stats, setStats] = useState<any>(null); const [msg, setMsg] = useState('');
  const [method, setMethod] = useState(''); const [payer, setPayer] = useState(''); const [last, setLast] = useState<any>(null);
  const [manual, setManual] = useState({ invoice_id: '', method: 'cash', amount_minor: '', reference: '' });
  const digits = (cur: string) => new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;

  const load = async () => {
    const c = await api('/payments/config'); if (c.ok) { setCfg(c.data); setMethod(c.data.methods.find((m: any) => ['mobile_money', 'card'].includes(m.kind))?.code ?? ''); }
    const all = await api('/invoices');
    if (all.ok) { setStaff(true); setInvoices(all.data); const s = await api('/billing/stats'); if (s.ok) setStats(s.data); return; }
    const mine = await api('/me/students'); const out: any[] = [];
    for (const st of mine.ok ? mine.data : []) { const r = await api(`/students/${st.id}/invoices`); if (r.ok) out.push(...r.data.map((i: any) => ({ ...i, student: `${st.first_name} ${st.last_name}` }))); }
    setInvoices(out);
  };
  useEffect(() => { void load(); }, []);

  const pay = async (inv: any, amount?: number) => {
    const r = await api(`/invoices/${inv.id}/pay`, { method: 'POST', body: { method, payer, ...(amount ? { amount_minor: amount } : {}) }, headers: { 'Idempotency-Key': `${inv.id}-${Date.now()}` }, online: true });
    if (r.ok) { setLast(r.data); setMsg(r.data.instructions ?? (r.data.redirect_url ? 'Redirection vers le paiement…' : 'Paiement initié')); if (r.data.redirect_url) window.location.href = r.data.redirect_url; } else setMsg(`Refusé : ${r.error}`);
  };
  const simulate = async () => { const r = await api(`/payments/${last.payment.id}/sandbox-confirm`, { method: 'POST', body: {}, online: true }); setMsg(r.ok ? `Confirmé : reçu ${r.data.receipt ?? ''}` : `Refusé : ${r.error}`); setLast(null); await load(); };
  const record = async () => { const r = await api('/payments/manual', { method: 'POST', body: { ...manual, amount_minor: Number(manual.amount_minor) }, online: true }); setMsg(r.ok ? `Enregistré : reçu ${r.data.receipt_number}` : `Refusé : ${r.error}`); await load(); };
  const remind = async () => { const r = await api('/billing/reminders/run', { method: 'POST', body: {} }); setMsg(r.ok ? `${r.data.sent} rappel(s) envoyé(s)` : `Refusé : ${r.error}`); };

  const cur = cfg?.currency ?? 'XAF';
  return (
    <Shell>
      <h1>Paiements</h1>
      <p role="status">{msg}</p>
      {cfg && <p>Devise : {cur} · Mode : {cfg.mode}</p>}
      {staff && stats && <p>Facturé {money(stats.billed, cur, digits(cur))} · Encaissé {money(stats.collected, cur, digits(cur))} · Reste {money(stats.outstanding, cur, digits(cur))} · Recouvrement {stats.rate} % <button onClick={remind}>Envoyer les rappels</button></p>}
      {!staff && cfg && (
        <p><label>Mode de paiement <select value={method} onChange={(e) => setMethod(e.target.value)}>{cfg.methods.filter((m: any) => ['mobile_money', 'card'].includes(m.kind)).map((m: any) => <option key={m.code} value={m.code}>{m.label ?? m.code}</option>)}</select></label>{' '}
          <label>Téléphone <input value={payer} onChange={(e) => setPayer(e.target.value)} inputMode="tel" /></label></p>
      )}
      {last && <p>{last.instructions} {cfg?.mode === 'sandbox' && <button onClick={simulate}>Simuler la confirmation de l’opérateur</button>}</p>}
      <ul>{invoices.map((i) => (
        <li key={i.id}><strong>{i.number}</strong> {i.student ?? `${i.first_name} ${i.last_name}`} — {i.label} — {money(i.net_minor, i.currency, digits(i.currency))} (reste {money(i.outstanding_minor, i.currency, digits(i.currency))}) <em>{i.status}</em>
          <ul>{i.installments.map((x: any) => <li key={x.seq}>#{x.seq} {x.due_on} : {money(x.paid_minor, i.currency, digits(i.currency))} / {money(x.amount_minor, i.currency, digits(i.currency))}</li>)}</ul>
          {!staff && i.outstanding_minor > 0 && <button onClick={() => pay(i)}>Payer le solde</button>}
          {i.payments?.filter((p: any) => p.status === 'succeeded').map((p: any) => <button key={p.id} onClick={() => openPdf(`/payments/${p.id}/receipt`)} style={{ marginLeft: 8 }}>Reçu</button>)}
        </li>))}
      </ul>
      {staff && (
        <fieldset><legend>Enregistrer un paiement (espèces, chèque, virement)</legend>
          <select aria-label="facture" value={manual.invoice_id} onChange={(e) => setManual({ ...manual, invoice_id: e.target.value })}><option value="">Facture…</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.number}</option>)}</select>{' '}
          <select aria-label="mode" value={manual.method} onChange={(e) => setManual({ ...manual, method: e.target.value })}><option value="cash">Espèces</option><option value="cheque">Chèque</option><option value="bank_transfer">Virement</option></select>{' '}
          <input aria-label="montant" placeholder={`Montant (${digits(cur) === 0 ? 'unités' : 'centimes'})`} value={manual.amount_minor} onChange={(e) => setManual({ ...manual, amount_minor: e.target.value })} />{' '}
          <input aria-label="référence" placeholder="N° chèque / virement / QR" value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} />{' '}
          <button onClick={record} disabled={!manual.invoice_id || !manual.amount_minor}>Enregistrer</button>
        </fieldset>
      )}
    </Shell>
  );
}
