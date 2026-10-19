/**
 * 🧮 Calculs financiers : acomptes, solde, commission L'ArtBo, part partenaire, net.
 */
import { byId } from './selectors.js';
import { S } from './state.js';

export function paymentsOf(showId){ return S.db.show_payments.filter(p=>p.show_id===showId).sort((a,b)=>(a.sort||0)-(b.sort||0)); }

export function payAmount(p){
  if (p.amount!=null && p.amount!=='') return Number(p.amount);
  const s = byId('shows', p.show_id); const fee = Number(s?.fee_ht)||0;
  if (p.kind==='artbo')   return Math.round(fee * (Number(p.pct ?? s.artbo_pct)||0)) / 100;
  if (p.kind==='partner') return Math.round(fee * (Number(s.artbo_pct)||0) * (Number(p.pct ?? s.partner_pct)||0) / 100) / 100;
  if (p.kind==='cnm' || p.pct==null || p.pct==='') return null;
  return Math.round(fee * Number(p.pct)) / 100;
}

export function netArtbo(s){
  const pays = paymentsOf(s.id);
  const a = pays.filter(p=>p.kind==='artbo').reduce((t,p)=>t+(payAmount(p)||0),0);
  const b = pays.filter(p=>p.kind==='partner').reduce((t,p)=>t+(payAmount(p)||0),0);
  return a-b;
}

export function payPct(p){
  const s = byId('shows', p.show_id);
  if (p.pct!=null) return p.pct;
  if (p.kind==='artbo') return s?.artbo_pct;
  if (p.kind==='partner') return s?.partner_pct;
  return null;
}

/** TVA : 5,5 % sur les cachets (cession, co-réalisation…), 20 % sur les commissions. Modifiable par date / par ligne. */
export const showVat = s => s?.vat_rate ?? 5.5;
/** TVA d'une ligne. En production, la commission L'ArtBo n'est pas facturée (L'ArtBo se la verse) : pas de TVA. */
export const selfPaidCommission = p => p.kind === 'artbo' && byId('shows', p.show_id)?.prod_mode !== 'booking';
export const payVat = p => selfPaidCommission(p) ? 0 : p.vat_rate ?? (['artbo','partner'].includes(p.kind) ? 20 : showVat(byId('shows', p.show_id)));
export const ttc = (ht, rate) => ht==null ? null : Math.round(ht * (1 + (Number(rate)||0)/100) * 100) / 100;

/** Lignes qui facturent le cachet (acomptes, solde) : ensemble, 100 % du cachet au plus. Commissions, taxe CNM et « autres » à part. */
export const BILL_KINDS = ['acompte', 'solde'];
const r2 = n => Math.round(n * 100) / 100;
/** % du cachet d'une ligne : saisi, ou déduit du montant HT saisi */
export function billPct(p){
  const fee = Number(byId('shows', p.show_id)?.fee_ht) || 0;
  if (p.amount != null && p.amount !== '' && fee) return Number(p.amount) / fee * 100;   // montant saisi : il fait foi
  return p.pct != null && p.pct !== '' ? Number(p.pct) : null;
}
/** Total des factures d'une date face au cachet */
export function billingOf(s){
  const lines = paymentsOf(s.id).filter(p => BILL_KINDS.includes(p.kind));
  const sum = (list, f) => r2(list.reduce((t, p) => t + (f(p) || 0), 0));
  const ht = sum(lines, payAmount), fee = Number(s.fee_ht) || 0;
  return {lines, ht, ttc: sum(lines, p => ttc(payAmount(p), payVat(p))), fee, feeTtc: ttc(fee, showVat(s)) || 0,
    pct: fee ? r2(ht / fee * 100) : 0, gap: r2(fee - ht),
    sentHt: sum(lines.filter(p => p.sent_at), payAmount), paidHt: sum(lines.filter(p => p.paid_at), payAmount),
    otherHt: sum(paymentsOf(s.id).filter(p => p.kind === 'autre'), payAmount)};
}
