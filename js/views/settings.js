/**
 * Réglages : pourcentages par défaut (acompte + solde = 100 %), partenaires, version.
 */
import { APP_VERSION } from '../config.js';
import { sb } from '../data.js';
import { setting } from '../selectors.js';
import { S, touch } from '../state.js';
import { viewHead } from '../ui/bits.js';
import { cIn } from '../ui/cells.js';
import { esc, toast } from '../utils.js';
import { render } from '../app.js';

export function viewSettings(){
  const ac = Number(setting('default_acompte_pct') ?? 0);
  return viewHead('Réglages') + `
  <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(360px,1fr))">
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Pourcentages par défaut</h3>
      <p class="help" style="margin:0 0 12px">Appliqués aux nouvelles dates confirmées. Chaque date et chaque projet peuvent les remplacer.</p>
      <div class="steps">
        <label for="set-ac">Acompte (% du cachet)</label><input id="set-ac" type="number" step="any" data-act-setting="default_acompte_pct" value="${esc(ac)}">
        <label>Solde</label><span><b>${esc(100 - ac)} %</b> <span class="muted">(100 % − acompte)</span></span>
        <label for="set-artbo">Commission L'ArtBo si le projet n'en précise pas (%)</label><input id="set-artbo" type="number" step="any" data-act-setting="default_artbo_pct" value="${esc(setting('default_artbo_pct')??'')}">
        <label for="set-cnm">Taxe CNM (%)</label><input id="set-cnm" type="number" step="any" data-act-setting="default_cnm_pct" value="${esc(setting('default_cnm_pct')??'')}">
      </div></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Partenaires / co-producteurs</h3>
      <p class="help" style="margin:0 0 12px">% de la commission L'ArtBo reversé au partenaire, sur les projets où il est choisi.</p>
      <table><tbody>${S.db.partners.map(p=>`<tr><td>${cIn('partners',p.id,'name',p.name)}</td><td class="num">${cIn('partners',p.id,'default_pct',p.default_pct,'number','class="narrow"')} %</td></tr>`).join('')}</tbody></table>
      <button class="btn sm" data-act="newPartner" style="margin-top:10px">Ajouter un partenaire</button></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Version</h3>
      <p>Matrice L'ArtBoristerie Productions <b>v${APP_VERSION}</b></p>
      <p class="help">Historique des mises à jour : <a href="CHANGELOG.md" target="_blank" rel="noopener">journal des versions</a>.</p></div>
  </div>`;
}

async function setSetting(key, value){
  const {error} = await sb.from('settings').update({value}).eq('key', key);
  if (error) { toast(error.message, true); return false; }
  const s = S.db.settings.find(x=>x.key===key); if (s) s.value = value; touch('settings');
  return true;
}

document.addEventListener('change', async e => {
  const k = e.target.dataset.actSetting; if (!k) return;
  const v = e.target.value===''?null:Number(e.target.value);
  if (k==='default_acompte_pct'){
    if (v==null || v<0 || v>100) return toast("L'acompte doit être entre 0 et 100 %", true);
    if (await setSetting(k, v) && await setSetting('default_solde_pct', 100 - v)) toast(`Acompte ${v} % · solde ${100 - v} %`);
    return render();
  }
  if (await setSetting(k, v)) toast('Réglage enregistré');
});
