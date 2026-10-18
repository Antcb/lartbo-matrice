/**
 * 🎟️ Budget de production : dates dont L'ArtBo est producteur (contrat « Production » ou « Co-Production »),
 * sur le modèle du tableau Cabaret Sauvage :
 *   billetterie (tarifs × quantités, droits de location) → recette HT → droits et taxes (CNM, SACEM, SACD)
 *   → recette nette − coûts (salle, promoteur : lignes du budget) − promo locale = résultat,
 *   partagé avec le coproducteur selon le % de la date.
 * Chaque montant existe en prévu et en réel (billets vendus, pièces reçues).
 */
import { lineValue, lineForecast, linesOf } from './budget.js';
import { byId } from './selectors.js';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => v == null || v === '' ? null : Number(v);

export const isProductionShow = s => !!s && /^(Production|Co-Production)$/.test(s.contract_type || '') && s.prod_mode !== 'booking';
export const PROD_CATS = ['Salle', 'Promoteur'];

export const PROD_DEFAULTS = {
  reps: 1, vat: 5.5, cnm_pct: 3.5, sacem_pct: 8.8, sacd_pct: 0, sacd_ms_pct: 0, agessa_pct: 1.1,
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
  // droits et taxes (sur la recette HT, comme le tableau)
  const cnm = r2(Math.round(ht) * (num(p.cnm_pct) || 0) / 100);
  const ag = (num(p.agessa_pct) || 0) / 100;
  const sacd = (() => { const d = Math.floor(ht * (num(p.sacd_pct) || 0)) / 100, cr = r2(ht * (num(p.sacd_pct) || 0) / 5 / 100); return r2(d + cr + r2(d * ag)); })();
  const sacdMs = (() => { const d = Math.floor(ht * (num(p.sacd_ms_pct) || 0)) / 100, cr = r2(ht * (num(p.sacd_ms_pct) || 0) / 5 / 100); return r2(d + cr + r2(d * ag)); })();
  const sacem = (() => { const d = Math.floor(ht * (num(p.sacem_pct) || 0)) / 100; return r2(d + r2(d * ag)); })();
  const taxes = r2(cnm + sacd + sacdMs + sacem);
  const net = r2(ht - taxes);
  // coûts : lignes du budget de la date (salle, promoteur…), prévu ou réel
  const lines = linesOf(s.id);
  const costOf = l => real ? (l.amount != null ? Number(l.amount) : 0) : (lineForecast(l) ?? (Number(l.amount) || 0));
  const byCat = {};
  lines.forEach(l => { byCat[l.category || 'Autres'] = r2((byCat[l.category || 'Autres'] || 0) + costOf(l)); });
  const costs = r2(lines.reduce((a, l) => a + costOf(l), 0));
  const promo = r2(net * (num(p.promo_net_pct) || 0) / 100 + dlHt * (num(p.promo_dl_pct) || 0) / 100);
  const result = r2(net - costs - promo);
  const resultDl = r2(net + dlHt - costs - promo);
  const share = (num(p.artbo_share) ?? 100) / 100;
  return {p, tickets, paying, invitations, total: paying + invitations, capacity,
    fill: capacity ? (paying + invitations) / capacity : null, avgPrice: paying ? r2(grossTtc / paying) : 0,
    grossTtc, dlTtc, ht, dlHt, vatAmount: r2(grossTtc - ht), cnm, sacem, sacd, sacdMs, taxes, net, netPerTicket: paying ? r2(net / paying) : 0,
    costs, byCat, promo, result, resultDl, artbo: r2(resultDl * share), partner: r2(resultDl * (1 - share)), share,
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
