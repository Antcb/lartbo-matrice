/**
 * 🎟️ Budget de production : dates dont L'ArtBo est producteur (contrat « Production » ou « Co-Production »),
 * sur le modèle du tableau Cabaret Sauvage :
 *   billetterie (tarifs × quantités, droits de location) → recette HT → droits et taxes (CNM, SACEM, SACD)
 *   → recette nette − coûts (salle, promoteur : lignes du budget) − promo locale = résultat,
 *   partagé avec le coproducteur selon le % de la date.
 * Chaque montant existe en prévu et en réel (billets vendus, pièces reçues).
 */
import { eur2, r2 } from './utils.js';
import { isCnmLine, isSacemLine, lineValue, lineForecast, linesOf } from './budget.js';
import { cnmRate } from './corea.js';
import { byId } from './selectors.js';
import { payAmount, paymentsOf } from './calc.js';

const num = v => v == null || v === '' ? null : Number(v);

export const isProductionShow = s => !!s && /^(Production|Co-Production)$/.test(s.contract_type || '') && s.prod_mode !== 'booking';
export const PROD_CATS = ['Salle', 'Promoteur'];

export const PROD_DEFAULTS = {
  reps: 1, vat: 5.5, sacem_pct: 8.8,   // taux CNM : celui de la date ou des Réglages (cnmRate, v1.51), plus de 3,5 écrit ici
  sacd_pct: 0, sacd_ms_pct: 0, agessa_pct: 1.1,
  promo_net_pct: 0, promo_dl_pct: 0, artbo_share: 100, invitations: 0,
  tickets: [{label: 'Prix unique', qty: 0, price: 0, dl_prod: 0, dl_net: 0}],
};
/** Paramètres de production d'une date (valeurs par défaut complétées) ; le partage suit le coproducteur de la date */
export function prodOf(s){
  const p = {...PROD_DEFAULTS, ...(s?.production || {})};
  p.tickets = (p.tickets || []).map(t => ({label: '', qty: 0, price: 0, dl_prod: 0, dl_net: 0, ...t}));
  if (s?.production?.artbo_share == null) p.artbo_share = s?.contract_type === 'Co-Production' && s?.partner_id ? 50 : 100;
  return p;
}

/**
 * Lignes de Factures d'une coproduction (décision d'Anthony du 28/10/2026) : qualifiées EXPLICITEMENT (show_payments.coprod_role) —
 *   « recette » : recette complémentaire de coproduction, intégrée UNE fois au résultat, encaissée par L'ArtBo ou le coproducteur
 *   (coprod_holder) ; « hors_resultat » : hors calcul du résultat ; « ailleurs » : déjà comptabilisée ailleurs (billetterie…), jamais
 *   ajoutée. Aucune requalification automatique ; les lignes « hors calcul » historiques (v1.44) et les anciennes lignes « Taxe CNM »
 *   ne sont pas concernées (taxes déjà dans les droits et taxes).
 */
export const COPROD_ROLES = [['recette', 'Recette complémentaire de coproduction'], ['hors_resultat', 'Hors calcul'], ['ailleurs', 'Déjà comptabilisée ailleurs']];
export const coprodLines = s => s?.contract_type === 'Co-Production' ? paymentsOf(s.id).filter(p => p.kind !== 'cnm') : [];
export const coprodReceipts = s => coprodLines(s).filter(p => p.coprod_role === 'recette');

/** Calcul complet, en prévu (real=false) ou en réel (billets vendus, dépenses réelles) */
export function productionBudget(s, real = false){
  const p = prodOf(s), vat = num(p.vat) ?? 5.5;
  const tickets = p.tickets.map(t => {
    const qty = real ? num(t.real_qty) : num(t.qty);
    return {...t, n: qty || 0, gross: r2((qty || 0) * (num(t.price) || 0)), dl: r2((qty || 0) * (num(t.dl_prod) || 0))};
  });
  const paying = tickets.reduce((a, t) => a + t.n, 0);
  const invitations = (real ? num(p.real_invitations) ?? num(p.invitations) : num(p.invitations)) || 0;
  const grossTtc = r2(tickets.reduce((a, t) => a + t.gross, 0));
  const dlTtc = r2(tickets.reduce((a, t) => a + t.dl, 0));
  const ht = r2(grossTtc / (1 + vat / 100)), dlHt = r2(dlTtc / (1 + vat / 100));
  const capacity = (Number(s.capacity) || 0) * (Number(p.reps) || 1);
  // droits et taxes : sur la TOTALITÉ de la recette HT (comme le tableau) ; une dépense CNM / SACEM réelle saisie remplace le calcul
  const lines = linesOf(s.id), taxLines = lines.filter(l => isCnmLine(l) || isSacemLine(l));
  const realOf = test => { const ls = taxLines.filter(test).filter(l => l.amount != null); return real && ls.length ? r2(ls.reduce((a, l) => a + Number(l.amount), 0)) : null; };
  const cnmCalc = r2(Math.round(ht) * cnmRate(s) / 100), cnmReal = realOf(isCnmLine);
  const cnm = cnmReal ?? cnmCalc;
  const ag = (num(p.agessa_pct) || 0) / 100;
  const sacd = (() => { const d = Math.floor(ht * (num(p.sacd_pct) || 0)) / 100, cr = r2(ht * (num(p.sacd_pct) || 0) / 5 / 100); return r2(d + cr + r2(d * ag)); })();
  const sacdMs = (() => { const d = Math.floor(ht * (num(p.sacd_ms_pct) || 0)) / 100, cr = r2(ht * (num(p.sacd_ms_pct) || 0) / 5 / 100); return r2(d + cr + r2(d * ag)); })();
  const sacemReal = realOf(l => isSacemLine(l) && !isCnmLine(l));
  const sacem = sacemReal ?? (() => { const d = Math.floor(ht * (num(p.sacem_pct) || 0)) / 100; return r2(d + r2(d * ag)); })();
  const taxes = r2(cnm + sacd + sacdMs + sacem);
  const net = r2(ht - taxes);
  // coûts : lignes du budget de la date (salle, promoteur…), prévu ou réel — hors CNM / SACEM, déjà dans les taxes (jamais deux fois)
  const costLines = lines.filter(l => !taxLines.includes(l));
  const costOf = l => real ? (l.amount != null ? Number(l.amount) : 0) : (lineForecast(l) ?? (Number(l.amount) || 0));
  const byCat = {};
  costLines.forEach(l => { byCat[l.category || 'Autres'] = r2((byCat[l.category || 'Autres'] || 0) + costOf(l)); });
  const costs = r2(costLines.reduce((a, l) => a + costOf(l), 0));
  const promo = r2(net * (num(p.promo_net_pct) || 0) / 100 + dlHt * (num(p.promo_dl_pct) || 0) / 100);
  // recettes complémentaires de coproduction : une seule fois, prévu comme réel (montant de la ligne)
  const receipts = coprodReceipts(s), extra = r2(receipts.reduce((a, x) => a + (payAmount(x) || 0), 0));
  const result = r2(net - costs - promo + extra);
  const resultDl = r2(net + dlHt - costs - promo + extra);
  const share = (num(p.artbo_share) ?? 100) / 100;
  return {p, tickets, paying, invitations, total: paying + invitations, capacity,
    fill: capacity ? (paying + invitations) / capacity : null, avgPrice: paying ? r2(grossTtc / paying) : 0,
    grossTtc, dlTtc, ht, dlHt, vatAmount: r2(grossTtc - ht), cnm, cnmCalc, cnmReal, cnmRate: cnmRate(s), sacemReal, taxLines, sacem, sacd, sacdMs, taxes, net, netPerTicket: paying ? r2(net / paying) : 0,
    costs, byCat, promo, extra, receipts, result, resultDl, artbo: r2(resultDl * share), partner: r2(resultDl * (1 - share)), share,
    partnerName: byId('partners', s.partner_id)?.name || 'Coproducteur'};
}

/** Lignes de coûts proposées pour une nouvelle production (reprises du tableau Cabaret Sauvage, montants à saisir) */
export const PROD_LINES = [
  ['Salle', 'Location salle'], ['Salle', 'Serviettes + gourdes'], ['Salle', 'Crash barrière'], ['Salle', 'Responsable sécurité'],
  ['Salle', 'Agent de sécurité'], ['Salle', 'Console retour + ingénieur'], ['Salle', 'Gestion billetterie'],
  ['Promoteur', 'Cachet artiste'], ['Promoteur', '1ère partie'], ['Promoteur', 'Location technique'], ['Promoteur', 'Régisseur général'],
  ['Promoteur', 'Régisseur son'], ['Promoteur', 'Road'], ['Promoteur', 'Affichage'], ['Promoteur', 'Communication digitale'],
  ['Promoteur', 'Hôtel'], ['Promoteur', 'Parking'], ['Promoteur', 'Déplacements'], ['Promoteur', 'Per diem midi'],
  ['Promoteur', 'Repas soir'], ['Promoteur', 'Fournitures loges'], ['Promoteur', 'Repas prod'],
];
export { lineValue };

/**
 * 🤝 Coproduction : positions de chacun et reversement (décisions d'Anthony du 27/10/2026). Sur les montants RÉELS :
 *   - résultat global réel (DL inclus) réparti selon les % du contrat, bénéfice ou perte ;
 *   - la structure qui encaisse les recettes garde la recette nette (HT, après droits et taxes, DL inclus) ;
 *   - promotion locale : débiteur contractuel (charge commune, ou une partie seule : hors du résultat partagé, retirée de sa part)
 *     et payeur réel saisis à part, jamais présumés (v1.51) ; payée par l'un, elle compte dans sa position ;
 *   - toute dépense réelle (ou promo) pas encore payée bloque la clôture, comme des recettes de billetterie pas encore encaissées ;
 *   - recettes complémentaires qualifiées (coprod_role) : dans le résultat une fois, dans la position de celle qui les encaisse ;
 *     non encaissées, non qualifiées ou sans encaisseur : clôture bloquée ;
 *   - avance (promo payée par l'un, due par l'autre) : comptée une fois dans la position du payeur, retirée de la part du débiteur ;
 *   - chacun a payé ses dépenses réelles (payeur « L'ArtBo » ou « coproducteur », date de paiement remplie) ;
 *   - reversement = part due − position réelle ; celui qui reçoit le reversement facture l'autre (facture préparée à la main).
 * Rien n'est payé ni facturé automatiquement ; un reversement n'est payé que quand sa date de paiement est notée.
 */
/** Promotion locale d'une coproduction : à qui elle incombe selon le contrat (v1.51) */
export const PROMO_DEBTORS = [['commun', 'Charge commune (déduite du résultat partagé)'], ['artbo', 'L’ArtBoristerie seule'], ['partenaire', 'Le coproducteur seul']];
export const PROMO_PAYERS = [['artbo', 'L’ArtBoristerie'], ['partenaire', 'Le coproducteur']];
export function coprodClose(s){
  const r = productionBudget(s, true), p = r.p, issues = [], warnings = [];
  const holder = s.ticket_holder, share = num(p.artbo_share);
  if (!['artbo', 'partenaire'].includes(holder)) issues.push('Indique qui encaisse les recettes : L’ArtBoristerie ou le coproducteur');
  if (!p.tickets.length || p.tickets.some(t => t.real_qty == null || t.real_qty === '')) issues.push('Recettes réelles : saisis les billets vendus de chaque tarif');
  if (share == null || share < 0 || share > 100) issues.push('Part de L’ArtBo : un pourcentage entre 0 et 100');
  else if (share < 100 && !s.partner_id) issues.push('Choisis le coproducteur de la date (sa part est de ' + r2(100 - share) + ' %)');
  const costLines = linesOf(s.id).filter(l => !r.taxLines.includes(l));
  // taxes CNM / SACEM payées pour de vrai (lignes saisies) : comptées chez celui qui les a payées ; les taxes seulement
  // calculées sont supposées payées par la structure qui encaisse (détentrice de la billetterie)
  const taxPaidLines = r.taxLines.filter(l => l.amount != null && Number(l.amount) !== 0);
  const onlyPlanned = costLines.filter(l => l.amount == null && (lineForecast(l) || 0) !== 0);
  if (onlyPlanned.length) issues.push(`${onlyPlanned.length} dépense${onlyPlanned.length > 1 ? 's' : ''} seulement prévue${onlyPlanned.length > 1 ? 's' : ''} : saisis le montant réel (ou 0)`);
  const realLines = [...costLines.filter(l => l.amount != null && Number(l.amount) !== 0), ...taxPaidLines];
  const noPayer = realLines.filter(l => !['artbo', 'partenaire'].includes(l.payer));
  if (noPayer.length) issues.push(`${noPayer.length} dépense${noPayer.length > 1 ? 's' : ''} réelle${noPayer.length > 1 ? 's' : ''} sans payeur L’ArtBo / coproducteur : précise qui l’a payée`);
  // dépense restant à payer : bloque la clôture définitive (décision d'Anthony du 27/10/2026, au soir) ; le résultat prévisionnel reste visible
  const unpaidLines = realLines.filter(l => !l.paid_at);
  const unpaid = r2(unpaidLines.reduce((a, l) => a + Number(l.amount), 0));
  if (unpaidLines.length) issues.push(`${unpaidLines.length} dépense${unpaidLines.length > 1 ? 's' : ''} réelle${unpaidLines.length > 1 ? 's' : ''} pas encore payée${unpaidLines.length > 1 ? 's' : ''} (${eur2(unpaid)}) : note la date de paiement avant la clôture`);
  // promotion locale (même décision) : jamais présumée supportée ni payée par la structure qui encaisse. Débiteur contractuel
  // (charge commune du résultat, ou L'ArtBo / le coproducteur seul) et payeur réel (avec sa date de paiement) saisis à part.
  const promo = r.promo, debtor = p.promo_debtor || null, payer = p.promo_payer || null, promoPaid = !!p.promo_paid_at;
  // recettes attendues et intégrées au résultat (billetterie et DL, réelles) : encaissées avant la clôture définitive (27/10, 22 h 35)
  if (r.ht + r.dlHt > 0 && !p.receipts_cashed_at) issues.push(`Recettes de billetterie (${eur2(r2(r.ht + r.dlHt))} HT) pas encore notées encaissées : note la date d’encaissement par ${holder === 'partenaire' ? 'le coproducteur' : holder === 'artbo' ? 'L’ArtBoristerie' : 'la structure qui encaisse'}`);
  if (promo < 0) issues.push('Promotion locale négative : vérifie ses pourcentages');
  if (promo){
    if (!PROMO_DEBTORS.some(d => d[0] === debtor)) issues.push('Promotion locale : indique à qui elle incombe selon le contrat (charge commune, L’ArtBo ou le coproducteur)');
    if (!['artbo', 'partenaire'].includes(payer)) issues.push('Promotion locale : indique qui l’a réellement payée (L’ArtBo ou le coproducteur)');
    if (!promoPaid) issues.push(`Promotion locale (${eur2(promo)}) pas encore payée : note sa date de paiement avant la clôture`);
  }
  // recettes complémentaires : chaque ligne qualifiée ; encaisseur connu ; encaissée avant la clôture définitive
  const unqualified = coprodLines(s).filter(x => !COPROD_ROLES.some(c => c[0] === x.coprod_role));
  if (unqualified.length) issues.push(`${unqualified.length} ligne${unqualified.length > 1 ? 's' : ''} de Factures à qualifier (recette complémentaire, hors calcul ou déjà comptabilisée ailleurs)`);
  const rec = r.receipts;
  if (rec.some(x => !['artbo', 'partenaire'].includes(x.coprod_holder))) issues.push('Recette complémentaire : indique qui doit l’encaisser (L’ArtBo ou le coproducteur)');
  if (rec.some(x => !(payAmount(x) > 0))) issues.push('Recette complémentaire sans montant HT');
  const recTodo = rec.filter(x => !x.paid_at);
  if (recTodo.length) issues.push(`${recTodo.length} recette${recTodo.length > 1 ? 's' : ''} complémentaire${recTodo.length > 1 ? 's' : ''} attendue${recTodo.length > 1 ? 's' : ''} pas encore encaissée${recTodo.length > 1 ? 's' : ''} (${eur2(r2(recTodo.reduce((a, x) => a + (payAmount(x) || 0), 0)))}) : note la date d’encaissement`);
  const cashedBy = who => r2(rec.filter(x => x.coprod_holder === who && x.paid_at).reduce((a, x) => a + (payAmount(x) || 0), 0));
  const paidBy = who => r2(realLines.filter(l => l.payer === who && l.paid_at).reduce((a, l) => a + Number(l.amount), 0)
    + (promo && payer === who && promoPaid ? promo : 0));
  const realTaxes = r2((r.cnmReal ?? 0) + (r.sacemReal ?? 0));
  const net = r2(r.ht + r.dlHt - (r.taxes - realTaxes));   // ce que garde la structure qui encaisse (taxes calculées payées par elle ; promo à part)
  // résultat global (promo déduite, quel que soit son débiteur) ; promo à la charge d'une seule partie : hors du résultat partagé,
  // retirée de la part de cette partie
  const result = r.resultDl, own = promo && ['artbo', 'partenaire'].includes(debtor) ? promo : 0, shared = r2(result + own);
  const artboPart = r2(shared * (share ?? 0) / 100 - (debtor === 'artbo' ? own : 0)), partnerPart = r2(result - artboPart);
  const posArtbo = r2((holder === 'artbo' ? net : 0) + cashedBy('artbo') - paidBy('artbo')), posPartner = r2((holder === 'partenaire' ? net : 0) + cashedBy('partenaire') - paidBy('partenaire'));
  const transfer = r2(artboPart - posArtbo);   // > 0 : le coproducteur reverse à L'ArtBo ; < 0 : L'ArtBo reverse au coproducteur
  return {r, issues, warnings, ok: !issues.length, snapshot: {
    holder, recettes_ht: r.ht, dl_ht: r.dlHt, taxes: r.taxes, cnm: r.cnm, sacem: r.sacem, costs: r.costs, promo: r.promo, result, shared_result: shared,
    promo_debtor: debtor, promo_payer: payer, promo_paid_at: p.promo_paid_at || null, receipts_cashed_at: p.receipts_cashed_at || null,
    extra_receipts: r.extra, cashed_artbo: cashedBy('artbo'), cashed_partner: cashedBy('partenaire'),
    promo_advance: promo && payer && debtor && debtor !== 'commun' && payer !== debtor ? promo : 0,   // avance faite pour le compte de l'autre
    artbo_share: share, artbo_part: artboPart, partner_part: partnerPart, partner: r.partnerName,
    net_encaisse: net, paid_artbo: paidBy('artbo'), paid_partner: paidBy('partenaire'), unpaid, pos_artbo: posArtbo, pos_partner: posPartner,
    transfer: Math.abs(transfer), from: transfer > 0 ? 'partenaire' : transfer < 0 ? 'artbo' : null, to: transfer > 0 ? 'artbo' : transfer < 0 ? 'partenaire' : null,
  }};
}
