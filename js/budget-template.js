/**
 * 📋 Budget type : le budget prévisionnel posé automatiquement sur chaque nouvelle date confirmée (en production).
 * Valeurs par défaut dans Réglages › Budget type ; chaque artiste peut en remplacer une partie (fiche de l'artiste).
 *  - cachets artistes : nombre d'artistes × cachet selon la jauge (3 tranches)
 *  - cachets techniciens : nombre × coût fixe d'un bulletin
 *  - péage, essence : forfait par date
 *  - Movinmotion (coût par bulletin × nombre de bulletins), taxe CNM si entrée gratuite, solde artiste : calculés seuls
 * Ensuite on ajoute / retire les lignes à la main.
 *
 * Spectacles (v1.57, décisions d'Anthony du 04/11/2026) : une date rattachée à un spectacle prend le budget type DE CE SPECTACLE
 * (effectifs musiciens / multi-instrumentistes / techniciens, coût employeur charges comprises selon la jauge OUVERTE de la date :
 * jusqu'à 300 places incluses = petite jauge ; technicien : coût fixe ; brut affiché pour information, jamais compté). Les montants
 * sont saisis dans le spectacle, jamais inventés. Sans spectacle : le budget type de l'artiste (ci-dessus), comme avant.
 * La jauge est toujours celle ouverte pour la date (shows.capacity), jamais la capacité de la salle ou du festival : sans jauge, le
 * cachet est posé sans tarif (« jauge à renseigner »). Movinmotion : coût par bulletin du moment, figé sur la ligne (non rétroactif).
 * Le modèle n'est copié que dans un budget VIDE : le modifier ne change jamais les budgets existants.
 */
import { render } from './app.js';
import { CNM_TODO, cnmDue, isCnmToFill, isFree, isMissingCost, linesOf, missingCostLines, payslipCost } from './budget.js';
import { confirmAsk } from './ui/dialog.js';
import { save, sb, mergeRows, refreshBudgetMarker } from './data.js';
import { isProductionShow } from './production-budget.js';
import { byId, setting } from './selectors.js';
import { S, touch } from './state.js';
import { BUDGET_CATS } from './constants.js';
import { esc, eur2, toast } from './utils.js';

export const BT_FIELDS = [
  ['artists', 'Artistes payés en cachet (nombre)'],
  ['techs', 'Techniciens (nombre)'],
  ['payslip', 'Coût d’un bulletin technicien (€)'],
  ['peage', 'Péage par date (€)'],
  ['essence', 'Essence par date (€)'],
];
const TIER_KEYS = ['t1max', 't1', 't2max', 't2', 't3'];
const num = v => v == null || v === '' || isNaN(Number(v)) ? null : Number(v);

/** Budget type d'un artiste : ses valeurs, sinon celles de Réglages */
export function templateOf(project){
  const g = setting('budget_template') || {}, own = project?.budget_template || {};
  const out = {};
  for (const k of [...BT_FIELDS.map(f => f[0]), ...TIER_KEYS]) out[k] = num(own[k]) ?? num(g[k]) ?? 0;
  return out;
}
/** Jauge du tarif : la jauge OUVERTE pour la date (v1.57 : plus la capacité de la salle ou du festival), sinon inconnue */
export function jaugeOf(s){
  return num(s?.capacity) ? Number(s.capacity) : null;
}
/** Cachet du budget type de l'artiste selon la jauge ; jauge inconnue : pas de tarif (à renseigner) */
export function cachetFor(t, jauge){
  if (jauge == null) return null;
  return jauge <= t.t1max ? t.t1 : jauge <= t.t2max ? t.t2 : t.t3;
}

/** Petite jauge : jusqu'à 300 places ouvertes incluses (décision d'Anthony du 04/11/2026) */
export const PETITE_JAUGE_MAX = 300;

/* ───────── v1.67, point n°10 (décisions d'Anthony du 25/11/2026) ─────────
 * Rôles musicien / multi-instrumentiste / technicien partout. Tarif de cachet (coût employeur, charges comprises) : unique, quelle que
 * soit la jauge, OU deux tarifs (jusqu'à 300 places incluses, puis au-delà) ; technicien : tarif fixe. Tarif sur facture (HT) distinct,
 * sans bulletin. Budgets types de l'artiste et des Réglages : valeurs PAR DÉFAUT par rôle (artiste > Réglages) ; budget type d'un
 * spectacle : une ligne par personne (nom, rôle, mode, tarif propre sinon celui du rôle). Les anciennes valeurs restent en base. */
export const ROLES = [['mus', 'Musicien', 'musiciens'], ['multi', 'Multi-instrumentiste', 'multi-instrumentistes'], ['tech', 'Technicien', 'techniciens']];
const roleLabel = r => (ROLES.find(x => x[0] === r) || ROLES[0])[1];
const ROLE_KEYS = r => [r + '_n', r + '_nf', r + '_cachet', r + '_facture', ...(r === 'tech' ? [] : [r + '_rate_mode', r + '_cachet_small', r + '_cachet_large'])];
const ALL_ROLE_KEYS = ROLES.flatMap(([r]) => ROLE_KEYS(r));
const filled = v => v != null && v !== '';
/** Valeurs par défaut d'un rôle : celles de l'artiste, sinon celles des Réglages (clé par clé) */
export function roleDefaults(project, r){
  const g = setting('budget_template') || {}, own = project?.budget_template || {}, out = {};
  for (const k of ROLE_KEYS(r)){ const key = k.slice(r.length + 1); out[key] = filled(own[k]) ? own[k] : filled(g[k]) ? g[k] : null; }
  return out;
}
/** Modèle par rôle pour CET artiste (relecture v1.67, B1 : décidé artiste par artiste) : s'il a lui-même des valeurs par rôle, ou s'il n'a
 *  aucune ancienne valeur et que les Réglages en ont. Un artiste resté sur l'ancien modèle (nombres, 3 tranches) le garde tel quel, même
 *  si les Réglages passent aux rôles */
const OLD_KEYS = ['artists', 'techs', 'payslip', 't1max', 't1', 't2max', 't2', 't3'];
export const usesRoles = project => { const g = setting('budget_template') || {}, own = project?.budget_template || {};
  if (ALL_ROLE_KEYS.some(k => filled(own[k]))) return true;
  return !OLD_KEYS.some(k => filled(own[k])) && ALL_ROLE_KEYS.some(k => filled(g[k])); };
/** Tarif de cachet d'une source {rate_mode, cachet, cachet_small, cachet_large} pour une jauge : {cost, tier} — cost null = à renseigner */
export function cachetRate(src, r, jauge){
  if (r === 'tech') return {cost: num(src?.cachet), tier: ''};
  const twoTiers = src?.rate_mode ? src.rate_mode === 'jauge' : (filled(src?.cachet_small) || filled(src?.cachet_large)) && !filled(src?.cachet);
  if (!twoTiers) return {cost: num(src?.cachet), tier: ''};
  if (jauge == null) return {cost: null, tier: 'jauge à renseigner'};
  const small = jauge <= PETITE_JAUGE_MAX;
  return {cost: num(small ? src?.cachet_small : src?.cachet_large), tier: small ? `petite jauge, ${jauge} places` : `grande jauge, ${jauge} places`};
}
/** Tarif propre d'une personne du spectacle (au moins une valeur saisie pour son mode) ? */
const ownRate = (p, mode) => mode === 'facture' ? filled(p.facture) : p.role === 'tech' ? filled(p.cachet)
  : p.rate_mode === 'single' ? filled(p.cachet) : p.rate_mode === 'jauge' ? filled(p.cachet_small) || filled(p.cachet_large) : false;   // « tarif du rôle » : jamais le sien
/** Lignes nominatives d'un spectacle pour une date : une par personne ; tarif propre, sinon celui du rôle (artiste > Réglages) */
export function peopleRows(sp, s){
  const p = byId('projects', s.project_id), jauge = jaugeOf(s);
  return (spectTemplate(sp).people || []).map(x => {
    const r = ROLES.some(y => y[0] === x.role) ? x.role : 'mus', mode = x.mode === 'facture' ? 'facture' : 'cachet';
    const src = ownRate(x, mode) ? x : roleDefaults(p, r);
    const {cost, tier} = mode === 'facture' ? {cost: num(src.facture), tier: ''} : cachetRate(src, r, jauge);
    const name = String(x.name || '').trim() || roleLabel(r);
    return {category: 'Staff', label: `${name} — ${roleLabel(r).toLowerCase()}${mode === 'facture' ? ', sur facture' : ''}${tier ? ` (${tier})` : ''}${cost == null ? ' — coût à renseigner' : ''}`,
      supplier: String(x.name || '').trim() || null, qty: 1, unit_cost: cost, pay_mode: mode};
  });
}
/** Lignes de salaire d'une date sans spectacle, d'après les valeurs par rôle (nombre au cachet, nombre sur facture) */
function roleRows(p, s){
  const jauge = jaugeOf(s), rows = [];
  // aucun nombre par rôle (Réglages avec seulement des tarifs) : les anciens nombres servent (artistes → musiciens, techniciens), au
  // tarif du rôle s'il existe, sinon à l'ancien tarif — jamais de budget sans ses salaires (relecture v1.67, B1)
  const old = templateOf(p), noCounts = ROLES.every(([r]) => !(num(roleDefaults(p, r).n) > 0) && !(num(roleDefaults(p, r).nf) > 0));
  for (const [r, , plural] of ROLES){
    const d = roleDefaults(p, r), n = noCounts ? ({mus: old.artists, tech: old.techs}[r] || 0) : num(d.n), nf = noCounts ? 0 : num(d.nf);
    if (noCounts && n > 0){ let {cost, tier} = cachetRate(d, r, jauge);
      if (cost == null && !tier) cost = r === 'tech' ? old.payslip : cachetFor(old, jaugeOf(s));
      rows.push({category: 'Staff', label: `Cachets ${plural}${tier ? ` (${tier})` : r === 'mus' && jaugeOf(s) ? ` (jauge ${jaugeOf(s)})` : ''}${cost == null ? ' — coût à renseigner' : ''}`, qty: n, unit_cost: cost, pay_mode: 'cachet'});
      continue; }
    if (n > 0){ const {cost, tier} = cachetRate(d, r, jauge);
      rows.push({category: 'Staff', label: `Cachets ${plural}${tier ? ` (${tier})` : ''}${cost == null ? ' — coût à renseigner' : ''}`, qty: n, unit_cost: cost, pay_mode: 'cachet'}); }
    if (nf > 0){ const cost = num(d.facture);
      rows.push({category: 'Staff', label: `${plural.replace(/^./, c => c.toUpperCase())} sur facture${cost == null ? ' — montant à renseigner' : ''}`, qty: nf, unit_cost: cost, pay_mode: 'facture'}); }
  }
  return rows;
}
/** Budget type d'un spectacle : [clé, libellé] — montants en coût employeur (charges comprises) ; « brut » pour information */
export const SPECT_COUNTS = [['mus_n', 'Musiciens (nombre)'], ['multi_n', 'Multi-instrumentistes (nombre)'], ['tech_n', 'Techniciens (nombre)']];
export const SPECT_RATES = [
  ['mus', 'Musicien', true], ['multi', 'Multi-instrumentiste', true], ['tech', 'Technicien', false],   // true : selon la jauge
];
export const SPECT_EXTRA = [['peage', 'Péage par date (€)'], ['essence', 'Essence par date (€)']];
/** Valeurs d'un budget type de spectacle (vides = non renseignées, jamais remplacées par une autre valeur) */
export const spectTemplate = sp => sp?.budget_template || {};
/** Lignes de cachets d'un spectacle pour une date : [{label, qty, unit_cost (null = à renseigner)}] */
export function spectacleStaffRows(sp, s){
  const t = spectTemplate(sp), jauge = jaugeOf(s), small = jauge == null ? null : jauge <= PETITE_JAUGE_MAX;
  const tier = small == null ? 'jauge à renseigner' : small ? `petite jauge, ${jauge} places` : `grande jauge, ${jauge} places`;
  const rows = [];
  for (const [k, label, byJauge] of SPECT_RATES){
    const n = num(t[k + '_n']); if (!n || n <= 0) continue;
    const key = byJauge ? (small == null ? null : k + (small ? '_small' : '_large')) : k;
    const cost = key ? num(t[key]) : null, gross = key ? num(t[key + '_brut']) : null;
    const plural = {mus: 'musiciens', multi: 'multi-instrumentistes', tech: 'techniciens'}[k];
    rows.push({category: 'Staff', label: `Cachets ${plural}${byJauge ? ` (${tier})` : ''}${cost == null ? ' — coût à renseigner' : ''}${gross != null ? ` — brut indicatif ${eur2(gross)} par cachet, non compté` : ''}`,
      qty: n, unit_cost: cost});
  }
  return rows;
}

/** Lignes du budget type pour une date : celui du spectacle de la date, sinon celui de l'artiste */
export function templateLines(s){
  const p = byId('projects', s.project_id), sp = s.spectacle_id ? byId('spectacles', s.spectacle_id) : null;
  const rows = [];
  if (sp){
    const t = spectTemplate(sp);
    // (v1.67) lignes nominatives si le spectacle en a ; sinon les effectifs (ancien modèle, inchangé)
    rows.push(...((t.people || []).length ? peopleRows(sp, s) : spectacleStaffRows(sp, s)));
    for (const x of t.extras || []) if (String(x.label || '').trim() || num(x.amount) != null)
      rows.push({category: x.category || 'Autres', label: String(x.label || '').trim() || null, forecast: num(x.amount)});
    if (num(t.peage) > 0) rows.push({category: 'VHR', label: 'Péage', forecast: num(t.peage)});
    if (num(t.essence) > 0) rows.push({category: 'VHR', label: 'Essence', forecast: num(t.essence)});
  } else {
    const t = templateOf(p), jauge = jaugeOf(s), cachet = cachetFor(t, jauge);
    if (usesRoles(p)) rows.push(...roleRows(p, s));   // (v1.67) valeurs par rôle ; l'ancien modèle ne sert que s'il n'y en a aucune
    else if (t.artists > 0) rows.push({category: 'Staff', label: `Cachets artistes${jauge ? ` (jauge ${jauge})` : ' (jauge à renseigner)'}`, qty: t.artists, unit_cost: cachet});
    if (!usesRoles(p) && t.techs > 0) rows.push({category: 'Staff', label: 'Cachets techniciens', qty: t.techs, unit_cost: t.payslip});
    if (t.peage > 0) rows.push({category: 'VHR', label: 'Péage', forecast: t.peage});
    if (t.essence > 0) rows.push({category: 'VHR', label: 'Essence', forecast: t.essence});
  }
  // frais Movinmotion : coût par bulletin du moment, figé sur la ligne (un changement du réglage ne touche pas ce budget)
  // (v1.67) seulement s'il y a des lignes au cachet : une rémunération sur facture ne génère aucun bulletin
  if (rows.some(r => r.category === 'Staff' && r.pay_mode !== 'facture'))
    rows.push({category: 'Movinmotion', label: 'Commission bulletins de paie', supplier: 'Movinmotion', auto: 'movinmotion', unit_cost: payslipCost()});
  if (cnmDue(s)) rows.push({category: 'Taxes', label: isFree(s) ? 'Taxe CNM (entrée gratuite)' : 'Taxe CNM (billetterie)', supplier: 'CNM', auto: 'cnm'});
  if (p?.artist_payee) rows.push({category: 'Solde artiste', label: 'Solde artiste', supplier: p.artist_payee, auto: 'solde_artiste'});
  return rows;
}

/**
 * Coûts manquants complétables depuis le budget type (demande d'Anthony du 07/11/2026, après saisie de la jauge) : pour chaque
 * ligne de la date dont le coût reste à renseigner (isMissingCost : quantité connue, prix, prévu et réel vides), le coût unitaire
 * que donne MAINTENANT le budget type de la date (spectacle, sinon artiste) pour la même ligne de cachets (même début de libellé :
 * « Cachets musiciens », « Cachets techniciens »…). Seules les lignes vides sont proposées ; une ligne déjà chiffrée n'est jamais
 * touchée ; la quantité saisie est gardée. Le libellé n'est remplacé que s'il porte encore la mention « à renseigner » du modèle.
 */
const costKey = label => String(label || '').split(' (')[0].split(' — ')[0].trim().toLowerCase();
export function costFillPlan(s){
  if (!s || s.prod_mode === 'booking' || s.result_closed_at) return [];
  const rows = templateLines(s).filter(r => r.category === 'Staff' && r.unit_cost != null);
  const out = [];
  for (const l of missingCostLines(s.id)){
    const r = rows.find(x => costKey(x.label) === costKey(l.label)); if (!r) continue;
    out.push({line: l, unit_cost: r.unit_cost, label: /à renseigner/.test(l.label || '') ? r.label : l.label});
  }
  return out;
}
/** Origine du budget type de la date, pour les messages : le spectacle choisi (jamais complété par l'artiste), sinon le modèle de
 *  l'artiste, réservé aux dates sans spectacle et nommé comme tel (décision du 07/11/2026) */
export const templateSource = s => { const sp = s?.spectacle_id ? byId('spectacles', s.spectacle_id) : null;
  return sp ? `du spectacle « ${sp.name || 'sans nom'} »` : 'de l’artiste (date sans spectacle)'; };
/**
 * Informations manquantes pour chiffrer les coûts vides de la date : jauge ouverte, ou coût absent du modèle du SPECTACLE choisi
 * (jamais remplacé par celui de l'artiste ni des Réglages, décision du 07/11/2026). Liste de textes, vide si rien ne manque.
 */
export function costGaps(s){
  const miss = missingCostLines(s?.id); if (!miss.length) return [];
  const out = [], sp = s.spectacle_id ? byId('spectacles', s.spectacle_id) : null, rows = templateLines(s).filter(r => r.category === 'Staff');
  if (jaugeOf(s) == null && rows.some(r => /jauge à renseigner/.test(r.label))) out.push('jauge ouverte de la date');
  for (const l of miss){
    if (isCnmToFill(l)){ out.push(`${CNM_TODO} : recettes de billetterie inconnues, montant prévu à saisir sur la ligne CNM`); continue; }
    const r = rows.find(x => costKey(x.label) === costKey(l.label));
    if (r && r.unit_cost == null && !/jauge à renseigner/.test(r.label)) out.push(`${costKey(l.label).replace(/^./, c => c.toUpperCase())} : coût absent du modèle ${sp ? `du spectacle « ${sp.name || 'sans nom'} »` : 'de l’artiste'}${/jauge/.test(r.label) ? ` (${r.label.match(/\((.*?)\)/)?.[1] || ''})` : ''}`);
    else if (!r) out.push(`${l.label || 'ligne sans libellé'} : absente du budget type ${templateSource(s)}, coût à saisir sur la ligne`);
  }
  return [...new Set(out)];
}
/** Propose (fenêtre de confirmation de l'application, jamais une fenêtre native) de compléter les coûts vides ; écriture
 *  conditionnelle : une ligne remplie entre-temps ailleurs n'est pas écrasée. manual = appelé depuis le bouton (message si rien) */
export async function offerCostFill(showId, {manual = false} = {}){
  const s = byId('shows', showId), plan = costFillPlan(s);
  if (!plan.length){ if (manual) toast(`Rien à compléter depuis le budget type ${templateSource(s)}${costGaps(s).length ? ' — à renseigner : ' + costGaps(s).join(' ; ') : ''}`); return false; }
  const gaps = costGaps(s).filter(g => !/^jauge/.test(g));
  const kept = linesOf(showId).filter(l => !isMissingCost(l) && rowsKeyed(s).has(costKey(l.label)) && !l.auto).length;
  const text = [`Jauge ouverte de la date : ${jaugeOf(s) ?? 'non renseignée'}. Compléter avec le budget type ${templateSource(s)} les coûts encore vides :`,
    ...plan.map(x => `• ${x.line.label || 'Cachets'} : ${Number(x.line.qty)} × ${eur2(Number(x.unit_cost))}`),
    'Seules les lignes vides sont complétées ; la quantité saisie est gardée.' + (kept ? ` ${kept} ligne${kept > 1 ? 's' : ''} déjà chiffrée${kept > 1 ? 's' : ''} : inchangée${kept > 1 ? 's' : ''}.` : ''),
    ...(gaps.length ? [`Restent à renseigner (rien n’est repris d’un autre modèle) : ${gaps.join(' ; ')}.`] : [])].join('\n');
  if (!(await confirmAsk('Compléter les coûts manquants ?', text, `Compléter ${plan.length} ligne${plan.length > 1 ? 's' : ''}`))) return false;
  let done = 0;
  for (const x of plan){
    const {data, error} = await sb.from('budget_lines').update({unit_cost: x.unit_cost, label: x.label}).eq('id', x.line.id)
      .is('unit_cost', null).is('forecast', null).is('amount', null).select();
    if (error){ toast('Complément impossible : ' + error.message, true); break; }
    if (data?.length){ mergeRows('budget_lines', data); done++; }
  }
  render();
  toast(done === plan.length ? `${done} coût${done > 1 ? 's' : ''} complété${done > 1 ? 's' : ''} depuis le budget type` : `${done} sur ${plan.length} complété${done > 1 ? 's' : ''} : les autres ont été remplies ailleurs entre-temps (non modifiées)`, done < plan.length);
  return done > 0;
}
const rowsKeyed = s => new Set(templateLines(s).filter(r => r.category === 'Staff').map(r => costKey(r.label)));

/** Pose le budget type sur une date (seulement si son budget est vide) ; quiet = sans message */
export async function applyTemplate(s, {quiet = false} = {}){
  if (!s || s.prod_mode === 'booking' || isProductionShow(s) || linesOf(s.id).length) return false;
  let sort = 1;
  const rows = templateLines(s).map(r => ({payer: 'compte', ...r, project_id: s.project_id, show_id: s.id, sort: sort++}));
  const {data, error} = await sb.from('budget_lines').insert(rows).select();
  if (error){ toast('Budget type impossible : ' + error.message, true); return false; }
  mergeRows('budget_lines', data); await refreshBudgetMarker(data);
  if (!quiet) toast('Budget prévisionnel prérempli (budget type) : ajoute ou retire des lignes si besoin');
  return true;
}

/** Formulaire du budget type : scope « settings » (Réglages) ou id d'artiste (valeurs vides = celles de Réglages) */
export function templateForm(scope){
  const isSettings = scope === 'settings';
  const own = isSettings ? (setting('budget_template') || {}) : (byId('projects', scope)?.budget_template || {});
  const g = setting('budget_template') || {};
  const inp = (k, cls = 'narrow', label = '') => `<input type="number" step="any" min="0" inputmode="decimal" class="${cls}" data-bt="${k}" data-bt-scope="${esc(scope)}" value="${esc(own[k] ?? '')}"${isSettings ? '' : ` placeholder="${esc(g[k] ?? '')}"`}${label ? ` aria-label="${esc(label)}"` : ''}>`;
  // (v1.67) tarif de cachet : unique ou deux tarifs (≤ 300 places, au-delà) ; technicien : tarif fixe
  const modeSel = r => { const v = own[r + '_rate_mode'] || '', inherited = !isSettings && !v ? (g[r + '_rate_mode'] || '') : '';
    return `<select data-bt="${r}_rate_mode" data-bt-text="1" data-bt-scope="${esc(scope)}" aria-label="${esc(roleLabel(r))} : tarif de cachet">
      ${isSettings ? '' : `<option value="">${inherited ? `comme les Réglages (${inherited === 'jauge' ? 'deux tarifs' : 'tarif unique'})` : 'comme les Réglages'}</option>`}
      <option value="single" ${v === 'single' ? 'selected' : ''}>Tarif unique</option><option value="jauge" ${v === 'jauge' ? 'selected' : ''}>Deux tarifs selon la jauge</option></select>`; };
  const mode = r => own[r + '_rate_mode'] || (!isSettings ? g[r + '_rate_mode'] : '') || 'single';
  const roleRow = ([r, label]) => `<tr><th scope="row">${esc(label)}</th>
      <td class="num">${inp(r + '_n', 'narrow', `${label} au cachet (nombre)`)}</td><td class="num">${inp(r + '_nf', 'narrow', `${label} sur facture (nombre)`)}</td>
      <td>${r === 'tech' ? `<span class="muted small">tarif fixe</span> ${inp(r + '_cachet', 'narrow2', 'Technicien : coût employeur d’un cachet')}`
        : `${modeSel(r)} ${mode(r) === 'jauge' ? `<span class="nowrap">≤ ${PETITE_JAUGE_MAX} pl. ${inp(r + '_cachet_small', 'narrow2', `${label} : jusqu’à ${PETITE_JAUGE_MAX} places`)}</span> <span class="nowrap">au-delà ${inp(r + '_cachet_large', 'narrow2', `${label} : au-delà de ${PETITE_JAUGE_MAX} places`)}</span>` : inp(r + '_cachet', 'narrow2', `${label} : tarif unique`)}`}</td>
      <td class="num">${inp(r + '_facture', 'narrow2', `${label} : tarif sur facture HT`)}</td></tr>`;
  return `<div class="bt-form bt-roles">
      <div class="tbl-wrap"><table class="bt-tiers"><caption>Par rôle (valeurs par défaut du préremplissage)</caption>
        <thead><tr><th>Rôle</th><th class="num">Au cachet (nb)</th><th class="num">Sur facture (nb)</th><th>Cachet : coût employeur (€)</th><th class="num">Facture HT (€)</th></tr></thead>
        <tbody>${ROLES.map(roleRow).join('')}</tbody></table></div>
      ${['peage', 'essence'].map(k => `<label class="bt-row"><span>${k === 'peage' ? 'Péage par date (€)' : 'Essence par date (€)'}</span>${inp(k)}</label>`).join('')}
    </div>
    <p class="help mt-sm">Nombres : lignes posées sur une date sans spectacle. Tarifs : aussi ceux d’une personne du budget type d’un spectacle qui n’a pas son propre tarif. Movinmotion (${eur2(payslipCost())} par bulletin, artistes et techniciens) : seulement pour les personnes au cachet ; sur facture, aucun bulletin. ${isSettings ? 'Chaque artiste peut remplacer ces valeurs sur sa fiche.' : 'Cases vides = valeurs de Réglages (en gris).'}</p>
    <details class="mt-sm"><summary class="muted small">Ancien modèle (3 tranches de jauge) — conservé, utilisé seulement tant qu’aucune valeur par rôle n’est renseignée</summary>
    <div class="bt-form">
      ${BT_FIELDS.filter(([k]) => !['peage', 'essence'].includes(k)).map(([k, l]) => `<label class="bt-row"><span>${l}</span>${inp(k)}</label>`).join('')}
      <table class="bt-tiers"><caption>Cachet d’un artiste selon la jauge</caption>
        <thead><tr><th>Jauge</th><th class="num">Cachet (€)</th></tr></thead><tbody>
        <tr><td>jusqu’à ${inp('t1max')} places</td><td class="num">${inp('t1')}</td></tr>
        <tr><td>jusqu’à ${inp('t2max')} places</td><td class="num">${inp('t2')}</td></tr>
        <tr><td>au-delà</td><td class="num">${inp('t3')}</td></tr>
      </tbody></table>
    </div></details>`;
}

// les enregistrements se suivent (deux champs changés vite ne s'écrasent pas) ; la copie locale est mise à jour tout de suite
let queue = Promise.resolve();
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset?.bt) return;
  e.stopPropagation();
  const scope = el.dataset.btScope, k = el.dataset.bt;
  // (v1.67) choix du tarif (unique / deux tarifs) : texte ; sinon nombre (vide = valeur par défaut)
  const v = el.dataset.btText ? (['single', 'jauge'].includes(el.value) ? el.value : null) : num(String(el.value).replace(',', '.'));
  queue = queue.then(async () => {
    if (scope === 'settings'){
      let row = S.db.settings.find(x => x.key === 'budget_template');
      if (!row){ row = {key: 'budget_template', value: {}}; S.db.settings.push(row); }
      const prev = row.value, cur = {...(prev || {})}; if (v == null) delete cur[k]; else cur[k] = v;
      row.value = cur;
      const {error} = await sb.from('settings').upsert({key: 'budget_template', value: cur}, {onConflict: 'key'});
      if (error){ row.value = prev; toast(error.message, true); return render(); }
      touch('settings'); toast('Budget type enregistré');
    } else {
      const p = byId('projects', scope); if (!p) return;
      const cur = {...(p.budget_template || {})}; if (v == null) delete cur[k]; else cur[k] = v;
      if (await save('projects', scope, {budget_template: cur}, {rerender: false})) toast('Budget type de l’artiste enregistré');
    }
    render();
  });
}, true);

/* ───────────── Budget type d'un spectacle (v1.57) ───────────── */
/** Champs du budget type d'un spectacle : [clé, libellé] (montants en € ; coût employeur charges comprises ; brut pour information) */
export function spectFields(){
  const out = SPECT_COUNTS.map(([k, l]) => [k, l]);
  for (const [k, l, byJauge] of SPECT_RATES){
    if (byJauge){
      out.push([k + '_small', `${l} — petite jauge (≤ ${PETITE_JAUGE_MAX} places) : coût employeur (€)`], [k + '_small_brut', `${l} — petite jauge : brut (€, pour information)`],
        [k + '_large', `${l} — grande jauge (> ${PETITE_JAUGE_MAX} places) : coût employeur (€)`], [k + '_large_brut', `${l} — grande jauge : brut (€, pour information)`]);
    } else out.push([k, `${l} — coût employeur, toutes jauges (€)`], [k + '_brut', `${l} — brut (€, pour information)`]);
  }
  return out.concat(SPECT_EXTRA);
}
/** Champs encore vides d'un budget type de spectacle, parmi ceux qui servent (effectif renseigné) : jamais complétés par l'artiste ou
 *  les Réglages — affichés « à renseigner » */
export function spectMissing(sp){
  const t = spectTemplate(sp), miss = [];
  // (v1.67) personnes : tarif absent à la fois sur la ligne et pour son rôle (artiste, Réglages) ; la jauge se juge sur la date
  if ((t.people || []).length){
    const p = byId('projects', sp.project_id);
    (t.people || []).forEach((x, i) => { const mode = x.mode === 'facture' ? 'facture' : 'cachet', src = ownRate(x, mode) ? x : roleDefaults(p, x.role || 'mus');
      const ok = mode === 'facture' ? filled(src.facture) : (x.role === 'tech' ? filled(src.cachet) : filled(src.cachet) || (filled(src.cachet_small) && filled(src.cachet_large)));
      if (!ok) miss.push(`${String(x.name || '').trim() || `ligne ${i + 1}`} — tarif ${mode === 'facture' ? 'sur facture' : 'de cachet'}`); });
    return miss;
  }
  if (!SPECT_COUNTS.some(([k]) => num(t[k]) > 0)) miss.push('effectifs (musiciens, multi-instrumentistes, techniciens)');
  for (const [k, l, byJauge] of SPECT_RATES){
    if (!(num(t[k + '_n']) > 0)) continue;
    for (const key of byJauge ? [k + '_small', k + '_large'] : [k]) if (num(t[key]) == null)
      miss.push(`${l.toLowerCase()} — ${key.endsWith('_small') ? 'petite jauge' : key.endsWith('_large') ? 'grande jauge' : 'coût'}`);
  }
  return miss;
}
/** Formulaire du budget type d'un spectacle (enregistré champ par champ) */
export function spectacleForm(sp){
  const t = spectTemplate(sp), miss = spectMissing(sp), people = t.people || [], extras = t.extras || [];
  const inp = (k, label) => `<label class="bt-row"><span>${esc(label)}</span><input type="number" step="any" min="0" inputmode="decimal" class="narrow2" data-spt="${k}" data-spt-id="${esc(sp.id)}" value="${esc(t[k] ?? '')}" aria-label="${esc(label)}"></label>`;
  // (v1.67) une ligne par personne : nom, rôle, mode (cachet / facture), tarif propre (vide = celui du rôle : artiste, sinon Réglages)
  const p = byId('projects', sp.project_id);
  const pin = (i, k, v, label, type = 'number') => `<input type="${type}" ${type === 'number' ? 'step="any" min="0" inputmode="decimal" class="narrow2"' : 'class="sp-name"'} data-spp="${k}" data-spp-i="${i}" data-spt-id="${esc(sp.id)}" value="${esc(v ?? '')}" aria-label="${esc(label)}"${type === 'number' ? ` placeholder="${esc(String(rolePh(p, people[i], k) ?? ''))}"` : ''}>`;
  const sel = (i, k, v, opts, label) => `<select data-spp="${k}" data-spp-i="${i}" data-spt-id="${esc(sp.id)}" aria-label="${esc(label)}">${opts.map(([o, l]) => `<option value="${o}" ${String(v ?? '') === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const personRow = (x, i) => { const r = x.role || 'mus', mode = x.mode === 'facture' ? 'facture' : 'cachet', n = x.name || `ligne ${i + 1}`;
    const rate = mode === 'facture' ? pin(i, 'facture', x.facture, `${n} : tarif sur facture HT`)
      : r === 'tech' ? `<span class="muted small">fixe</span> ${pin(i, 'cachet', x.cachet, `${n} : coût employeur d’un cachet`)}`
      : `${sel(i, 'rate_mode', x.rate_mode || '', [['', 'tarif du rôle'], ['single', 'tarif unique'], ['jauge', 'deux tarifs (jauge)']], `${n} : tarif de cachet`)}
         ${x.rate_mode === 'jauge' ? `<span class="nowrap">≤ ${PETITE_JAUGE_MAX} ${pin(i, 'cachet_small', x.cachet_small, `${n} : jusqu’à ${PETITE_JAUGE_MAX} places`)}</span> <span class="nowrap">au-delà ${pin(i, 'cachet_large', x.cachet_large, `${n} : au-delà de ${PETITE_JAUGE_MAX} places`)}</span>`
           : x.rate_mode === 'single' ? pin(i, 'cachet', x.cachet, `${n} : tarif unique`) : ''}`;
    return `<tr><td>${pin(i, 'name', x.name, `Nom de la personne ${i + 1}`, 'text')}</td>
      <td>${sel(i, 'role', r, ROLES.map(([k, l]) => [k, l]), `${n} : rôle`)}</td>
      <td>${sel(i, 'mode', mode, [['cachet', 'Au cachet'], ['facture', 'Sur facture']], `${n} : mode de rémunération`)}</td>
      <td>${rate}</td>
      <td><button type="button" class="btn icon sm ghost danger" data-spp-act="delPerson" data-spp-i="${i}" data-spt-id="${esc(sp.id)}" aria-label="Retirer ${esc(n)}">✕</button></td></tr>`; };
  const extraRow = (x, i) => `<tr><td><input type="text" data-spx="label" data-spp-i="${i}" data-spt-id="${esc(sp.id)}" value="${esc(x.label ?? '')}" aria-label="Libellé de la ligne de coût ${i + 1}" placeholder="Libellé"></td>
      <td><select data-spx="category" data-spp-i="${i}" data-spt-id="${esc(sp.id)}" aria-label="Catégorie de la ligne de coût ${i + 1}">${BUDGET_CATS.filter(c => !['Staff', 'Movinmotion', 'Solde artiste'].includes(c)).map(c => `<option ${String(x.category || 'Autres') === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
      <td class="num"><input type="number" step="any" min="0" inputmode="decimal" class="narrow2" data-spx="amount" data-spp-i="${i}" data-spt-id="${esc(sp.id)}" value="${esc(x.amount ?? '')}" aria-label="Montant HT de la ligne de coût ${i + 1}"></td>
      <td><button type="button" class="btn icon sm ghost danger" data-spp-act="delExtra" data-spp-i="${i}" data-spt-id="${esc(sp.id)}" aria-label="Retirer la ligne de coût">✕</button></td></tr>`;
  return `${miss.length ? `<p class="mode-note">À renseigner : ${esc(miss.join(' ; '))}.</p>` : ''}
    <div class="tbl-wrap"><table class="bt-tiers bt-people"><caption>Personnes (une ligne par personne)</caption>
      <thead><tr><th>Nom</th><th>Rôle</th><th>Mode</th><th>Tarif (€ ; vide = tarif du rôle)</th><th></th></tr></thead>
      <tbody>${people.map(personRow).join('') || '<tr><td colspan="5" class="muted small">Aucune personne : les effectifs ci-dessous (ancien modèle) servent encore.</td></tr>'}</tbody></table></div>
    <button type="button" class="btn sm" data-spp-act="addPerson" data-spt-id="${esc(sp.id)}">Ajouter une personne</button>
    <div class="tbl-wrap mt-sm"><table class="bt-tiers"><caption>Autres lignes de coût</caption>
      <thead><tr><th>Libellé</th><th>Catégorie</th><th class="num">Montant HT (€)</th><th></th></tr></thead>
      <tbody>${extras.map(extraRow).join('') || '<tr><td colspan="4" class="muted small">Aucune.</td></tr>'}</tbody></table></div>
    <button type="button" class="btn sm" data-spp-act="addExtra" data-spt-id="${esc(sp.id)}">Ajouter une ligne de coût</button>
    <div class="bt-form mt-sm">${SPECT_EXTRA.map(([k, l]) => inp(k, l)).join('')}</div>
    <details class="mt-sm"><summary class="muted small">Ancien modèle par effectifs — utilisé seulement tant qu’aucune personne n’est saisie</summary>
      <div class="bt-form">${spectFields().filter(([k]) => !SPECT_EXTRA.some(([e]) => e === k)).map(([k, l]) => inp(k, l)).join('')}</div></details>
    <p class="help mt-sm">Au cachet : coût employeur, charges comprises ; sur facture : montant HT, sans bulletin. Tarif vide = celui du rôle (budget type de l’artiste, sinon Réglages). Frais Movinmotion (${eur2(payslipCost())} par bulletin, Réglages) ajoutés à part, seulement pour les personnes au cachet. Copié dans le budget vide d’une date de ce spectacle ; le modifier ne change pas les budgets existants. Spectacle décoché « actif » = archivé : plus proposé pour les nouvelles dates, ses dates le gardent.</p>`;
}
/** Tarif du rôle affiché en gris dans une case vide d'une personne (ce qui sera repris) */
function rolePh(p, x, k){
  if (!x) return null; const d = roleDefaults(p, x.role || 'mus');
  return {facture: d.facture, cachet: d.cachet, cachet_small: d.cachet_small, cachet_large: d.cachet_large}[k] ?? null;
}
/** Valeur saisie → nombre ≥ 0, ou null (vide) ; refus d'un nombre négatif ou illisible */
export function spectValue(raw){
  const s = String(raw ?? '').trim().replace(',', '.'); if (s === '') return {ok: true, v: null};
  const v = Number(s); return isNaN(v) || v < 0 ? {ok: false} : {ok: true, v};
}
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset?.spt) return;
  e.stopPropagation();
  const sp = byId('spectacles', el.dataset.sptId), k = el.dataset.spt, r = spectValue(el.value);
  if (!sp) return;
  if (!r.ok){ toast('Montant ou nombre invalide (positif ou vide)', true); el.value = spectTemplate(sp)[k] ?? ''; return; }
  queue = queue.then(async () => {
    const cur = {...spectTemplate(byId('spectacles', sp.id))}; if (r.v == null) delete cur[k]; else cur[k] = r.v;
    if (await save('spectacles', sp.id, {budget_template: cur}, {rerender: false})) toast('Budget type du spectacle enregistré');
    render();
  });
}, true);

/* (v1.67) personnes et lignes de coût d'un spectacle : enregistrées à chaque changement (copie du modèle, puis enregistrement) */
async function saveSpect(spId, change){
  queue = queue.then(async () => {
    const sp = byId('spectacles', spId); if (!sp) return;
    const cur = JSON.parse(JSON.stringify(spectTemplate(sp))); change(cur);
    if (await save('spectacles', sp.id, {budget_template: cur}, {rerender: false})) toast('Budget type du spectacle enregistré');
    render();
  });
  return queue;
}
const newId = () => (crypto.randomUUID?.() || String(Date.now() + Math.random()));
document.addEventListener('change', e => {
  const el = e.target; const k = el.dataset?.spp || el.dataset?.spx; if (!k) return;
  e.stopPropagation();
  const list = el.dataset.spp ? 'people' : 'extras', i = Number(el.dataset.sppI), text = ['name', 'label', 'role', 'mode', 'rate_mode', 'category'].includes(k);
  let v = el.value;
  if (!text){ const r = spectValue(v); if (!r.ok){ toast('Montant invalide (positif ou vide)', true); el.value = (spectTemplate(byId('spectacles', el.dataset.sptId))[list] || [])[i]?.[k] ?? ''; return; } v = r.v; }
  else v = String(v).trim() || null;
  saveSpect(el.dataset.sptId, t => { const arr = t[list] ||= []; if (!arr[i]) return; if (v == null) delete arr[i][k]; else arr[i][k] = v; });
}, true);
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-spp-act]'); if (!b) return;
  e.preventDefault();
  const act = b.dataset.sppAct, i = Number(b.dataset.sppI);
  if (act === 'addPerson') saveSpect(b.dataset.sptId, t => { (t.people ||= []).push({id: newId(), role: 'mus', mode: 'cachet'}); });
  if (act === 'addExtra') saveSpect(b.dataset.sptId, t => { (t.extras ||= []).push({id: newId(), category: 'Autres'}); });
  if (act === 'delPerson' || act === 'delExtra'){
    const list = act === 'delPerson' ? 'people' : 'extras', x = (spectTemplate(byId('spectacles', b.dataset.sptId))[list] || [])[i];
    confirmAsk(act === 'delPerson' ? 'Retirer la personne ?' : 'Retirer la ligne de coût ?', `« ${x?.name || x?.label || 'sans nom'} » sera retiré du budget type du spectacle. Les budgets des dates existantes ne changent pas.`, 'Retirer', {danger: true})
      .then(ok => ok && saveSpect(b.dataset.sptId, t => { (t[list] || []).splice(i, 1); }));
  }
});

