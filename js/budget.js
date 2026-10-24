/**
 * 💶 Budget d'une date et compte dédié d'un artiste.
 *
 * Une date en production : le cachet HT arrive sur le compte dédié (ex. « Compte The Locos L'ArtBo »),
 * on en retire la commission L'ArtBo et les dépenses (HT ; salaires : coût total), le reste revient à l'artiste
 * (ligne « Solde artiste », versée à Pipi pour The Locos).
 * Chaque ligne a un montant prévu (saisi ou calculé) et un montant réel (lu sur la pièce) ; elle est « payée » quand paid_at est rempli.
 * Une date cochée « booking uniquement » (prod_mode = booking) n'a pas de budget : seulement la facture de commission.
 */
import { payAmount, paymentsOf } from './calc.js';
import { CONFIRMED_PROD } from './constants.js';
import { byId, setting, showsOfProject } from './selectors.js';
import { S } from './state.js';

const num = v => v==null || v==='' ? null : Number(v);
const r2 = n => Math.round(n * 100) / 100;

export const isProdShow = s => !!s && s.prod_mode !== 'booking';
export const isFree = s => /gratuit/i.test(s?.ticketing_type || '');
/** Date à l'étranger : département remplacé par un code pays (CH, BE…) ou structure hors de France */
export const isAbroad = s => { const d = String(s?.department || '').trim().toUpperCase(), c = byId('structures', s?.structure_id)?.country;
  if (d) return /^[A-Z]{2,}$/.test(d) && !/^2[AB]$/.test(d);   // le département du concert fait foi
  return !!c && !/^france$/i.test(c); };
/** Taxe CNM due : entrée gratuite, en France */
export const cnmDue = s => isFree(s) && !isAbroad(s);
export const payslipCost = () => num(setting('movinmotion_payslip_cost')) ?? 20.3;
export const cnmPct = () => num(setting('default_cnm_pct')) ?? 3.5;

export const linesOf = showId => S.db.budget_lines.filter(l => l.show_id === showId).sort((a,b) => (a.sort||0)-(b.sort||0) || (a.created_at||'').localeCompare(b.created_at||''));
export const offLinesOf = projectId => S.db.budget_lines.filter(l => !l.show_id && l.project_id === projectId).sort((a,b) => (a.doc_date||'').localeCompare(b.doc_date||'') || (a.created_at||'').localeCompare(b.created_at||''));

export const commissionOf = s => paymentsOf(s.id).find(p => p.kind === 'artbo');
export const commissionAmount = s => { const p = commissionOf(s); return p ? payAmount(p) || 0 : r2((Number(s.fee_ht)||0) * (Number(s.artbo_pct ?? 15)||0) / 100); };

/** Ligne de solde artiste (automatique ou ajoutée à la main / par une pièce) : comptée une seule fois, dans le solde */
export const isSolde = l => l.auto === 'solde_artiste' || l.category === 'Solde artiste';

const staffQty = showId => linesOf(showId).filter(l => l.category === 'Staff').reduce((t,l) => t + (Number(l.qty)||0), 0);

/** Montant prévu HT d'une ligne (saisi, ou calculé pour les lignes automatiques) */
export function lineForecast(l){
  if (l.forecast != null && !isSolde(l)) return Number(l.forecast);   // le solde artiste n'a pas de prévu saisi : c'est toujours le reste calculé
  if (!l.auto && l.qty != null && l.unit_cost != null) return r2(Number(l.qty) * Number(l.unit_cost));   // quantité × prix unitaire (salariés, salle, promoteur…)
  const s = byId('shows', l.show_id);
  if (l.auto === 'movinmotion' && s) return r2(payslipCost() * staffQty(s.id));
  if (l.auto === 'cnm' && s) return cnmDue(s) ? r2((Number(s.fee_ht)||0) * cnmPct() / 100) : 0;
  if (l.auto === 'solde_artiste' && s){   // ce qui reste du cachet, moins les autres soldes déjà notés
    const others = linesOf(s.id).filter(x => isSolde(x) && x.id !== l.id).reduce((t,x) => t + (x.amount != null ? Number(x.amount) : 0), 0);   // les autres versements ne comptent que par leur montant saisi
    return Math.max(0, r2(availableForArtist(s) - others));
  }
  return null;
}
/** Montant retenu : le réel s'il est connu, sinon le prévu */
export const lineValue = l => l.amount != null ? Number(l.amount) : (lineForecast(l) || 0);
export const lineStatus = l => l.paid_at || l.reimbursed_at ? 'paid' : (l.doc_number || l.file_path || l.amount != null) ? 'doc' : 'planned';

/** Cachet − commission − dépenses (hors solde artiste) = ce qui peut revenir à l'artiste */
export function availableForArtist(s){
  const out = linesOf(s.id).filter(l => !isSolde(l)).reduce((t,l) => t + lineValue(l), 0);
  return (Number(s.fee_ht)||0) - commissionAmount(s) - out;
}

export function showBudget(s){
  const lines = linesOf(s.id);
  const fee = Number(s.fee_ht)||0, com = commissionAmount(s);
  const expenses = lines.filter(l => !isSolde(l)).reduce((t,l) => t + lineValue(l), 0);
  const solde = lines.filter(isSolde).reduce((t,l) => t + lineValue(l), 0);
  const forecastExp = lines.filter(l => !isSolde(l)).reduce((t,l) => t + (lineForecast(l) ?? (Number(l.amount)||0)), 0);
  const docs = lines.filter(l => lineValue(l) !== 0);
  return {fee, com, expenses: r2(expenses), forecastExp: r2(forecastExp), available: r2(fee - com - expenses), solde: r2(solde),
    result: r2(fee - com - expenses - solde), lines,
    docsIn: docs.filter(l => l.doc_number || l.file_path).length, docsAll: docs.length, paid: docs.filter(l => l.paid_at).length};
}

/** Dates d'un projet qui passent par le compte dédié (production, confirmées), toutes années */
export const prodShowsOf = projectId => showsOfProject(projectId).filter(s => CONFIRMED_PROD.includes(s.status) && isProdShow(s)).sort((a,b) => (a.date||'').localeCompare(b.date||''));

/** Mouvement réel d'une date (encaissement, paiement, remboursement) : il reste compté même si la date est annulée (audit A-05) */
const hasRealMove = s => paymentsOf(s.id).some(p => p.paid_at) || S.db.budget_lines.some(l => l.show_id === s.id && (l.paid_at || l.reimbursed_at));
/** Dates du compte dédié : confirmées en production, plus les dates non confirmées qui ont un mouvement réel (seuls leurs mouvements faits comptent) */
const accountShowsOf = projectId => showsOfProject(projectId).filter(s => isProdShow(s) && (CONFIRMED_PROD.includes(s.status) || hasRealMove(s)))
  .sort((a,b) => (a.date||'').localeCompare(b.date||''));
const confirmed = s => CONFIRMED_PROD.includes(s?.status);

/** Compte d'encaissement d'un acompte / solde : vide = « Non renseigné », jamais un compte supposé (CONVENTIONS §6.6, Q6) */
const payee = p => p.payee || null;
const isOwnProdShow = s => /^(Production|Co-Production)$/.test(s?.contract_type || '');
/** Ligne de budget qui passe par le compte dédié : hors date, ou date du compte (confirmée, ou avec un mouvement réel) */
const accountLineOk = l => { if (!l.show_id) return true; const sh = byId('shows', l.show_id);
  return isProdShow(sh) && !isOwnProdShow(sh) && (confirmed(sh) || l.paid_at || l.reimbursed_at); };

/**
 * Compte dédié : solde réel (ce qui est arrivé − ce qui est parti) et prévu en fin de tournée.
 * Entrées : acomptes / soldes encaissés (HT). Sorties : commission L'ArtBo virée, lignes payées par le compte,
 * avances (L'ArtBo, une personne) une fois remboursées ou déduites du compte. Payé par l'organisateur ou l'artiste : hors compte.
 */
export function accountOf(projectId){
  const p = byId('projects', projectId);
  const a = {opening: Number(p?.account_opening)||0, inDone:0, inTodo:0, outDone:0, outTodo:0, artboAdvance:0, byCat:{},
    unassignedDone:0, unassignedTodo:0};   // encaissements « compte non renseigné » : hors solde du compte, montrés à part (§6.6)
  // une date que L'ArtBo produit (contrat Production / Co-Production) a son propre budget : hors compte dédié de l'artiste
  const isOwnProd = s => /^(Production|Co-Production)$/.test(s?.contract_type || '');
  for (const s of accountShowsOf(projectId).filter(x => !isOwnProd(x))){
    const conf = confirmed(s);   // date non confirmée (annulée…) : seuls ses mouvements FAITS comptent
    for (const pay of paymentsOf(s.id)){
      const v = payAmount(pay) || 0;
      if (!conf && !pay.paid_at) continue;
      if (['acompte','solde','autre'].includes(pay.kind)){
        const who = payee(pay);
        if (who === 'compte') pay.paid_at ? a.inDone += v : a.inTodo += v;
        else if (!who) pay.paid_at ? a.unassignedDone += v : a.unassignedTodo += v;
      }
      if (pay.kind === 'artbo') pay.paid_at ? a.outDone += v : a.outTodo += v;
    }
    if (conf) a.byCat['Commission'] = (a.byCat['Commission']||0) + commissionAmount(s);
  }
  const lines = S.db.budget_lines.filter(l => l.project_id === projectId && accountLineOk(l));
  for (const l of lines){
    const v = lineValue(l);
    const conf = !l.show_id || confirmed(byId('shows', l.show_id));
    if (!conf && !(l.paid_at || l.reimbursed_at)) continue;
    if (conf) a.byCat[l.category || 'Autres'] = (a.byCat[l.category || 'Autres']||0) + v;
    // payé par le compte, ou avancé par L'ArtBo / une personne puis remboursé par le compte
    const payer = l.payer || 'compte';
    if (payer === 'compte') l.paid_at ? a.outDone += v : a.outTodo += v;
    else if (payer === 'artbo' || payer === 'autre'){
      // avance de L'ArtBo ou d'une personne : sort du compte quand elle est remboursée / déduite, sinon reste à payer
      if (l.reimbursed_at) a.outDone += v;
      else { a.outTodo += v; if (payer === 'artbo' && l.paid_at) a.artboAdvance += v; }
    }
  }
  Object.keys(a).forEach(k => typeof a[k] === 'number' && (a[k] = r2(a[k])));
  a.real = r2(a.opening + a.inDone - a.outDone);
  a.end = r2(a.real + a.inTodo - a.outTodo);
  return a;
}

/**
 * Mouvements réels du compte dédié, dans l'ordre des dates, avec le solde après chaque mouvement :
 * exactement ce que compte « solde réel » (à pointer avec le relevé de la banque).
 */
export function accountMoves(projectId){
  const p = byId('projects', projectId), moves = [];
  const isOwnProd = s => /^(Production|Co-Production)$/.test(s?.contract_type || '');
  const where = s => s ? `${s.venue || '?'} (${String(s.date || '').split('-').reverse().join('/')})` : 'hors date';
  for (const s of accountShowsOf(projectId).filter(x => !isOwnProd(x))){
    for (const pay of paymentsOf(s.id)){
      const v = payAmount(pay) || 0; if (!pay.paid_at || !v) continue;   // payee vide : « Non renseigné », pas un mouvement du compte
      if (['acompte','solde','autre'].includes(pay.kind) && payee(pay) === 'compte')
        moves.push({date: pay.paid_at, label: `${pay.label || pay.kind} — ${where(s)}`, amount: v, calc: pay.amount == null || pay.amount === ''});
      if (pay.kind === 'artbo') moves.push({date: pay.paid_at, label: `Commission L'ArtBo — ${where(s)}`, amount: -v, calc: pay.amount == null || pay.amount === ''});
    }
  }
  const lines = S.db.budget_lines.filter(l => l.project_id === projectId && accountLineOk(l));
  for (const l of lines){
    const payer = l.payer || 'compte', date = payer === 'compte' ? l.paid_at : (payer === 'artbo' || payer === 'autre') ? l.reimbursed_at : null;
    const v = lineValue(l); if (!date || !v) continue;
    moves.push({date, label: `${l.label || l.category || 'Dépense'}${l.supplier ? ' · ' + l.supplier : ''} — ${where(byId('shows', l.show_id))}${payer !== 'compte' ? ` (avance ${payerLabel(payer, p)} remboursée)` : ''}`, amount: -v, calc: l.amount == null});
  }
  moves.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  let bal = Number(p?.account_opening) || 0;
  for (const m of moves){ bal = r2(bal + m.amount); m.balance = bal; }
  return moves;
}

/** Libellés des payeurs pour un projet */
export function payerLabel(code, project){
  return ({compte: project?.account_name || 'Compte dédié', artbo: "L'ArtBo", artiste: project?.artist_payee || 'Artiste', organisateur: 'Organisateur', autre: 'Autre'})[code || 'compte'] || code;
}
