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
import { cnmDue, isFree, isMissingCost, linesOf, missingCostLines, payslipCost } from './budget.js';
import { confirmAsk } from './ui/dialog.js';
import { save, sb, mergeRows } from './data.js';
import { isProductionShow } from './production-budget.js';
import { byId, setting } from './selectors.js';
import { S, touch } from './state.js';
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
    rows.push(...spectacleStaffRows(sp, s));
    if (num(t.peage) > 0) rows.push({category: 'VHR', label: 'Péage', forecast: num(t.peage)});
    if (num(t.essence) > 0) rows.push({category: 'VHR', label: 'Essence', forecast: num(t.essence)});
  } else {
    const t = templateOf(p), jauge = jaugeOf(s), cachet = cachetFor(t, jauge);
    if (t.artists > 0) rows.push({category: 'Staff', label: `Cachets artistes${jauge ? ` (jauge ${jauge})` : ' (jauge à renseigner)'}`, qty: t.artists, unit_cost: cachet});
    if (t.techs > 0) rows.push({category: 'Staff', label: 'Cachets techniciens', qty: t.techs, unit_cost: t.payslip});
    if (t.peage > 0) rows.push({category: 'VHR', label: 'Péage', forecast: t.peage});
    if (t.essence > 0) rows.push({category: 'VHR', label: 'Essence', forecast: t.essence});
  }
  // frais Movinmotion : coût par bulletin du moment, figé sur la ligne (un changement du réglage ne touche pas ce budget)
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
  mergeRows('budget_lines', data);
  if (!quiet) toast('Budget prévisionnel prérempli (budget type) : ajoute ou retire des lignes si besoin');
  return true;
}

/** Formulaire du budget type : scope « settings » (Réglages) ou id d'artiste (valeurs vides = celles de Réglages) */
export function templateForm(scope){
  const isSettings = scope === 'settings';
  const own = isSettings ? (setting('budget_template') || {}) : (byId('projects', scope)?.budget_template || {});
  const g = setting('budget_template') || {};
  const inp = (k, cls = 'narrow') => `<input type="number" step="any" inputmode="decimal" class="${cls}" data-bt="${k}" data-bt-scope="${esc(scope)}" value="${esc(own[k] ?? '')}"${isSettings ? '' : ` placeholder="${esc(g[k] ?? '')}"`}>`;
  return `<div class="bt-form">
      ${BT_FIELDS.map(([k, l]) => `<label class="bt-row"><span>${l}</span>${inp(k)}</label>`).join('')}
      <table class="bt-tiers"><caption>Cachet d’un artiste selon la jauge</caption>
        <thead><tr><th>Jauge</th><th class="num">Cachet (€)</th></tr></thead><tbody>
        <tr><td>jusqu’à ${inp('t1max')} places</td><td class="num">${inp('t1')}</td></tr>
        <tr><td>jusqu’à ${inp('t2max')} places</td><td class="num">${inp('t2')}</td></tr>
        <tr><td>au-delà</td><td class="num">${inp('t3')}</td></tr>
      </tbody></table>
    </div>
    <p class="help mt-sm">${isSettings ? 'Posé sur chaque nouvelle date confirmée en production. Movinmotion (' + eur2(Number(setting('movinmotion_payslip_cost') ?? 20.3)) + ' par bulletin), la taxe CNM et le solde artiste se calculent seuls. Chaque artiste peut remplacer ces valeurs sur sa fiche.'
      : 'Cases vides = valeurs de Réglages (en gris). Posé sur chaque nouvelle date confirmée ; ensuite tu ajoutes ou retires des lignes.'}</p>`;
}

// les enregistrements se suivent (deux champs changés vite ne s'écrasent pas) ; la copie locale est mise à jour tout de suite
let queue = Promise.resolve();
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset?.bt) return;
  e.stopPropagation();
  const scope = el.dataset.btScope, k = el.dataset.bt, v = num(String(el.value).replace(',', '.'));
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
  const t = spectTemplate(sp), miss = spectMissing(sp);
  const inp = (k, label) => `<label class="bt-row"><span>${esc(label)}</span><input type="number" step="any" min="0" inputmode="decimal" class="narrow2" data-spt="${k}" data-spt-id="${esc(sp.id)}" value="${esc(t[k] ?? '')}" aria-label="${esc(label)}"></label>`;
  return `${miss.length ? `<p class="mode-note">À renseigner : ${esc(miss.join(' ; '))}. Rien n’est repris du budget type de l’artiste ni des Réglages.</p>` : ''}
    <div class="bt-form">${spectFields().map(([k, l]) => inp(k, l)).join('')}</div>
    <p class="help mt-sm">Coûts employeur, charges comprises ; le brut est affiché sur les lignes pour information et n’est jamais ajouté aux dépenses. Frais Movinmotion (${eur2(payslipCost())} par bulletin, Réglages) ajoutés à part. Copié dans le budget vide d’une date de ce spectacle ; le modifier ne change pas les budgets existants. Spectacle décoché « actif » = archivé : plus proposé pour les nouvelles dates, ses dates le gardent.</p>`;
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
