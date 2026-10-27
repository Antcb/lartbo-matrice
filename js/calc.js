/**
 * 🧮 Calculs financiers : acomptes, solde, commission L'ArtBo, part partenaire, net.
 */
import { byId } from './selectors.js';
import { S } from './state.js';

/** Lignes financières d'une date QUI COMPTENT : une ligne « hors calcul » (coproduction, import — v1.44) est gardée pour la traçabilité
 *  mais n'entre dans aucun calcul, indicateur, compte, rappel ni opération Pennylane. Même règle côté base : payment_is_emitted, rappels. */
export const counted = p => !!p && (p.hors_calcul == null || p.hors_calcul === '');
export function paymentsOf(showId){ return allPaymentsOf(showId).filter(counted); }
/** Toutes les lignes, y compris hors calcul (affichage de traçabilité seulement) */
export function allPaymentsOf(showId){ return S.db.show_payments.filter(p=>p.show_id===showId).sort((a,b)=>(a.sort||0)-(b.sort||0)); }
/** Coproduction (décision d'Anthony du 27/10/2026) : ni facture de cession, ni acompte, ni solde, ni commission générés ;
 *  seules ses opérations réelles, ajoutées à la main, comptent. Même règle côté base : on_show_confirmed, ensure_production_payments. */
export const isCoproduction = s => s?.contract_type === 'Co-Production';

export function payAmount(p){
  if (p.amount!=null && p.amount!=='') return Number(p.amount);
  const s = byId('shows', p.show_id); const fee = Number(s?.fee_ht)||0;
  // production : solde pas encore facturé = cession − acomptes EFFECTIVEMENT facturés (règle d'Anthony du 26/10, lot C1).
  // Un acompte seulement prévu ne le réduit pas. Un solde facturé garde son montant (jamais recalculé, §6.4).
  if (p.kind==='solde' && s && !isBookingShow(s) && !isInvoiced(p)) return soldeDue(p.show_id, p.id);
  if (p.kind==='artbo')   return Math.round(fee * (Number(p.pct ?? s.artbo_pct)||0)) / 100;
  if (p.kind==='partner') return Math.round(fee * (Number(s.artbo_pct)||0) * (Number(p.pct ?? s.partner_pct)||0) / 100) / 100;
  if (p.kind==='cnm' || p.pct==null || p.pct==='') return null;
  return Math.round(fee * Number(p.pct)) / 100;
}

/**
 * Commission de PRODUCTION (lot D1, option B décidée par Anthony le 27/10) : un montant TOTAL dû (la ligne, unique par date)
 * et l'historique des VERSEMENTS réels (table commission_transfers : montant, date, référence).
 *  - déjà transféré = somme des versements ; reste = total − déjà transféré ; « versée » seulement quand le reste est nul ;
 *  - commission marquée versée avant ce lot, sans versement détaillé : versée en totalité à sa date (compatibilité).
 * Même règle côté base : commission_total, commission_transferred, déclencheurs de la migration v1.43.
 */
export const transfersOf = payId => (S.db.commission_transfers || []).filter(t => t.payment_id === payId)
  .sort((a, b) => String(a.transferred_at).localeCompare(String(b.transferred_at)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
export const isProdCommission = p => !!p && p.kind === 'artbo' && !isBookingShow(byId('shows', p.show_id));
export function commissionState(p){
  const total = Math.round((payAmount(p) || 0) * 100) / 100, list = p ? transfersOf(p.id) : [];
  const legacy = !list.length && !!p?.paid_at;
  const transferred = legacy ? total : Math.round(list.reduce((t, x) => t + Number(x.amount || 0), 0) * 100) / 100;
  const remaining = Math.max(0, Math.round((total - transferred) * 100) / 100);
  return {total, transferred, remaining, transfers: list, legacy, full: transferred > 0 && remaining < 0.005, partial: transferred > 0 && remaining >= 0.005};
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

/** Montant PRÉVU au contrat (échéancier : fiche, mail, contrat) : saisi, ou % prévu × cachet — jamais le solde recalculé */
export function planAmount(p){
  if (p.amount!=null && p.amount!=='') return Number(p.amount);
  const fee = Number(byId('shows', p.show_id)?.fee_ht)||0;
  return p.pct==null || p.pct==='' ? null : Math.round(fee * Number(p.pct)) / 100;
}

/** Date en booking : L'ArtBo n'est qu'agent (règle d'Anthony du 26/10) */
export const isBookingShow = s => s?.prod_mode === 'booking';
/** Ligne suivie par L'ArtBo. En booking, seules sa commission et la part partenaire : les acomptes / soldes sont les factures de
 *  l'artiste à l'organisateur, gardés en base pour l'historique mais hors de tout affichage, calcul, relance ou rattachement. */
export const tracked = p => !!p && !(isBookingShow(byId('shows', p.show_id)) && !['artbo', 'partner'].includes(p.kind));

/** TVA : 5,5 % sur les cachets (cession, co-réalisation…), 20 % sur les commissions. Modifiable par date / par ligne. */
export const showVat = s => s?.vat_rate ?? 5.5;
/** TVA d'une ligne. En production, la commission L'ArtBo n'est pas facturée (L'ArtBo se la verse) : pas de TVA. */
export const selfPaidCommission = p => p.kind === 'artbo' && byId('shows', p.show_id)?.prod_mode !== 'booking';
export const payVat = p => selfPaidCommission(p) ? 0 : p.vat_rate ?? (['artbo','partner'].includes(p.kind) ? 20 : showVat(byId('shows', p.show_id)));
export const ttc = (ht, rate) => ht==null ? null : Math.round(ht * (1 + (Number(rate)||0)/100) * 100) / 100;

/** Facture émise (CONVENTIONS §6.3–6.4, Q4) : envoyée, payée, numérotée ou liée à Pennylane.
 *  Une facture émise n'est jamais modifiée automatiquement ni silencieusement. SEULE définition à utiliser.
 *  Exception (lot C1, décision du 26/10) : la commission d'une date en PRODUCTION n'est pas une facture (L'ArtBo se la verse) ;
 *  seul son versement (date) la fige — un ancien numéro saisi (celui de la facture d'acompte) ne la rend pas « émise ». */
const filled = v => v != null && String(v).trim() !== '';   // comme la base (btrim) : un numéro fait d'espaces ne compte pas
export const isInvoiced = p => !!(p && (selfPaidCommission(p) ? filled(p.paid_at) : EMITTED_FIELDS.some(k => filled(p[k]))));
/** Ce qui rend une facture « émise » : une fois rempli, aucun de ces champs ne s'efface (sinon la facture se déverrouillerait).
 *  Même règle côté base : déclencheur show_payments_emitted_guard (supabase/migrations/2026-10-24_v1.40_factures_emises.sql). */
export const EMITTED_FIELDS = ['sent_at', 'paid_at', 'invoice_number', 'pennylane_id'];
/** Date « engagée » : une de ses lignes porte une opération enregistrée (quel que soit le mode). Son mode ne change plus,
 *  ni directement ni par l'artiste (lot D1). Même règle côté base : show_has_financial_record. */
export const hasFinancialRecord = showId => paymentsOf(showId).some(p => EMITTED_FIELDS.some(k => filled(p[k])) || (p.kind === 'artbo' && transfersOf(p.id).length > 0));   // un versement de commission engage aussi la date (v1.43)
/** Champs qui figent une ligne : commission de production = seulement sa date de versement */
export const emittedFieldsOf = p => selfPaidCommission(p) ? ['paid_at'] : EMITTED_FIELDS;
/** Acompte : 'facture' (émis), 'prevu' (au contrat, pas encore facturé), 'caduc' (jamais facturé alors que le solde l'est :
 *  plus réclamé, historique gardé) ; '' pour les autres lignes */
export const acompteState = p => p?.kind !== 'acompte' ? '' : isInvoiced(p) ? 'facture' : soldeInvoiced(p.show_id) ? 'caduc' : 'prevu';
/** Solde à facturer d'une date de production : cession − acomptes effectivement facturés (jamais négatif).
 *  Protection (plusieurs lignes de solde sur une date, cas anormal que l'application ne crée pas) : les autres soldes émis ou
 *  saisis sont déduits, et seul le PREMIER solde calculé reçoit le reste — la cession n'est jamais comptée deux fois. */
export function soldeDue(showId, id = null){
  const pays = paymentsOf(showId), fee = Number(byId('shows', showId)?.fee_ht) || 0;
  const done = pays.filter(p => p.kind === 'acompte' && isInvoiced(p)).reduce((t, p) => t + (payAmount(p) || 0), 0);
  const me = id && pays.find(p => p.id === id), others = pays.filter(p => p.kind === 'solde' && p.id !== id);
  const computed = q => !isInvoiced(q) && (q.amount == null || q.amount === '');
  const before = q => (q.sort || 0) < (me.sort || 0) || ((q.sort || 0) === (me.sort || 0) && String(q.id) < String(me.id));
  if (me && others.some(q => computed(q) && before(q))) return 0;
  const fixed = others.filter(q => !computed(q)).reduce((t, q) => t + (payAmount(q) || 0), 0);
  return Math.max(0, Math.round((fee - done - fixed) * 100) / 100);
}
/** Plusieurs lignes de solde sur une date : anomalie signalée (jamais corrigée automatiquement) */
export const multiSolde = showId => paymentsOf(showId).filter(p => p.kind === 'solde').length > 1;
/** Solde déjà facturé : les acomptes de la date ne peuvent plus changer (§6.4) */
export const soldeInvoiced = showId => paymentsOf(showId).some(p => p.kind === 'solde' && isInvoiced(p));
/** Pourquoi une ligne de facturation ne peut plus changer ('' = modifiable) */
export function billLockReason(p){
  if (!p) return '';
  if (isInvoiced(p)) return selfPaidCommission(p) ? 'Commission déjà versée : elle ne se modifie plus.' : 'Facture déjà émise (envoyée, numérotée, dans Pennylane ou payée) : elle ne se modifie plus.';
  if (p.kind === 'acompte' && soldeInvoiced(p.show_id)) return 'Le solde de cette date est déjà facturé : les acomptes ne peuvent plus changer.';
  // commission de production versée en partie (lot D1) : son total est figé dès le premier versement (base : show_payments_commission_lock)
  if (p.kind === 'artbo' && transfersOf(p.id).length) return 'Commission en partie versée : son montant total ne se modifie plus (note les versements restants).';
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

/** Lignes dont le montant est figé dès qu'elles sont émises / versées (lot D1) : la CNM n'a pas de montant calculé */
export const FROZEN_KINDS = ['acompte', 'solde', 'autre', 'artbo', 'partner'];
/**
 * Complément d'un enregistrement (appelé par data.save) : quand une ligne DEVIENT émise ou versée — facture d'acompte / de solde
 * envoyée, payée, numérotée ou liée à Pennylane ; commission ou part partenaire versée — son montant calculé à ce moment-là est
 * enregistré et ne bougera plus jamais, même si le cachet ou un % change ensuite (lot C1 pour le solde, lot D1 pour toutes).
 * Un montant déjà saisi à la main est gardé tel quel. Même règle côté base : déclencheur show_payments_freeze (migration v1.42).
 */
export function freezeOnEmit(table, id, patch){
  if (table !== 'show_payments' || !patch) return {};
  const row = byId('show_payments', id);
  if (!row || !FROZEN_KINDS.includes(row.kind) || isInvoiced(row) || (row.amount != null && row.amount !== '') || 'amount' in patch) return {};
  if (!isInvoiced({...row, ...patch})) return {};
  const s = byId('shows', row.show_id);
  if (s?.fee_ht == null || s.fee_ht === '') return {};   // cession pas encore saisie : rien à figer (jamais un montant figé à 0 €)
  if (row.kind === 'solde' && multiSolde(row.show_id)) return {};   // plusieurs soldes (anomalie signalée) : rien n'est figé automatiquement
  const amount = row.kind === 'solde' && !isBookingShow(s) ? soldeDue(row.show_id, row.id) : payAmount(row);
  return amount == null ? {} : {amount};
}
/** Date qui a des lignes déjà émises ou versées : un changement de cachet / % / mode mérite un avertissement (lot D1) */
export const emittedLinesOf = showId => paymentsOf(showId).filter(p => FROZEN_KINDS.includes(p.kind) && (isInvoiced(p) || (p.kind === 'artbo' && transfersOf(p.id).length)));

export function changeBlocked(table, id, patch){
  if (patch === null){
    if (table === 'show_payments' && !counted(byId('show_payments', id))) return 'Ligne hors calcul (gardée pour la traçabilité) : elle ne se supprime pas.';
    if (table === 'shows' && allPaymentsOf(id).some(p => !counted(p))) return 'Cette date garde des lignes hors calcul (traçabilité) : elle ne se supprime pas.';
    if (table === 'show_payments'){ const why = billLockReason(byId('show_payments', id)); return why && why.replace('ne se modifie plus', 'ne se supprime pas').replace('ne peuvent plus changer', 'ne se suppriment plus'); }
    // comme la base : lors de la suppression en chaîne, la date n'existe plus pour le déclencheur, qui applique la définition
    // complète — une commission de production numérotée (historique) empêche donc aussi la suppression de sa date
    if (table === 'shows' && hasFinancialRecord(id)) return 'Cette date a des factures émises : elle ne se supprime pas (ses factures et son budget seraient effacés avec elle).';
    // pièces gardées « à rattacher » : la date ne se supprime pas tant qu'elles n'ont pas été rattachées (décision d'Anthony du 25/10)
    if (table === 'shows'){ const n = piecesToAttach(byId('shows', id)).length;
      if (n) return `Cette date a ${n} pièce${n > 1 ? 's' : ''} à rattacher (onglet Factures) : rattache-${n > 1 ? 'les' : 'la'} avant de supprimer la date.`; }
    return '';
  }
  if (!patch) return '';
  if (table === 'show_payments'){
    const row = byId('show_payments', id);
    if (!row) return '';
    if (!counted(row)) return 'Ligne hors calcul (gardée pour la traçabilité) : elle ne se modifie plus.';
    const blank = v => v == null || String(v).trim() === '';
    // facture émise : ni numéro, ni date d'envoi, ni date de paiement, ni identifiant Pennylane ne s'efface (pas de déverrouillage)
    // commission de production versée en partie (lot D1) : « versée » seulement quand tout est transféré — une date de versement
    // ne remplace pas le versement du reste. Même règle côté base : show_payments_commission_lock (migration v1.43)
    if (isProdCommission(row) && transfersOf(row.id).length && 'paid_at' in patch && !blank(patch.paid_at) && blank(row.paid_at)){
      const st = commissionState(row);
      if (st.remaining >= 0.005) return `Commission versée en partie : note le versement du reste (${st.remaining.toFixed(2).replace('.', ',')} €) au lieu d’une date de versement.`;
    }
    if (isInvoiced(row) && emittedFieldsOf(row).some(k => k in patch && !blank(row[k]) && blank(patch[k])))
      return 'Facture déjà émise : son numéro, sa date d’envoi, sa date de paiement et son identifiant Pennylane ne s’effacent pas (une régularisation se décide à part).';
    // acompte caduc (date de production dont le solde est déjà facturé, lot C1) : il ne s'émet plus — sinon la date serait facturée
    // au-delà de sa cession. Même règle côté base : déclencheur show_payments_caduc_guard (migration v1.41 acompte caduc)
    if (!isBookingShow(byId('shows', row.show_id)) && acompteState(row) === 'caduc' && isInvoiced({...row, ...patch}))
      return 'Acompte caduc : le solde de cette date est déjà facturé, cet acompte ne se facture plus (il dépasserait la cession). Une régularisation se décide à part.';
    if (!['amount', 'pct', 'vat_rate', 'show_id', 'kind'].some(k => k in patch && !sameVal(patch[k], row[k]))) return '';
    return billLockReason(row);
  }
  // mode d'une date engagée (lot D1, décisions du 26/10) : jamais changé — même définition large que la suppression d'une date.
  // Même règle côté base : shows_frozen_guard, project_mode_to_shows, show_follow_project_mode (show_has_financial_record)
  if (table === 'shows' && 'prod_mode' in patch && !sameVal(patch.prod_mode, byId('shows', id)?.prod_mode) && hasFinancialRecord(id))
    return 'Cette date a des opérations financières enregistrées (facture, versement, numéro ou lien Pennylane) : son mode booking / production ne change plus. Une régularisation se décide à part.';
  // TVA d'une date (lot D1, point 7) : refusée dès qu'une facture émise dépend de la TVA de la date (ligne sans TVA propre,
  // hors commissions et parts à 20 %) — même règle que la base (shows_frozen_guard), même si le TTC calculé ne change pas
  if (table === 'shows' && 'vat_rate' in patch && !sameVal(patch.vat_rate, byId('shows', id)?.vat_rate)
      && paymentsOf(id).some(p => isInvoiced(p) && !filled(p.vat_rate) && !['artbo', 'partner'].includes(p.kind)))
    return 'Des factures de cette date sont déjà émises avec la TVA de la date : la TVA ne change plus (leur montant TTC changerait). Une régularisation se décide à part.';
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
/** % du cachet d'une ligne AU CONTRAT : saisi, ou déduit du montant HT saisi (conditions, mail, fiche, contrat) */
export function billPct(p){
  const fee = Number(byId('shows', p.show_id)?.fee_ht) || 0;
  if (p.amount != null && p.amount !== '' && fee) return Number(p.amount) / fee * 100;   // montant saisi : il fait foi
  return p.pct != null && p.pct !== '' ? Number(p.pct) : null;
}
/** Solde de production pas encore émis : son montant est calculé (cession − acomptes facturés, lot C1) */
export const soldeComputed = p => !!p && p.kind === 'solde' && !isInvoiced(p) && (p.amount == null || p.amount === '') && !isBookingShow(byId('shows', p.show_id));
/** % RÉEL d'une ligne dans l'onglet Factures : pour un solde calculé, sa part effective (pas le % prévu au contrat) */
export function billedPct(p){
  if (!soldeComputed(p)) return billPct(p);
  const fee = Number(byId('shows', p.show_id)?.fee_ht) || 0;
  return fee ? payAmount(p) / fee * 100 : null;
}
/** Total des factures d'une date face au cachet */
export function billingOf(s){
  // acomptes prévus (pas encore facturés) ou caducs : hors du total facturé (ils ne réduisent pas le solde, lot C1)
  const all = paymentsOf(s.id).filter(p => BILL_KINDS.includes(p.kind));
  const lines = all.filter(p => p.kind !== 'acompte' || isInvoiced(p));
  const planned = all.filter(p => acompteState(p) === 'prevu'), lapsed = all.filter(p => acompteState(p) === 'caduc');
  const sum = (list, f) => r2(list.reduce((t, p) => t + (f(p) || 0), 0));
  const ht = sum(lines, payAmount), fee = Number(s.fee_ht) || 0;
  return {lines, ht, ttc: sum(lines, p => ttc(payAmount(p), payVat(p))), fee, feeTtc: ttc(fee, showVat(s)) || 0,
    pct: fee ? r2(ht / fee * 100) : 0, gap: r2(fee - ht),
    sentHt: sum(lines.filter(p => p.sent_at), payAmount), paidHt: sum(lines.filter(p => p.paid_at), payAmount),
    otherHt: sum(paymentsOf(s.id).filter(p => p.kind === 'autre'), payAmount),
    planned, plannedHt: sum(planned, planAmount), lapsed, lapsedHt: sum(lapsed, planAmount)};
}

/**
 * Indicateurs financiers (décision d'Anthony du 26/10, lot C1) — à ne JAMAIS additionner entre eux :
 *  ① resteProd : reste à encaisser sur les contrats de production = Σ (cession − encaissé), par date ;
 *  ② impayesProd : factures d'acompte / de solde de production émises et non réglées ;
 *  ③ commissionsBooking : factures de commission booking émises et non réglées.
 * Les factures de l'artiste sur une date booking n'entrent dans aucun des trois.
 */
export function financeOf(shows){
  const out = {resteProd: 0, impayesProd: 0, commissionsBooking: 0, datesProd: 0, factures: 0, commissions: 0};
  for (const s of shows){
    const pays = paymentsOf(s.id);
    if (isBookingShow(s)){
      const due = pays.filter(p => p.kind === 'artbo' && isInvoiced(p) && !p.paid_at);
      out.commissionsBooking += due.reduce((t, p) => t + (payAmount(p) || 0), 0); out.commissions += due.length;
      continue;
    }
    const bill = pays.filter(p => BILL_KINDS.includes(p.kind));
    const cashed = bill.filter(p => p.paid_at).reduce((t, p) => t + (payAmount(p) || 0), 0);
    // coproduction : pas de cession à encaisser ; seules ses factures réelles (s'il y en a) restent à encaisser (27/10/2026)
    out.resteProd += isCoproduction(s) ? bill.filter(p => !p.paid_at).reduce((t, p) => t + (payAmount(p) || 0), 0) : Math.max(0, (Number(s.fee_ht) || 0) - cashed); out.datesProd++;
    const due = bill.filter(p => isInvoiced(p) && !p.paid_at);
    out.impayesProd += due.reduce((t, p) => t + (payAmount(p) || 0), 0); out.factures += due.length;
  }
  for (const k of ['resteProd', 'impayesProd', 'commissionsBooking']) out[k] = r2(out[k]);
  return out;
}
