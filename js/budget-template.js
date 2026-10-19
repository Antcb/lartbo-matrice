/**
 * 📋 Budget type : le budget prévisionnel posé automatiquement sur chaque nouvelle date confirmée (en production).
 * Valeurs par défaut dans Réglages › Budget type ; chaque artiste peut en remplacer une partie (fiche de l'artiste).
 *  - cachets artistes : nombre d'artistes × cachet selon la jauge (3 tranches)
 *  - cachets techniciens : nombre × coût fixe d'un bulletin
 *  - péage, essence : forfait par date
 *  - Movinmotion (coût par bulletin × nombre de bulletins), taxe CNM si entrée gratuite, solde artiste : calculés seuls
 * Ensuite on ajoute / retire les lignes à la main.
 */
import { render } from './app.js';
import { cnmDue, linesOf } from './budget.js';
import { save, sb, mergeRows } from './data.js';
import { isProductionShow } from './production-budget.js';
import { byId, eventsOfStructure, setting } from './selectors.js';
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
/** Jauge d'une date : celle de la date, sinon celle du festival / de la salle */
export function jaugeOf(s){
  if (num(s.capacity)) return Number(s.capacity);
  const caps = eventsOfStructure(s.structure_id).map(e => num(e.capacity)).filter(Boolean);
  return caps.length ? Math.max(...caps) : null;
}
export function cachetFor(t, jauge){
  if (jauge == null) return t.t2 || t.t1 || t.t3;
  return jauge <= t.t1max ? t.t1 : jauge <= t.t2max ? t.t2 : t.t3;
}

/** Lignes du budget type pour une date */
export function templateLines(s){
  const p = byId('projects', s.project_id), t = templateOf(p), jauge = jaugeOf(s), cachet = cachetFor(t, jauge);
  const rows = [];
  if (t.artists > 0) rows.push({category: 'Staff', label: `Cachets artistes${jauge ? ` (jauge ${jauge})` : ''}`, qty: t.artists, unit_cost: cachet});
  if (t.techs > 0) rows.push({category: 'Staff', label: 'Cachets techniciens', qty: t.techs, unit_cost: t.payslip});
  if (t.peage > 0) rows.push({category: 'VHR', label: 'Péage', forecast: t.peage});
  if (t.essence > 0) rows.push({category: 'VHR', label: 'Essence', forecast: t.essence});
  rows.push({category: 'Movinmotion', label: 'Commission bulletins de paie', supplier: 'Movinmotion', auto: 'movinmotion'});
  if (cnmDue(s)) rows.push({category: 'Taxes', label: 'Taxe CNM (entrée gratuite)', supplier: 'CNM', auto: 'cnm'});
  if (p?.artist_payee) rows.push({category: 'Solde artiste', label: 'Solde artiste', supplier: p.artist_payee, auto: 'solde_artiste'});
  return rows;
}

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
    <p class="help" style="margin:8px 0 0">${isSettings ? 'Posé sur chaque nouvelle date confirmée en production. Movinmotion (' + eur2(Number(setting('movinmotion_payslip_cost') ?? 20.3)) + ' par bulletin), la taxe CNM et le solde artiste se calculent seuls. Chaque artiste peut remplacer ces valeurs sur sa fiche.'
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
      const cur = {...(row.value || {})}; if (v == null) delete cur[k]; else cur[k] = v;
      row.value = cur;
      const {error} = await sb.from('settings').upsert({key: 'budget_template', value: cur}, {onConflict: 'key'});
      if (error) return toast(error.message, true);
      touch('settings'); toast('Budget type enregistré');
    } else {
      const p = byId('projects', scope); if (!p) return;
      const cur = {...(p.budget_template || {})}; if (v == null) delete cur[k]; else cur[k] = v;
      p.budget_template = cur;
      if (await save('projects', scope, {budget_template: cur}, {rerender: false})) toast('Budget type de l’artiste enregistré');
    }
    render();
  });
}, true);
