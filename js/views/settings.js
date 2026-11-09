/**
 * Réglages : pourcentages par défaut (acompte + solde = 100 %), partenaires, version.
 */
import { ask, confirmAsk } from '../ui/dialog.js';
import { APP_VERSION } from '../config.js';
import { sb } from '../data.js';
import { departments, setting, settingAcompte } from '../selectors.js';
import { fetchAll } from '../data.js';
import { S, touch } from '../state.js';
import { isCoproduction, isInvoiced, paymentsOf } from '../calc.js';
import { viewHead } from '../ui/bits.js';
import { cIn } from '../ui/cells.js';
import { esc, toast, pct, today, fmtDate } from '../utils.js';
import { DELAY_RULES, DELAY_MAX, TASK_DELAYS, WEEKEND_RULES, delaysAnomalies, delaysOf, okFrom, okVersion, remindersOf, taskDelay, taskDelayAnomaly } from '../reminders.js';
import { CONFIRMED_PROD } from '../constants.js';
import { render } from '../app.js';
import { templatesList } from '../mail.js';
import { templateForm } from '../budget-template.js';
import { FONTS, SIZES, mailFont, rtStyle, rtToolbar } from '../ui/richtext.js';

export function viewSettings(){
  const acRaw = setting('default_acompte_pct'), ac = settingAcompte(), acShown = acRaw == null || String(acRaw).trim() === '' ? '' : ac;   // vide : affiché vide (50 % appliqué), jamais 0 (§6.4)
  return viewHead('Réglages') + `
  <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(360px,1fr))">
    <div class="panel pad"><h3 class="panel-title">Pourcentages par défaut</h3>
      <p class="help mb">Appliqués aux nouvelles dates confirmées. Chaque date et chaque projet peuvent les remplacer.</p>
      <div class="steps kv-grid">
        <label for="set-ac">Acompte (% du cachet)</label><input id="set-ac" type="number" step="any" data-act-setting="default_acompte_pct" value="${esc(acShown)}" placeholder="50">
        <label>Solde (100 % − acompte)</label><span><b>${esc(pct(100 - ac))}</b></span>
        <label for="set-artbo-b">Commission L'ArtBo par défaut — booking (%)</label><input id="set-artbo-b" type="number" step="any" data-act-setting="default_artbo_pct_booking" value="${esc(setting('default_artbo_pct_booking')??15)}">
        <label for="set-artbo-p">Commission L'ArtBo par défaut — production (%)</label><input id="set-artbo-p" type="number" step="any" data-act-setting="default_artbo_pct_production" value="${esc(setting('default_artbo_pct_production')??20)}">
        <label for="set-cnm">Taxe CNM (%)</label><input id="set-cnm" type="number" step="any" data-act-setting="default_cnm_pct" value="${esc(setting('default_cnm_pct')??'')}">
        <label for="set-mvm">Coût Movinmotion par bulletin (€)</label><input id="set-mvm" type="number" step="any" data-act-setting="movinmotion_payslip_cost" value="${esc(setting('movinmotion_payslip_cost')??'')}">
      </div>
      <p class="help mt mb-sm">Les nouvelles dates confirmées prennent ces pourcentages. Les dates déjà confirmées gardent les leurs, sauf si tu les mets à jour :</p>
      ${ac === 0 ? '' : `<button class="btn sm" data-act="applyAcompte">Appliquer ${esc(pct(ac))} / ${esc(pct(100-ac))} aux acomptes et soldes pas encore envoyés</button>`}</div>
    <div class="panel pad"><h3 class="panel-title">Budget type</h3>
      <p class="help mb">Le budget prévisionnel posé sur chaque nouvelle date confirmée en production.</p>
      ${templateForm('settings')}</div>
    <div class="panel pad"><h3 class="panel-title">Pôles des tâches</h3>
      <p class="help mb">Renommer un pôle met à jour les tâches qui l’utilisent.</p>
      ${departments().map((d,i)=>`<div class="link-row" style="grid-template-columns:44px 1fr auto"><input type="color" value="${esc(d.color)}" data-dept="${i}" data-k="color" aria-label="Couleur du pôle ${esc(d.name)}" style="padding:2px;height:32px">
        <input value="${esc(d.name)}" data-dept="${i}" data-k="name" aria-label="Nom du pôle">
        <button class="btn icon sm ghost danger" data-act="rmDept" data-i="${i}" aria-label="Supprimer le pôle ${esc(d.name)}">✕</button></div>`).join('')}
      <button class="btn sm mt" data-act="addDept">Ajouter un pôle</button></div>
    <div class="panel pad"><h3 class="panel-title">Partenaires / co-producteurs</h3>
      <p class="help mb">% de la commission L'ArtBo reversé au partenaire, sur les projets où il est choisi.</p>
      <table><tbody>${S.db.partners.map(p=>`<tr><td>${cIn('partners',p.id,'name',p.name)}</td><td class="num">${cIn('partners',p.id,'default_pct',p.default_pct,'number','class="narrow"')} %</td></tr>`).join('')}</tbody></table>
      <button class="btn sm mt" data-act="newPartner">Ajouter un partenaire</button></div>
    <div class="panel pad" style="grid-column:1/-1"><h3 class="panel-title">Modèles de mail</h3>
      <p class="help mb">Rangés par type de mail : clique sur un groupe pour le déplier. Les modèles « génériques » servent pour les artistes qui n’ont pas le leur. Les balises comme {{date}} ou {{structure}} sont remplacées par les infos de la date ou de la structure ; une balise inconnue (ex. {{date_concert}}) reste surlignée en jaune pour être complétée à la main.</p>
      <div class="steps mb">
        <label for="set-mfont">Police par défaut des mails</label><select id="set-mfont" data-setting-text="mail_font">${FONTS.map(([v, l]) => `<option value="${esc(v)}" ${v === mailFont().family ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <label for="set-msize">Taille par défaut</label><select id="set-msize" data-setting-text="mail_font_size">${SIZES.map(n => `<option value="${n}" ${n === mailFont().size ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </div>
      ${templatesList()}
      <button class="btn sm primary mt" data-act="newTemplate">Nouveau modèle</button></div>
    ${delaysPanel()}
    <div class="panel pad"><h3 class="panel-title">Contrats</h3>
      <p class="help mb">Modèles Google Docs avec les balises &lt;&lt;…&gt;&gt; de la fiche de renseignements. Dépose le .docx dans le Drive, ouvre-le puis « Fichier › Enregistrer au format Google Docs », et colle ici le lien du Google Doc.</p>
      <div class="steps">
        <label for="set-tcc">Modèle contrat de cession</label><input id="set-tcc" data-setting-text="contract_template_cc" value="${esc(setting('contract_template_cc')||'')}" placeholder="https://docs.google.com/document/d/…">
        <label for="set-tcr">Modèle contrat de co-réalisation</label><input id="set-tcr" data-setting-text="contract_template_cr" value="${esc(setting('contract_template_cr')||'')}" placeholder="https://docs.google.com/document/d/…">
      </div></div>
    <div class="panel pad"><h3 class="panel-title">Google : Drive et Gmail</h3>
      <p class="help mb">Le script Google installé sur le compte production@ crée les dossiers Drive des dates et les brouillons Gmail.</p>
      <div class="steps">
        <label for="set-gas">Adresse du script (Apps Script)</label><input id="set-gas" data-setting-text="drive_webhook_url" value="${esc(setting('drive_webhook_url')||'')}" placeholder="https://script.google.com/macros/s/…/exec">
        <label>Code secret du script</label><span class="help">Gardé sur le serveur, jamais affiché ici (propriété WEBHOOK_SECRET du script ; valeur dans Supabase › table settings › drive_webhook_secret).</span>
        <label for="set-mac">Dossier Google Drive sur le Mac</label><input id="set-mac" data-setting-text="drive_mac_root" value="${esc(setting('drive_mac_root')||'')}" placeholder="/Users/…/Library/CloudStorage/GoogleDrive-…/Mon Drive">
        <label for="set-emp">Dossier Drive des salariés</label><input id="set-emp" data-setting-text="employees_folder_id" value="${esc(setting('employees_folder_id')||'')}" placeholder="ID ou lien du dossier">
        <label for="set-fin">Dossier « 01_Finance » (bulletins de paie, notes de frais)</label><input id="set-fin" data-setting-text="finance_folder_id" value="${esc(setting('finance_folder_id')||'')}" placeholder="Lien du dossier">
        <label for="set-ndft">Dossier type d’une note de frais (« NOM Prénom »)</label><input id="set-ndft" data-setting-text="ndf_template_folder_id" value="${esc(setting('ndf_template_folder_id')||'')}" placeholder="Lien du dossier">
        <label for="set-temp">Dossier « - Temp » (tableaux de renommage…)</label><input id="set-temp" data-setting-text="temp_folder_id" value="${esc(setting('temp_folder_id')||'')}" placeholder="Lien du dossier">
        <label for="set-site">Adresse du site (liens des fiches)</label><input id="set-site" data-setting-text="site_url" value="${esc(setting('site_url')||'')}">
        <label>Code du script (Code.gs)</label><span class="vh-actions"><button class="btn sm" data-act="copyMainScript">Copier le code à jour</button><button class="btn sm ghost" data-act="testMainScript">Tester le script</button></span>
      </div>
      <p class="help mt-sm">Mettre à jour le script : sur production@, ouvre script.google.com › le projet du script › fichier Code.gs › sélectionne tout et colle le code copié › Enregistrer › Déployer › Gérer les déploiements › crayon › Version : Nouvelle version › Déployer. L’adresse ne change pas.</p>
      <div class="vh-actions mt"><button class="btn sm" data-act="testScript">Tester le script</button>
        <button class="btn sm" data-act="driveScan">Rattacher les dossiers Drive existants</button></div>
      <p class="help mt mb-sm">Noms des dossiers de dates (« MM-DD • Ville • Salle (79) ») et des contrats (« Artiste • AAAA-MM-JJ • Ville (79) • Salle • CC/CR ») : la vérification crée un Google Sheet avec les renommages proposés (ancien nom → nouveau nom), sans rien toucher. Tout arrive décoché : coche seulement les dossiers que tu veux renommer, puis applique. Les contrats sont listés pour information et ne sont jamais renommés.</p>
      <div class="vh-actions"><button class="btn sm" data-act="renameAudit">Vérifier les noms</button>
        ${setting('rename_sheet_url') ? `<a class="btn sm" href="${esc(setting('rename_sheet_url'))}" target="_blank" rel="noopener">Ouvrir le dernier tableau</a>` : ''}
        <button class="btn sm" data-act="renameApply">Appliquer les renommages cochés</button></div></div>
    <div class="panel pad"><h3 class="panel-title">Prospection</h3>
      <p class="help mb">Les mails de prospection et les relances partent du Gmail de <b>${esc(setting('prospect_from') || 'anthony@lartboristerie.com')}</b> grâce à un petit script installé sur ce compte (une seule fois) :</p>
      <ol class="help" style="margin:0 0 12px;padding-left:18px">
        <li><button class="btn sm" data-act="copyProspectScript">Copier le code du script</button></li>
        <li>Va sur <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a> connecté avec ce compte : un nouveau projet s’ouvre. Efface tout, colle le code, enregistre (⌘S) et nomme-le « Matrice Prospection ».</li>
        <li>À gauche, « Services » › + › <b>Gmail API</b> › Ajouter (pour les relances dans le même fil).</li>
        <li>Déployer › Nouveau déploiement › roue dentée › <b>Application Web</b> · Exécuter en tant que : <b>moi</b> · Accès : <b>Tout le monde</b> › Déployer, puis autorise l’accès.</li>
        <li>Copie l’adresse « Application Web » (…/exec) et colle-la ici :</li>
      </ol>
      <div class="steps">
        <label for="set-pscript">Adresse du script de prospection</label><input id="set-pscript" data-setting-text="prospect_script_url" value="${esc(setting('prospect_script_url')||'')}" placeholder="https://script.google.com/macros/s/…/exec">
      </div>
      <p class="help">Modifiable seulement par le titulaire de la boîte anthony@ (compte d’Anthony), contrôlé par la base : le serveur y envoie des demandes signées en son nom.</p>
      <div class="vh-actions mt"><button class="btn sm" data-act="testProspectScript">Tester</button></div>
      <p class="help mt">Chloé peut aussi prospecter depuis <b>production@</b> : choisis « Envoyé par : Production » dans la fenêtre de prospection. Ces mails passent par le script Google principal (Réglages › Google) : il faut y avoir ajouté le service <b>Gmail API</b> (Services › + › Gmail API) pour les relances.</p>
      <h4 class="block-title mt mb-sm">Signature d’Anthony (mails envoyés par anthony@)</h4>
      ${rtToolbar('set-sig')}<div class="mail-preview" id="set-sig" contenteditable="true" style="${rtStyle()}">${setting('prospect_signature') || ''}</div>
      <div class="vh-actions mt-sm"><button class="btn sm" data-act="saveSignature">Enregistrer la signature</button></div>
      <h4 class="block-title mt mb-sm">Signature de Chloé (tous les mails envoyés par production@ : prospection, confirmations, boucles)</h4>
      ${rtToolbar('set-sig-prod')}<div class="mail-preview" id="set-sig-prod" contenteditable="true" style="${rtStyle()}">${setting('prospect_signature_production') || ''}</div>
      <div class="vh-actions mt-sm"><button class="btn sm" data-act="saveSignature" data-key="prospect_signature_production" data-el="set-sig-prod">Enregistrer la signature</button></div></div>
    <div class="panel pad"><h3 class="panel-title">Brevo</h3>
      <p class="help mb">Chaque nouveau contact de la Matrice qui a un mail est ajouté automatiquement dans Brevo (mail, prénom, nom, structure). Un mail déjà présent dans Brevo n’est jamais modifié : ni ses infos, ni ses listes, et un désabonné reste désabonné. Un contact lié uniquement à des structures inactives n’est pas ajouté (il l’est si l’une de ses structures est réactivée). Dans Brevo : ton nom en haut à droite › « SMTP et API » › onglet « Clés API » › « Générer une nouvelle clé API », puis colle-la ici. La liste est facultative : son numéro est dans Contacts › Listes (colonne ID).</p>
      <div class="steps">
        <label for="set-brevo">Clé API Brevo</label><span class="secret-line"><input id="set-brevo" type="password" autocomplete="off" data-1p-ignore data-brevo-key="1" placeholder="xkeysib-…"> <span class="muted" id="brevo-state">…</span></span>
        <label for="set-brevo-list">Liste Brevo (n°, ou plusieurs séparés par des virgules)</label><input id="set-brevo-list" data-setting-text="brevo_list_id" value="${esc(setting('brevo_list_id')||'')}" placeholder="ex. 3">
      </div>
      <div class="vh-actions mt"><button class="btn sm" data-act="brevoSyncAll">Envoyer tous les contacts existants à Brevo</button></div></div>
    <div class="panel pad"><h3 class="panel-title">IA (résumés de suivi)</h3>
      <p class="help mb">Le bouton « Mettre à jour avec l’IA » d’un suivi utilise Gemini, l’IA gratuite de Google. Va sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> avec le compte production@, clique sur « Create API key » (« Créer une clé API »), copie la clé (elle commence par « AIza » ou « AQ. ») et colle-la ici. Les demandes partent toujours des serveurs de Paris : Google applique alors ses règles européennes (pas d’entraînement de son IA sur vos données, pas de relecture humaine).</p>
      <div class="steps">
        <label for="set-ai">Clé Google AI Studio</label><span class="secret-line"><input id="set-ai" type="password" autocomplete="off" data-1p-ignore data-ai-key="1" placeholder="AIza… ou AQ.…" style="flex:1">
          <span class="muted" id="ai-state">…</span></span>
      </div></div>
    <div class="panel pad"><h3 class="panel-title">Pennylane</h3>
      <p class="help mb">La Matrice crée dans Pennylane les devis (cession, co-réalisation, co-production…) et les factures d’acompte, de solde et de commission <b>en brouillon</b> : rien n’est envoyé, tu vérifies et tu finalises dans Pennylane. Dans Pennylane : Paramètres › Connectivité › Développeurs › « Générer un jeton API », droits <b>lecture et écriture</b> sur Clients, Factures clients et Devis. Copie le jeton et colle-le ici : il est gardé sur le serveur, jamais affiché dans le site.</p>
      <div class="steps">
        <label for="set-pl">Jeton API Pennylane</label><span class="secret-line"><input id="set-pl" type="password" autocomplete="off" data-1p-ignore data-pl-key="1" placeholder="Coller le jeton" style="flex:1">
          <span class="muted" id="pl-state">…</span> <button class="btn sm" data-act="testPennylane">Tester</button></span>
      </div></div>
    <div class="panel pad"><h3 class="panel-title">Version</h3>
      <p>Matrice L'ArtBoristerie Productions <b>v${APP_VERSION}</b></p>
      <p class="help">Historique des mises à jour : <a href="CHANGELOG.md" target="_blank" rel="noopener">journal des versions</a>.</p></div>
  </div>`;
}

async function setSetting(key, value){
  const {error} = await sb.from('settings').upsert({key, value}, {onConflict: 'key'});
  if (error) { toast(error.message, true); return false; }
  const s = S.db.settings.find(x=>x.key===key); if (s) s.value = value; else S.db.settings.push({key, value}); touch('settings');
  return true;
}

/** État de la clé IA (jamais renvoyée au navigateur : seulement « configurée » ou non) */
export async function refreshAiState(){
  const el = document.getElementById('ai-state'); if (!el) return;
  const {data} = await sb.rpc('ai_key_status');
  el.textContent = data ? '✓ clé enregistrée' : 'pas encore de clé';
  const pl = document.getElementById('pl-state'); if (!pl) return;
  const {data: ok} = await sb.rpc('pennylane_status');
  pl.textContent = ok ? '✓ jeton enregistré' : 'pas encore de jeton';
  const br = document.getElementById('brevo-state'); if (!br) return;
  const {data: brevo} = await sb.rpc('brevo_key_status');   // la clé Brevo n'est jamais renvoyée au navigateur (v1.47)
  br.textContent = brevo ? '✓ clé enregistrée' : 'pas encore de clé';
}

document.addEventListener('change', async e => {
  if (e.target.dataset.aiKey){
    const v = e.target.value.trim();
    const m = v.match(/(AIza|AQ\.)[\w.-]{30,}/);
    if (v && !m) return toast('Ce n’est pas une clé Google AI Studio : elle commence par « AIza » ou « AQ. »', true);
    const {error} = await sb.rpc('set_ai_key', {k: m ? m[0] : ''});
    if (error) return toast(error.message, true);
    e.target.value = ''; toast(m ? 'Clé IA enregistrée' : 'Clé IA retirée'); refreshAiState(); return;
  }
  if (e.target.dataset.brevoKey){
    const v = e.target.value.trim(), m = v.match(/xkeysib-[\w-]+/);
    if (v && !m) return toast('Ce n’est pas une clé API Brevo : elle commence par « xkeysib- » (Brevo › SMTP et API › Clés API)', true);
    const {error} = await sb.rpc('set_brevo_key', {k: m ? m[0] : ''});
    if (error) return toast(error.message, true);
    e.target.value = ''; toast(m ? 'Clé Brevo enregistrée' : 'Clé Brevo retirée'); refreshAiState(); return;
  }
  if (e.target.dataset.plKey){
    const v = e.target.value.trim().replace(/^Bearer\s+/i, '');
    const {error} = await sb.rpc('set_pennylane_key', {k: v});
    if (error) return toast(error.message, true);
    e.target.value = ''; toast(v ? 'Jeton Pennylane enregistré' : 'Jeton Pennylane retiré'); refreshAiState(); return;
  }
  const kt = e.target.dataset.settingText;
  if (kt){
    let v = e.target.value.trim();
    if (/_id$/.test(kt) && kt !== 'brevo_list_id') v = (v.match(/[-\w]{25,}/) || [v])[0];   // un lien Drive collé → son identifiant
    if (kt === 'brevo_list_id') v = (v.match(/\d+/g) || []).join(', ');   // « #2 » → 2
    // adresses où le serveur envoie le code secret : seulement un script Google publié (même contrôle que la base et script-google, v1.47)
    if (['drive_webhook_url', 'prospect_script_url'].includes(kt) && v && !/^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(v)){
      toast('Colle l’adresse du déploiement du script Google : elle commence par https://script.google.com/ et finit par /exec', true); e.target.value = setting(kt) || ''; return; }
    // adresse du script de la boîte anthony@ : la base n'en accepte la modification que de son titulaire (messagerie v1.63) ;
    // vérifié ici d'abord pour dire pourquoi, sans toucher au réglage
    if (kt === 'prospect_script_url'){ const {data: owner} = await sb.rpc('is_mailbox_owner', {p_mailbox: 'anthony'});
      if (owner !== true){ toast('Adresse du script de la boîte anthony@ : modifiable seulement par le titulaire de la boîte (compte d’Anthony). Rien n’a été changé.', true); e.target.value = setting(kt) || ''; return; } }
    if (await setSetting(kt, v)){ e.target.value = v; toast('Réglage enregistré'); if (/^mail_font/.test(kt)) render(); }
    return; }
  const k = e.target.dataset.actSetting; if (!k) return;
  const v = e.target.value===''?null:Number(e.target.value);
  if (k==='default_acompte_pct'){
    if (v==null || v<0 || v>100) return toast("L'acompte doit être entre 0 et 100 %", true);
    if (await setSetting(k, v) && await setSetting('default_solde_pct', 100 - v)) toast(`Acompte ${pct(v)} · solde ${pct(100 - v)}`);
    render();
    return applyAcompte();   // les dates à venir pas encore facturées suivent (après confirmation)
  }
  if (await setSetting(k, v)) toast('Réglage enregistré');
});

/** Pôles : liste [{name, color}] enregistrée dans le réglage « departments » */
export async function saveDepartments(list){ return setSetting('departments', list); }

document.addEventListener('change', async e => {
  const i = e.target.dataset.dept; if (i === undefined) return;
  const list = departments().map(d => ({...d})), k = e.target.dataset.k, v = e.target.value.trim();
  const old = list[i].name;
  if (k === 'name' && !v) return toast('Le pôle doit avoir un nom', true);
  list[i][k] = v;
  if (!await saveDepartments(list)) return;
  if (k === 'name' && old !== v){
    await sb.from('tasks').update({department: v}).eq('department', old);
    S.db.tasks.forEach(t => { if (t.department === old) t.department = v; }); touch('tasks');
  }
  toast('Pôles enregistrés'); render();
});

export async function applyAcompte(){
  const ac = settingAcompte();   // 0 % gardé tel quel ; 50 seulement si le réglage est vide (§6.4)
  // 0 % = date SANS acompte (§6.4) : jamais d'acompte à 0 % posé en lot, et aucune ligne supprimée en lot sans décision (relecture v1.46a)
  if (ac === 0) return toast('Acompte par défaut à 0 % : les prochaines dates confirmées n’auront pas d’acompte. Les dates déjà confirmées gardent le leur ; pour en retirer un, « Valider les conditions » de la date › 0 acompte.');
  if (!(await confirmAsk('Appliquer aux dates à venir ?', `Mettre ${pct(ac)} d’acompte et ${pct(100-ac)} de solde sur les dates à venir dont les conditions ne sont pas validées et dont rien n’est facturé ni saisi à la main. Les artistes qui ont leur propre acompte par défaut gardent le leur.`, `Appliquer ${pct(ac)} / ${pct(100-ac)}`))) return;
  // seulement l'acompte et le solde créés à la confirmation (pas les acomptes ajoutés à la main)
  // dates à venir dont les conditions ne sont pas validées, avec un seul acompte et rien d'envoyé / payé / saisi à la main
  const now = today();
  // artiste avec son propre acompte par défaut (v1.59) : ses dates ne suivent pas le réglage général
  const ownAc = new Set(S.db.projects.filter(p => p.default_acompte_pct != null && p.default_acompte_pct !== '').map(p => p.id));
  const ids = S.db.shows.filter(s => !s.archived_at && !s.terms_validated_at && s.prod_mode !== 'booking' && !isCoproduction(s) && !ownAc.has(s.project_id) && (!s.date || s.date >= now)).map(s => s.id).filter(id => {   // coproduction : pas d'acompte / solde par défaut (v1.44)
    const p = paymentsOf(id).filter(x => ['acompte','solde'].includes(x.kind));
    return p.filter(x => x.kind === 'acompte').length === 1 && p.every(x => !isInvoiced(x) && (x.amount == null || x.amount === ''));   // aucune facture émise (§6.4)
  });
  for (const [kind, pct] of [['acompte', ac], ['solde', 100-ac]]){
    for (let i = 0; i < ids.length; i += 100){
      const {error} = await sb.from('show_payments').update({pct}).eq('kind', kind).is('sent_at', null).is('paid_at', null).is('invoice_number', null).is('pennylane_id', null).is('amount', null).is('hors_calcul', null).in('show_id', ids.slice(i, i + 100));
      if (error) return toast(error.message, true);
    }
  }
  S.db.show_payments = await fetchAll('show_payments'); touch('show_payments');
  toast('Acomptes et soldes mis à jour'); render();
}

/* ------------------------------------------------------------------ Délais et automatismes (v1.64) */
/** Ordre d'affichage : préparer / émettre la facture, l'envoyer, relance après impayé distingués (demande d'Anthony du 09/11) */
const MOMENTS = ['Suivi administratif', 'Préparer / émettre la facture', 'Envoyer la facture', 'Relance après impayé', 'Suivi financier', 'Boucles'];
const ruleRows = () => [...DELAY_RULES].sort((a, b) => MOMENTS.indexOf(a.moment) - MOMENTS.indexOf(b.moment));
const unitTxt = (n, unit) => unit === 'mois' ? `${n} mois` : unit === 'j' ? `${n} jour${n > 1 ? 's' : ''}` : `${n} ${unit}`;
const refTxt = r => r.dir ? `${r.dir === 'avant' ? 'avant' : 'après'} ${r.ref}` : r.ref;
const WK = {apres: 'samedi / dimanche → lundi suivant (si activé ci-dessous)', avant: 'samedi / dimanche → vendredi précédent (si activé ci-dessous)', solde: 'samedi / dimanche → vendredi précédent (règle fixe du solde)'};
const ALL_DELAYS = [...DELAY_RULES, ...WEEKEND_RULES];
const valTxt = (k, v) => { const r = ALL_DELAYS.find(x => x.key === k); return r.unit === 'aucun' ? (v.on ? 'activé' : 'désactivé') : v.on ? unitTxt(v.n, r.unit) : 'désactivé'; };
const simpleTxt = (r, v) => r.type === 'bool' ? (v ? 'activées' : 'désactivées') : `${v}${r.unit === 'j' ? ' j' : ' ' + r.unit}`;
/** Délais en vigueur pour une date créée maintenant (= valeur affichée et modifiée) */
const currentDelays = (value = setting('delais')) => delaysOf({created_at: new Date().toISOString()}, value);
/** Versions « nouvelles dates seulement » encore en vigueur : rappel des délais gardés par les dates plus anciennes */
function olderNote(key){
  const list = (Array.isArray(setting('delais')?.[key]) ? setting('delais')[key] : []).filter(v => v && typeof v === 'object');
  const last = list.map(v => v.from == null ? null : v.from).lastIndexOf(null);
  const froms = list.slice(last + 1).map(v => v.from).filter(okFrom);
  return froms.length ? `<span class="sub">Dates créées avant le ${esc(fmtDateTime(froms[0]))} : règle précédente gardée.</span>` : '';
}
const fmtDateTime = iso => new Date(iso).toLocaleString('fr-FR', {timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
const simpleRow = r => `<tr><td><b>${esc(r.label)}</b>${taskDelayAnomaly(r.key) ? `<span class="sub warn-txt">Valeur enregistrée illisible : ignorée, valeur par défaut appliquée (${esc(simpleTxt(r, r.n))}).</span>` : ''}</td><td>${esc(r.moment)}</td><td>${esc(r.action)}</td>
  <td class="num">${r.type === 'bool' ? `<input type="checkbox" data-task-delay="${r.key}" ${taskDelay(r.key) ? 'checked' : ''} aria-label="${esc(r.label)} : activées">`
    : `<input type="number" class="narrow" min="${r.min}" max="${r.max}" step="1" data-task-delay="${r.key}" value="${taskDelay(r.key)}" aria-label="${esc(r.label)}"> ${esc(r.unit === 'j' ? 'j' : r.unit)}`}</td>
  <td>${esc(refTxt(r) || '—')}</td><td>${esc(r.shift || '—')}</td><td>${esc(r.scope)}</td></tr>`;
const SIMPLE_HEAD = '<thead><tr><th>Règle</th><th>Moment</th><th>Action réelle</th><th>Valeur</th><th>Référence</th><th>Week-end</th><th>Périmètre</th></tr></thead>';

function delaysPanel(){
  const cur = currentDelays(), anomalies = delaysAnomalies();
  return `<div class="panel pad panel-full" id="delays-panel"><h3 class="panel-title">Délais et automatismes</h3>
    <p class="help mb"><b>Aucun envoi automatique</b> : ces règles créent des <b>notifications internes</b> (liste, récapitulatif quotidien, étape en rouge), des <b>tâches</b> ou <b>préparent</b> un document (brouillon Pennylane, échéance proposée). La date d’envoi d’une facture se saisit toujours à la main. Les conditions propres à une date priment : relances suspendues d’une date restaurée, prochaine échéance choisie à sa réactivation, case « Relances suspendues » d’une facture.</p>
    ${anomalies.length ? `<div class="mb">${anomalies.map(a => `<p class="warn-txt small m0">⚠︎ ${esc(a.text)}</p>`).join('')}</div>` : ''}
    <h4 class="block-title">Rappels (notifications créées chaque matin à 5 h UTC : 6 h à Paris l’hiver, 7 h l’été)</h4>
    <div class="tbl-wrap mb"><table><thead><tr><th>Rappel</th><th>Moment</th><th>Action réelle</th><th>Activé</th><th>Délai</th><th>Référence</th><th>Week-end</th><th>Périmètre</th></tr></thead><tbody>
    ${ruleRows().map(r => `<tr><td><b>${esc(r.label)}</b>${r.note ? `<span class="sub">${esc(r.note)}</span>` : ''}${r.old ? `<span class="sub">Concert passé depuis plus de ${r.old} jours : plus de notification ; reste dans Production › « Anciens éléments à traiter ».</span>` : ''}${olderNote(r.key)}</td>
      <td>${esc(r.moment)}</td><td>Notification (rappel interne)</td>
      <td><input type="checkbox" data-delay-on="${r.key}" ${cur[r.key].on ? 'checked' : ''} aria-label="${esc(r.label)} : activé"></td>
      <td class="num"><input type="number" class="narrow" min="0" max="${DELAY_MAX[r.unit]}" step="1" data-delay-n="${r.key}" value="${cur[r.key].n}" aria-label="${esc(r.label)} : délai en ${r.unit === 'mois' ? 'mois' : 'jours'}"> ${r.unit === 'mois' ? 'mois' : 'j'}</td>
      <td>${esc(refTxt(r))}</td><td>${esc(WK[r.wk])}</td><td>${esc(r.scope)}</td></tr>`).join('')}
    </tbody></table></div>
    <h4 class="block-title">Week-ends (rappels ci-dessus)</h4>
    <div class="tbl-wrap mb"><table><thead><tr><th>Échéance</th><th>Si activé</th><th>Activé</th></tr></thead><tbody>
    ${WEEKEND_RULES.map(r => `<tr><td><b>${esc(r.label)}</b>${olderNote(r.key)}</td><td>${esc(r.effect)}</td>
      <td><input type="checkbox" data-delay-on="${r.key}" ${cur[r.key].on ? 'checked' : ''} aria-label="${esc(r.label)} : ${esc(r.effect)}"></td></tr>`).join('')}
    <tr><td><b>Facture de solde à faire</b><span class="sub">Règle v1.60.6 : J-7 calendaire ; samedi / dimanche → vendredi précédent. Le rappel « Facture à envoyer » d’un solde ne tombe jamais avant ce jour.</span></td><td>vendredi précédent</td><td>toujours</td></tr>
    </tbody></table></div>
    <h4 class="block-title">Prospection et tâches (prochaines tâches seulement ; les tâches existantes gardent leur échéance)</h4>
    <div class="tbl-wrap mb"><table>${SIMPLE_HEAD}<tbody>${TASK_DELAYS.filter(r => !r.group).map(simpleRow).join('')}</tbody></table></div>
    <h4 class="block-title">Pennylane (nouveaux documents seulement ; documents déjà créés inchangés)</h4>
    <div class="tbl-wrap mb"><table>${SIMPLE_HEAD}<tbody>${TASK_DELAYS.filter(r => r.group === 'pennylane').map(simpleRow).join('')}</tbody></table></div>
    <h4 class="block-title">Délais en place, non réglables ici</h4>
    <ul class="help mb">
      <li>Rappels administratifs (facture d’acompte à faire, facture de commission booking, facture partenaire) : plus de notification quotidienne pour une date passée depuis plus de 120 jours ; « Facture de solde à faire » : depuis plus de 30 jours. L’obligation reste ouverte et visible dans Production › « Anciens éléments à traiter ». Factures à envoyer, impayés et commission : sans limite.</li>
      <li>Balise de mail {{date_reponse}} (invitation à un concert) : 2 jours avant le concert.</li>
      <li>Tâches « Urgentes » : échéance dans 7 jours ou moins (affichage seulement).</li>
      <li>Affiches, confirmations, boucles : aucun envoi ni relance automatique en dehors des rappels ci-dessus ; la date de demande d’affiches se saisit à la main.</li>
    </ul>
    <div class="vh-actions"><button class="btn sm primary" data-act="saveDelays">Enregistrer les délais…</button></div></div>`;
}

/** Lecture des champs ; valeurs hors bornes signalées (champ en erreur), rien n'est enregistré dans ce cas */
function readDelays(){
  const rules = {}, tasks = {}, bad = [];
  for (const r of ALL_DELAYS){
    const on = document.querySelector(`[data-delay-on="${r.key}"]`); if (!on) return null;
    if (r.unit === 'aucun'){ rules[r.key] = {on: on.checked, n: 0}; continue; }
    const n = document.querySelector(`[data-delay-n="${r.key}"]`); if (!n) return null;
    const v = Number(String(n.value).replace(',', '.'));
    if (String(n.value).trim() === '' || !Number.isInteger(v) || v < 0 || v > DELAY_MAX[r.unit]){ n.classList.add('bad'); bad.push(`${r.label} (0 à ${DELAY_MAX[r.unit]} ${r.unit === 'mois' ? 'mois' : 'jours'}, nombre entier)`); continue; }
    n.classList.remove('bad'); rules[r.key] = {on: on.checked, n: v};
  }
  for (const r of TASK_DELAYS){
    const el = document.querySelector(`[data-task-delay="${r.key}"]`); if (!el) return null;
    if (r.type === 'bool'){ tasks[r.key] = el.checked; continue; }
    const v = Number(String(el.value).replace(',', '.'));
    if (String(el.value).trim() === '' || !Number.isInteger(v) || v < r.min || v > r.max){ el.classList.add('bad'); bad.push(`${r.label} (${r.min} à ${r.max}, nombre entier)`); continue; }
    el.classList.remove('bad'); tasks[r.key] = v;
  }
  return {rules, tasks, bad};
}

/** Réglage « delais » après la modification : une version de plus par règle modifiée (historique gardé) ;
 *  from = instant d'enregistrement (nouvelles dates seulement) ou null (toutes les dates) */
export function delaysValue(changes, from, base = setting('delais'), by = S.user?.email || ''){
  const out = base && typeof base === 'object' && !Array.isArray(base) ? JSON.parse(JSON.stringify(base)) : {};
  const at = new Date().toISOString();
  for (const [k, v] of Object.entries(changes)){
    if (!Array.isArray(out[k])) out[k] = [];
    out[k] = out[k].filter(x => okVersion(x, ALL_DELAYS.find(r => r.key === k).unit));   // versions illisibles retirées (refusées par la base)
    out[k].push({on: v.on, n: v.n, from, at, by});
  }
  // règles inconnues ou illisibles (écrites hors de l'application) : retirées, sinon la base refuse l'enregistrement
  for (const k of Object.keys(out)) if (!ALL_DELAYS.some(r => r.key === k) || !Array.isArray(out[k])) delete out[k];
  for (const k of Object.keys(out)) out[k] = out[k].filter(x => okVersion(x, ALL_DELAYS.find(r => r.key === k).unit));
  return out;
}

/** Conséquences sur les dates existantes (rappels avancés, reculés, ajoutés, retirés, et ceux qui deviennent dus tout de suite) */
export function delaysImpact(before, after){
  const now = today(), res = {avances: [], recules: [], ajoutes: [], retires: [], immediats: []};
  for (const s of S.db.shows.filter(x => !x.archived_at && CONFIRMED_PROD.includes(x.status))){
    const id = r => `${r.key}|${r.title.replace(/\(J-\d+ mois\)/, '')}|${r.step}`;
    const live = r => !r.stale;   // anciens éléments : aucune notification, hors aperçu
    const A = new Map(remindersOf(s, {delais: before}).filter(live).map(r => [id(r), r])), B = new Map(remindersOf(s, {delais: after}).filter(live).map(r => [id(r), r]));
    const where = [s.date ? fmtDate(s.date) : 'sans date', s.venue].filter(Boolean).join(' · ');
    for (const [k, b] of B){
      const a = A.get(k), line = {show: s.id, where, title: b.title, from: a?.due || null, to: b.due};
      if (!a){ res.ajoutes.push(line); if (b.due <= now) res.immediats.push(line); }
      else if (b.due < a.due){ res.avances.push(line); if (b.due <= now && a.due > now) res.immediats.push(line); }
      else if (b.due > a.due) res.recules.push(line);
    }
    for (const [k, a] of A) if (!B.has(k)) res.retires.push({show: s.id, where, title: a.title, from: a.due, to: null});
  }
  return res;
}
const impactCount = i => i.avances.length + i.recules.length + i.ajoutes.length + i.retires.length;
function impactText(i, max = 8){
  if (!impactCount(i)) return 'Aucun rappel des dates en cours ne change.';
  const lines = [], shows = new Set([...i.avances, ...i.recules, ...i.ajoutes, ...i.retires].map(l => l.show));
  lines.push(`Dossiers concernés : ${shows.size}`);
  const part = (label, list, fmt) => { if (!list.length) return; lines.push(`${label} : ${list.length}`);
    list.slice(0, max).forEach(l => lines.push(`• ${l.where} — ${l.title} : ${fmt(l)}`)); if (list.length > max) lines.push(`• … et ${list.length - max} autre(s)`); };
  const d = x => x ? fmtDate(x) : '—';
  part('Rappels avancés', i.avances, l => `${d(l.from)} → ${d(l.to)}`);
  part('Rappels reculés', i.recules, l => `${d(l.from)} → ${d(l.to)}`);
  part('Rappels ajoutés (règle réactivée)', i.ajoutes, l => `échéance ${d(l.to)}`);
  part('Rappels retirés (règle désactivée)', i.retires, l => `échéance ${d(l.from)}`);
  if (i.immediats.length) part('Dus aujourd’hui ou avant : ils partiraient au prochain passage du matin (sauf s’ils ont déjà été notifiés pour cette étape)', i.immediats, l => `échéance ${d(l.to)}`);
  return lines.join('\n');
}

/** Enregistrer les délais : conséquences affichées, choix explicite ; par défaut, nouvelles dates seulement (aucun recalcul) */
export async function saveDelays(){
  const r = readDelays(); if (!r) return;
  if (r.bad.length) return toast('Rien n’est enregistré. Valeur à corriger : ' + r.bad.join(' ; '), true);
  const cur = currentDelays();
  const changes = Object.fromEntries(Object.entries(r.rules).filter(([k, v]) => v.on !== cur[k].on || v.n !== cur[k].n));
  const tasks = Object.fromEntries(Object.entries(r.tasks).filter(([k, v]) => v !== taskDelay(k) || taskDelayAnomaly(k)));
  if (!Object.keys(changes).length && !Object.keys(tasks).length) return toast('Aucun délai modifié');
  const what = [
    ...Object.entries(changes).map(([k, v]) => `• ${ALL_DELAYS.find(x => x.key === k).label} : ${valTxt(k, cur[k])} → ${valTxt(k, v)}`),
    ...Object.entries(tasks).map(([k, v]) => { const t = TASK_DELAYS.find(x => x.key === k);
      return `• ${t.label} : ${simpleTxt(t, taskDelay(k))} → ${simpleTxt(t, v)} (${t.group === 'pennylane' ? 'nouveaux documents seulement ; documents déjà créés inchangés' : 'prochaines tâches ; les tâches existantes gardent leur échéance'})`; }),
  ].join('\n');
  let choice = 'tasks';
  if (Object.keys(changes).length){
    const now = setting('delais'), at = new Date().toISOString();
    const onlyNew = delaysImpact(now, delaysValue(changes, at)), all = delaysImpact(now, delaysValue(changes, null));
    choice = await ask({title: 'Enregistrer les délais ?', text: `${what}\n`
      + `Nouvelles dates seulement (conseillé) : le changement vaut pour les dates créées à partir de l’enregistrement ; les dates existantes gardent leur règle, aucun rappel n’est recalculé ni lancé.${impactCount(onlyNew) ? '\n' + impactText(onlyNew) : ''}\n`
      + `Aussi les dates en cours :\n${impactText(all)}`,
      actions: [{value: 'new', label: 'Nouvelles dates seulement'}, {value: 'all', label: 'Aussi les dates en cours', plain: true}]});
    if (!choice) return;
  } else if (!(await confirmAsk('Enregistrer les délais ?', what, 'Enregistrer'))) return;
  // instant d'enregistrement (décision d'Anthony du 09/11) : pris au moment de l'écriture, après le choix
  if (Object.keys(changes).length && !await setSetting('delais', delaysValue(changes, choice === 'all' ? null : new Date().toISOString()))){
    toast('Rien n’a été changé : les délais précédents restent appliqués.', true); return; }
  for (const [k, v] of Object.entries(tasks)) if (!await setSetting(k, v)){ toast(`Réglage « ${TASK_DELAYS.find(x => x.key === k).label} » non enregistré : la valeur précédente reste appliquée.`, true); return; }
  toast(choice === 'all' ? 'Délais enregistrés : dates en cours comprises' : choice === 'new' ? 'Délais enregistrés pour les nouvelles dates' : 'Délais enregistrés');
  render();
}
