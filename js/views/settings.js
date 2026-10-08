/**
 * Onglet Réglages : pourcentages par défaut, partenaires, version.
 */
import { APP_VERSION } from '../config.js';
import { sb } from '../data.js';
import { setting } from '../selectors.js';
import { S } from '../state.js';
import { cIn } from '../ui/cells.js';
import { esc, toast } from '../utils.js';

export function viewSettings(){
  const keys = [['default_acompte_pct','Acompte par défaut (% du cachet)'],['default_solde_pct','Solde par défaut (%)'],['default_artbo_pct',"Commission L'ArtBo si le projet n'en précise pas (%)"],['default_cnm_pct','Taxe CNM (%)']];
  return `<div class="view-head"><h1>Réglages</h1></div>
  <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">
    <div class="panel" style="padding:16px"><h3 style="margin-top:0">Pourcentages par défaut</h3>
      <p class="muted">Appliqués aux nouvelles dates confirmées. Chaque date et chaque projet peuvent les remplacer.</p>
      <div class="steps">${keys.map(([k,l])=>`<label>${l}</label><input type="number" step="any" data-act-setting="${k}" value="${esc(setting(k)??'')}">`).join('')}</div></div>
    <div class="panel" style="padding:16px"><h3 style="margin-top:0">Partenaires / co-producteurs</h3><p class="muted">% de la commission L'ArtBo reversé au partenaire. Le partenaire s'applique aux projets où il est choisi.</p>
      <table><tbody>${S.db.partners.map(p=>`<tr><td>${cIn('partners',p.id,'name',p.name)}</td><td class="num">${cIn('partners',p.id,'default_pct',p.default_pct,'number','step="any"')} %</td></tr>`).join('')}</tbody></table>
      <button class="btn small" data-act="newPartner" style="margin-top:8px">Ajouter un partenaire</button></div>
    <div class="panel" style="padding:16px"><h3 style="margin-top:0">Version</h3>
      <p>Matrice Booking <b>v${APP_VERSION}</b></p>
      <p class="muted">L'historique des mises à jour est dans le fichier <a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG.md</a>.</p></div>
  </div>`;
}

document.addEventListener('change', async e => {
  const k = e.target.dataset.actSetting; if (!k) return;
  const v = e.target.value===''?null:Number(e.target.value);
  const {error} = await sb.from('settings').update({value: v}).eq('key', k);
  if (error) return toast(error.message, true);
  const s = S.db.settings.find(x=>x.key===k); if (s) s.value=v; toast('Réglage enregistré');
});
