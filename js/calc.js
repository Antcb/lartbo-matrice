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
export const payVat = p => p.vat_rate ?? (['artbo','partner'].includes(p.kind) ? 20 : showVat(byId('shows', p.show_id)));
export const ttc = (ht, rate) => ht==null ? null : Math.round(ht * (1 + (Number(rate)||0)/100) * 100) / 100;
