/**
 * ⚖️ Points d'équilibre (« breaks ») calculés — décisions d'Anthony du 04/11 et du 05/11/2026 (cas de travail, pas des règles
 * universelles ; calcul indicatif à partir du budget PRÉVU, qui ne remplace jamais le break contractuel saisi sur la date).
 *   - Production, coproduction et coréalisation ; jamais en cession ni pour une date « booking uniquement ».
 *   - Billet par billet : on ajoute les billets un à un et on cherche le premier nombre de billets payants pour lequel le résultat
 *     devient positif ou nul. Trois scénarios : la répartition prévue entre les tarifs, et une fourchette (billets les moins chers
 *     d'abord, les plus chers d'abord), toujours dans les quotas prévus de chaque tarif. Les invitations ne comptent pas.
 *   - Les avances ne sont pas des charges : seules les lignes du budget (coûts) et les droits et taxes entrent dans le résultat.
 *   - Coproduction : trois lectures distinctes, jamais additionnées — résultat PARTAGÉ (promotion locale à la charge d'une seule
 *     partie exclue), part de L'ARTBO (promotion à sa charge retirée de sa part, une seule fois), résultat économique GLOBAL.
 *     Sous l'équilibre partagé, la part de L'ArtBo dépend du % des PERTES du contrat : s'il manque alors qu'il change le résultat,
 *     « information manquante », jamais déduit du % des bénéfices.
 *   - Coréalisation : l'équilibre du spectacle n'est pas calculable (recettes et coûts de la salle inconnus) ; le break du contrat
 *     est affiché à part ; l'équilibre de L'ArtBo vient de ses conditions réelles : MG + % du résultat net au-delà du break validé
 *     (charges déductibles du contrat, CNM seulement si cochée) face aux dépenses prévues de la date (hors solde artiste).
 */
import { r2 } from './utils.js';
import { isProductionShow, prodOf, productionBudget } from './production-budget.js';
import { breakValidated, cnmRate, cnmRealOf, coreaTiers, isAbroad, isCorea } from './corea.js';
import { isSolde, lineForecast, linesOf } from './budget.js';

const num = v => v == null || v === '' ? null : Number(v);

/** Ordre de vente billet par billet dans les quotas (q) : 'mix' (proportions prévues), 'low' / 'high' (moins / plus chers d'abord) ;
 *  renvoie la suite des tarifs vendus (indice), dont les n premiers donnent la répartition de n billets */
export function saleOrder(tiers, scenario){
  const Q = tiers.reduce((a, t) => a + t.q, 0), seq = [];
  if (scenario === 'mix'){
    const out = tiers.map(() => 0);
    for (let k = 1; k <= Q; k++){   // le tarif le plus en retard sur sa part prévue reçoit le billet suivant
      let best = -1, gap = -Infinity;
      tiers.forEach((t, i) => { if (out[i] < t.q){ const g = t.q * k / Q - out[i]; if (g > gap + 1e-9){ gap = g; best = i; } } });
      out[best]++; seq.push(best);
    }
    return seq;
  }
  tiers.map((t, i) => i).sort((a, b) => scenario === 'low' ? tiers[a].unit - tiers[b].unit : tiers[b].unit - tiers[a].unit)
    .forEach(i => { for (let k = 0; k < tiers[i].q; k++) seq.push(i); });
  return seq;
}
export const allocate = (tiers, n, scenario) => { const out = tiers.map(() => 0); saleOrder(tiers, scenario).slice(0, n).forEach(i => out[i]++); return out; };

const SCENARIOS = [['mix', 'répartition prévue'], ['low', 'billets les moins chers d’abord'], ['high', 'billets les plus chers d’abord']];

/** Premier n (0..Q) pour lequel value(n) ≥ 0. value(n) = null : information manquante pour ce nombre de billets ; on ne
 *  conclut alors rien (le résultat aurait pu être positif plus tôt) → {missing: true} */
function firstPositive(Q, value){
  let last = null;
  for (let n = 0; n <= Q; n++){
    const v = value(n);
    if (v == null) return {n: null, value: null, missing: true};
    last = v;
    if (v >= 0) return {n, value: v, missing: false};
  }
  return {n: null, value: last, missing: false};
}

/** Production / coproduction : lectures et scénarios (null si la date n'est pas concernée) */
export function productionBreaks(s){
  if (!isProductionShow(s)) return null;
  const p = prodOf(s);
  const tiers = p.tickets.map(t => ({q: Math.max(0, Math.floor(num(t.qty) || 0)), unit: (num(t.price) || 0) + (num(t.dl_prod) || 0)}));
  const Q = tiers.reduce((a, t) => a + t.q, 0);
  // partage du résultat (coproduction, ou part de L'ArtBo < 100 %) : trois lectures ; sinon une seule
  const coprod = s.contract_type === 'Co-Production' || (num(p.artbo_share) ?? 100) < 100;
  const base = {coprod, quota: Q, scenarios: SCENARIOS};
  if (!Q) return {...base, missing: 'Billets prévus par tarif (quotas) : à saisir pour calculer l’équilibre'};
  // budget prévu pour n billets (même calcul que le budget de la date : taxes, coûts, promotion, recettes complémentaires)
  const cache = new Map(), orders = Object.fromEntries(SCENARIOS.map(([sc]) => [sc, saleOrder(tiers, sc)]));
  const budgetAt = (sc, n) => { const key = sc + n; if (!cache.has(key)){
    const alloc = tiers.map(() => 0); orders[sc].slice(0, n).forEach(i => alloc[i]++);
    const prod = {...(s.production || {}), tickets: p.tickets.map((t, i) => ({...t, qty: alloc[i]}))};
    if (s.production?.artbo_share == null) prod.artbo_share = p.artbo_share;
    cache.set(key, productionBudget({...s, production: prod}));
  } return cache.get(key); };
  // part de L'ArtBo sous l'équilibre partagé : % des pertes du contrat ; absent → information manquante (jamais le % des bénéfices)
  const readings = coprod
    ? [['shared', 'Résultat partagé', b => b.shared], ['artbo', 'Part de L’ArtBoristerie', b => b.artbo], ['global', 'Résultat économique global (promotion comprise)', b => b.resultDl]]
    : [['global', 'Résultat de la date (L’ArtBoristerie seule productrice)', b => b.resultDl]];
  const out = readings.map(([key, label, get]) => ({key, label, byScenario: Object.fromEntries(SCENARIOS.map(([sc]) => {
    const r = firstPositive(Q, n => get(budgetAt(sc, n)));
    return [sc, {...r, unreached: r.n == null && !r.missing, lossMissing: r.missing}];
  }))}));
  return {...base, readings: out, planned: productionBudget(s)};
}

/** Coréalisation : équilibre du spectacle non calculable, break du contrat à part, équilibre de L'ArtBo selon ses conditions réelles */
export function coreaBreaks(s){
  if (!isCorea(s) || s.prod_mode === 'booking') return null;
  const contract = {value: num(s.break_even), validated: breakValidated(s), text: s.cr_break || null};
  const res = {contract, spectacle: 'Équilibre du spectacle non calculable : données manquantes (recettes et coûts de la salle)'};
  const tiers = coreaTiers(s), capacity = Math.floor(num(s.capacity) || 0), pct = num(s.cr_producer_pct), mg = num(s.fee_ht) || 0;
  const missing = [];
  if (!tiers.length || tiers.every(t => !t.price)) missing.push('tarifs (prix TTC)');
  if (!capacity) missing.push('jauge de la date');
  if (contract.value == null) missing.push('break du contrat');
  else if (!contract.validated) missing.push('validation du break du contrat');
  if (pct == null) missing.push('% du résultat net au producteur');
  const blocking = (s.corea?.charges || []).some(c => /\bcnm\b|minimum garanti|\bmg\b|commission/i.test(c.label || '') || (num(c.amount) || 0) < 0);
  if (blocking) missing.push('charges déductibles à corriger (voir le partage)');
  const costs = r2(linesOf(s.id).filter(l => !isSolde(l)).reduce((a, l) => a + (lineForecast(l) ?? (Number(l.amount) || 0)), 0));
  if (missing.length) return {...res, missing: 'Équilibre de L’ArtBoristerie : à compléter — ' + missing.join(', '), costs, mg};
  // prix HT d'un billet selon le scénario : moyenne pondérée par les ventes saisies (sinon moyenne simple), ou tarif min / max
  const priced = tiers.filter(t => t.price > 0), w = priced.reduce((a, t) => a + t.qty, 0);
  const unit = {mix: w ? priced.reduce((a, t) => a + t.unitHt * t.qty, 0) / w : priced.reduce((a, t) => a + t.unitHt, 0) / priced.length,
    low: Math.min(...priced.map(t => t.unitHt)), high: Math.max(...priced.map(t => t.unitHt))};
  const charges = r2((s.corea?.charges || []).reduce((a, c) => a + (num(c.amount) || 0), 0));
  const cnmReal = cnmRealOf(s), rate = isAbroad(s) ? 0 : cnmRate(s);
  const artboAt = (sc, n) => {
    const beyond = Math.max(0, n - contract.value), ht = n * unit[sc];
    const cnm = !s.cnm_in_result ? 0 : isAbroad(s) ? 0 : cnmReal ?? r2(ht * rate / 100);
    const net = r2(beyond * unit[sc] - charges - cnm);
    return r2(mg + Math.max(0, net) * pct / 100 - costs);
  };
  const byScenario = Object.fromEntries([['mix', 'prix moyen des ventes saisies'], ['low', 'tous au tarif le moins cher'], ['high', 'tous au tarif le plus cher']]
    .map(([sc]) => { const r = firstPositive(capacity, n => artboAt(sc, n)); return [sc, {...r, unreached: r.n == null}]; }));
  return {...res, costs, mg, charges, capacity, byScenario,
    scenarios: [['mix', 'prix moyen des ventes saisies'], ['low', 'tous au tarif le moins cher'], ['high', 'tous au tarif le plus cher']],
    coveredByMg: mg >= costs};
}
