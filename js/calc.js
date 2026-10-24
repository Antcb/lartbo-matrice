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

/** Facture émise (CONVENTIONS §6.3–6.4, Q4) : envoyée, payée, numérotée ou liée à Pennylane.
 *  Une facture émise n'est jamais modifiée automatiquement ni silencieusement. SEULE définition à utiliser. */
export const isInvoiced = p => !!(p && (p.sent_at || p.paid_at || p.invoice_number || p.pennylane_id));
/** Ce qui rend une facture « émise » : une fois rempli, aucun de ces champs ne s'efface (sinon la facture se déverrouillerait).
 *  Même règle côté base : déclencheur show_payments_emitted_guard (supabase/migrations/2026-10-24_v1.40_factures_emises.sql). */
export const EMITTED_FIELDS = ['sent_at', 'paid_at', 'invoice_number', 'pennylane_id'];
/** Solde déjà facturé : les acomptes de la date ne peuvent plus changer (§6.4) */
export const soldeInvoiced = showId => paymentsOf(showId).some(p => p.kind === 'solde' && isInvoiced(p));
/** Pourquoi une ligne de facturation ne peut plus changer ('' = modifiable) */
export function billLockReason(p){
  if (!p) return '';
  if (isInvoiced(p)) return 'Facture déjà émise (envoyée, numérotée, dans Pennylane ou payée) : elle ne se modifie plus.';
  if (p.kind === 'acompte' && soldeInvoiced(p.show_id)) return 'Le solde de cette date est déjà facturé : les acomptes ne peuvent plus changer.';
  return '';
}

const sameVal = (a, b) => (a == null || a === '' ? null : Number.isFinite(Number(a)) ? Number(a) : a) === (b == null || b === '' ? null : Number.isFinite(Number(b)) ? Number(b) : b);
/** GARDE-FOU CENTRAL (appelé par data.save pour TOUT enregistrement) : refuse un changement qui modifierait une facture émise,
 *  directement (montant, %, TVA de la ligne) ou par la date dont son montant dépend (cachet, TVA, % de commission ou de partenaire).
 *  patch = null : SUPPRESSION (appel de data.remove) — une ligne verrouillée, ou une date qui porte une facture émise
 *  (la base efface en chaîne ses factures et son budget), ne se supprime pas.
 *  Renvoie le message à afficher, '' si le changement est permis. CONVENTIONS §6.3–6.5 (Q4, Q5). */
/** Pièce gardée « à rattacher » (facture de vente déposée sans ligne sûre) : pas encore référencée par une ligne */
const pieceFree = a => !S.db.show_payments.some(p => p.file_path === a.path) && !S.db.budget_lines.some(l => l.file_path === a.path);
export const pieceShowId = a => (/^budget\/([^/]+)\//.exec(a.path || '') || [])[1];
/** Pièces à rattacher d'une date */
export const piecesToAttach = s => !s ? [] : S.db.attachments.filter(a => pieceShowId(a) === s.id && pieceFree(a));
/** Toutes les pièces à rattacher (dates supprimées ou hors de la liste Production comprises : jamais introuvables) */
export const allPiecesToAttach = () => S.db.attachments.filter(a => { const id = pieceShowId(a); return id && !id.startsWith('projet-') && pieceFree(a); });

export function changeBlocked(table, id, patch){
  if (patch === null){
    if (table === 'show_payments'){ const why = billLockReason(byId('show_payments', id)); return why && why.replace('ne se modifie plus', 'ne se supprime pas').replace('ne peuvent plus changer', 'ne se suppriment plus'); }
    if (table === 'shows' && paymentsOf(id).some(isInvoiced)) return 'Cette date a des factures émises : elle ne se supprime pas (ses factures et son budget seraient effacés avec elle).';
    // pièces gardées « à rattacher » : la date ne se supprime pas tant qu'elles n'ont pas été rattachées (décision d'Anthony du 25/10)
    if (table === 'shows'){ const n = piecesToAttach(byId('shows', id)).length;
      if (n) return `Cette date a ${n} pièce${n > 1 ? 's' : ''} à rattacher (onglet Factures) : rattache-${n > 1 ? 'les' : 'la'} avant de supprimer la date.`; }
    return '';
  }
  if (!patch) return '';
  if (table === 'show_payments'){
    const row = byId('show_payments', id);
    if (!row) return '';
    const blank = v => v == null || String(v).trim() === '';
    // facture émise : ni numéro, ni date d'envoi, ni date de paiement, ni identifiant Pennylane ne s'efface (pas de déverrouillage)
    if (isInvoiced(row) && EMITTED_FIELDS.some(k => k in patch && !blank(row[k]) && blank(patch[k])))
      return 'Facture déjà émise : son numéro, sa date d’envoi, sa date de paiement et son identifiant Pennylane ne s’effacent pas (une régularisation se décide à part).';
    if (!['amount', 'pct', 'vat_rate', 'show_id', 'kind'].some(k => k in patch && !sameVal(patch[k], row[k]))) return '';
    return billLockReason(row);
  }
  if (table === 'shows' && ['fee_ht', 'vat_rate', 'artbo_pct', 'partner_pct', 'prod_mode'].some(k => k in patch)){   // prod_mode : TVA de la commission
    const s = byId('shows', id), lines = s ? paymentsOf(id).filter(isInvoiced) : [];
    if (!lines.length) return '';
    const values = () => JSON.stringify(lines.map(p => { const a = payAmount(p); return [a, ttc(a, payVat(p))]; }));
    const before = values(), keep = {};
    Object.keys(patch).forEach(k => { keep[k] = s[k]; });
    Object.assign(s, patch);
    const after = values();
    Object.assign(s, keep);                                   // simulation seulement : la date reste inchangée
    if (before !== after) return 'Des factures de cette date sont déjà émises : ce changement (cachet, TVA, % ou mode booking / production) modifierait leur montant. Il est refusé ; une régularisation se décide à part.';
  }
  return '';
}

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
