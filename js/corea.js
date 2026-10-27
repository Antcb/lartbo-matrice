/**
 * 🎫 Taxe CNM et partage d'une coréalisation (décisions d'Anthony du 27/10/2026).
 *
 * Taxe CNM — quatre notions distinctes :
 *   1. redevable légal : le détenteur de la billetterie (spectacle payant) ;
 *   2. structure qui supporte contractuellement le coût : shows.cnm_bearer (vide = usage habituel : payant → l'organisateur,
 *      gratuit → L'ArtBo ; en coréalisation, attribution explicite obligatoire) ;
 *   3. montant : payant = taux × TOTALITÉ des recettes de billetterie HT (jamais seulement au-delà du break) ;
 *      gratuit = taux × prix de cession HT ; taux = shows.cnm_pct, sinon Réglages (default_cnm_pct) ;
 *   4. prise en compte dans le résultat net partagé d'une coréalisation : seulement si shows.cnm_in_result (contrat).
 *
 * Coréalisation : rémunération = minimum garanti (cachet HT, acquis, fixe) + part contractuelle du résultat net
 * attribuable aux billets vendus au-delà du break. Le MG n'est jamais remplacé par le %, ni compté dans les charges.
 *   - recettes au-delà du break : exactes si les ventes après le break sont connues pour CHAQUE tarif (somme = vendus − break) ;
 *     sinon fourchette (billets les moins chers / les plus chers) et prorata des ventes, appliqué seulement après validation ;
 *   - break : nombre de billets, validé à la main avant tout calcul (anciens breaks compris) ;
 *   - charges déductibles : celles du contrat, saisies pour la date (chacune une fois) + la CNM si cnm_in_result.
 */
import { r2 } from './utils.js';
import { byId, setting, showCommissionPct } from './selectors.js';
import { S } from './state.js';

const num = v => v == null || v === '' ? null : Number(v);
export const isFreeShow = s => /gratuit/i.test(s?.ticketing_type || '');   // « Prix libre » = payant
export const isCorea = s => s?.contract_type === 'Co-Réalisation';
export const HOLDERS = [['organisateur', 'L’organisateur (la structure)'], ['artbo', 'L’ArtBoristerie'], ['partenaire', 'Le coproducteur / partenaire']];
export const holderLabel = k => (HOLDERS.find(h => h[0] === k) || [, 'non renseigné'])[1];

/** Date à l'étranger : département remplacé par un code pays (CH, BE…) ou structure hors de France (pas de taxe CNM) */
export const isAbroad = s => { const d = String(s?.department || '').trim().toUpperCase(), c = byId('structures', s?.structure_id)?.country;
  if (d) return /^[A-Z]{2,}$/.test(d) && !/^2[AB]$/.test(d);   // le département du concert fait foi
  return !!c && !/^france$/i.test(c); };
/** Dépense CNM / SACEM saisie (ligne, pièce lue par l'IA…) : elle remplace la charge calculée, sans s'y ajouter (27/10/2026) */
export const isCnmLine = l => l.auto === 'cnm' || /\bcnm\b/i.test(`${l.label || ''} ${l.supplier || ''}`);
export const isSacemLine = l => /\bsacem\b/i.test(`${l.label || ''} ${l.supplier || ''}`);
/** Dépense CNM réelle d'une date (lignes saisies, hors ligne calculée) : null s'il n'y en a pas */
export function cnmRealOf(s){
  const ls = (S.db.budget_lines || []).filter(l => l.show_id === s?.id && !l.auto && isCnmLine(l) && l.amount != null);
  return ls.length ? r2(ls.reduce((a, l) => a + Number(l.amount), 0)) : null;
}
/** Taux CNM de la date (%) : celui de la date, sinon l'ancien taux du budget de production (vidé = 0, comme avant), sinon les Réglages */
export function cnmRate(s){
  if (num(s?.cnm_pct) != null) return num(s.cnm_pct);
  if (s?.production && 'cnm_pct' in s.production) return num(s.production.cnm_pct) ?? 0;
  return num(setting('default_cnm_pct')) ?? 3.5;
}
/** Structure qui supporte la taxe : saisie sur la date ; sinon l'usage habituel (payant → organisateur, gratuit → L'ArtBo) ;
 *  coréalisation payante : jamais supposée (null = à attribuer) */
export function cnmBearer(s){
  if (s?.cnm_bearer) return s.cnm_bearer;
  if (isFreeShow(s)) return 'artbo';
  return isCorea(s) ? null : 'organisateur';
}
/** Redevable légal (spectacle payant) : le détenteur de la billetterie */
export const cnmDebtor = s => isFreeShow(s) ? null : (s?.ticket_holder || null);

/** Tarifs d'une coréalisation : prix TTC, TVA (5,5 % par défaut), quantité vendue, ventes après le break (si connues) */
export function coreaTiers(s){
  return (s?.corea?.tiers || []).map(t => {
    const price = num(t.price) || 0, vat = num(t.vat) ?? 5.5, qty = num(t.qty) || 0, after = num(t.after);
    const unitHt = price / (1 + vat / 100);
    return {label: t.label || '', price, vat, qty, after, unitHt, ht: r2(qty * unitHt)};
  });
}
/** Break validé : seulement s'il a été validé à la main pour sa valeur actuelle (anciens breaks : validation obligatoire) */
export const breakValidated = s => s?.break_even != null && s.break_even !== '' && !!s?.corea?.break_validated_at
  && Number(s.corea.break_value) === Number(s.break_even);

/** Calcul complet d'une coréalisation (null pour les autres contrats) */
export function coreaCalc(s){
  if (!isCorea(s)) return null;
  const tiers = coreaTiers(s), sold = tiers.reduce((a, t) => a + t.qty, 0), ht = r2(tiers.reduce((a, t) => a + t.ht, 0));
  const brk = num(s.break_even), validated = breakValidated(s), beyond = brk == null ? null : Math.max(0, sold - brk);
  const issues = [];
  // ventes après le break connues pour chaque tarif : données exactes
  const allAfter = tiers.length > 0 && tiers.every(t => t.after != null);
  const afterSum = tiers.reduce((a, t) => a + (t.after || 0), 0);
  let exact = null;
  if (allAfter && beyond != null){
    const bad = tiers.find(t => t.after < 0 || t.after > t.qty);
    if (bad) issues.push(`Tarif « ${bad.label || 'sans nom'} » : ventes après le break hors de 0 à ${bad.qty}`);
    else if (afterSum !== beyond) issues.push(`Ventes après le break : ${afterSum} saisies pour ${beyond} attendues (vendus − break)`);
    else exact = r2(tiers.reduce((a, t) => a + t.after * t.unitHt, 0));
  }
  // fourchette : les billets après le break sont les moins chers (min) ou les plus chers (max) ; prorata des ventes
  const fill = order => { let left = beyond || 0, v = 0; for (const t of [...tiers].sort(order)){ const n = Math.min(left, t.qty); v += n * t.unitHt; left -= n; } return r2(v); };
  const range = beyond == null || !sold ? null : {min: fill((a, b) => a.unitHt - b.unitHt), max: fill((a, b) => b.unitHt - a.unitHt), prorata: r2(ht * beyond / sold)};
  // prorata validé pour CES chiffres : une modification des tarifs, des ventes ou du break demande une nouvelle validation
  const sig = `${sold}|${ht}|${brk}`;
  const method = s.corea?.method?.kind === 'prorata' && s.corea?.method?.at && s.corea.method.sig === sig ? 'prorata' : null;
  // ventes après le break saisies pour tous les tarifs mais incohérentes : rien n'est calculé tant qu'elles ne sont pas corrigées
  const revenue = !validated ? null : exact != null ? exact : allAfter ? null : method === 'prorata' && range ? range.prorata : null;
  // charges déductibles (contrat) : chacune une fois ; la CNM (sur la TOTALITÉ des recettes) seulement si le contrat le prévoit
  const charges = (s.corea?.charges || []).map(c => ({label: c.label || '', amount: num(c.amount) || 0}));
  // CNM sur la TOTALITÉ des recettes ; une dépense CNM réelle saisie la remplace ; pas de CNM à l'étranger
  const cnm = isAbroad(s) ? 0 : cnmRealOf(s) ?? r2(ht * cnmRate(s) / 100);
  // doubles comptages bloquants : rien n'est calculé tant qu'ils ne sont pas corrigés (décision « aucun double comptage »)
  const blocking = [];
  if (charges.some(c => /\bcnm\b/i.test(c.label))) blocking.push('La CNM ne se saisit pas comme charge : coche « CNM déduite du résultat partagé »');
  if (charges.some(c => /minimum garanti|\bmg\b/i.test(c.label))) blocking.push('Le minimum garanti n’est jamais une charge du partage (il est acquis à part)');
  if (charges.some(c => /commission/i.test(c.label))) blocking.push('La commission de L’ArtBo n’est jamais une charge du résultat partagé (elle se calcule sur la rémunération de l’artiste)');
  if (charges.some(c => c.amount < 0)) blocking.push('Une charge déductible ne peut pas être négative');
  const pct = num(s.cr_producer_pct);
  if (pct != null && (pct < 0 || pct > 100)) blocking.push('% du résultat au producteur : entre 0 et 100');
  issues.push(...blocking);
  const deducted = r2(charges.reduce((a, c) => a + c.amount, 0) + (s.cnm_in_result ? cnm : 0));
  const net = revenue == null || blocking.length ? null : r2(revenue - deducted);
  const share = net == null || pct == null ? null : r2(Math.max(0, net) * pct / 100);
  const mg = num(s.fee_ht) || 0, comPct = commissionPctOf(s), total = share == null ? null : r2(mg + share);
  return {tiers, sold, ht, brk, validated, beyond, exact, range, method, revenue, charges, cnm, deducted, net, pct, share,
    partnerShare: net == null || share == null ? null : r2(Math.max(0, net) - share), mg, total,
    // commission sur la rémunération brute calculée (affichage) ; la commission retenue porte sur la part VALIDÉE (commissionBase)
    comPct, com: total == null ? null : r2(total * comPct / 100), validatedShare: num(s.corea_share),
    issues, sig, needsMethod: validated && exact == null && !allAfter && !method};
}

/**
 * Commission en coréalisation (décision d'Anthony du 27/10/2026, au soir) : sur la rémunération BRUTE de l'artiste
 *   brute = minimum garanti (cachet HT) + part du résultat net après break ; commission = brute × taux ; nette = brute − commission.
 * La part retenue est celle VALIDÉE sur la date (shows.corea_share, posée par « Valider la part du résultat ») : tant qu'elle ne
 * l'est pas, la commission ne porte que sur le MG (provisoire, signalé à l'écran). Le taux reste celui du paramétrage (ligne > date >
 * artiste > Réglages), sans exception par nom. Même règle côté base (payment_amount_for, v1.51) et côté Pennylane (facture de commission).
 */
/** Taux de commission de la date : % de sa ligne de commission, sinon % de la date > artiste > Réglages (comme payAmount) */
export function commissionPctOf(s){
  const l = (S.db.show_payments || []).find(p => p.show_id === s?.id && p.kind === 'artbo' && (p.hors_calcul == null || p.hors_calcul === ''));
  return l && l.pct != null && String(l.pct).trim() !== '' ? Number(l.pct) : showCommissionPct(s);
}
export const coreaShareOf = s => isCorea(s) ? num(s?.corea_share) || 0 : 0;
export const commissionBase = s => r2((Number(s?.fee_ht) || 0) + coreaShareOf(s));

/** Montant de la taxe CNM d'une date et ce qu'il recouvre (les montants payant viennent des recettes connues) */
export function cnmOf(s, recettesHt = null){
  const rate = cnmRate(s), free = isFreeShow(s), abroad = isAbroad(s);
  const base = free ? num(s?.fee_ht) || 0 : recettesHt ?? coreaCalc(s)?.ht ?? null;
  const real = cnmRealOf(s);
  return {rate, free, abroad, base, real, amount: abroad ? 0 : real ?? (base == null ? null : r2(base * rate / 100)), bearer: cnmBearer(s), debtor: cnmDebtor(s)};
}
