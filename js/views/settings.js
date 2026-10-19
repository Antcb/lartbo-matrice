/**
 * Réglages : pourcentages par défaut (acompte + solde = 100 %), partenaires, version.
 */
import { APP_VERSION } from '../config.js';
import { sb } from '../data.js';
import { departments, setting } from '../selectors.js';
import { fetchAll } from '../data.js';
import { S, touch } from '../state.js';
import { viewHead } from '../ui/bits.js';
import { cIn } from '../ui/cells.js';
import { esc, toast } from '../utils.js';
import { render } from '../app.js';
import { templatesList } from '../mail.js';
import { templateForm } from '../budget-template.js';
import { FONTS, SIZES, mailFont, rtStyle, rtToolbar } from '../ui/richtext.js';

export function viewSettings(){
  const ac = Number(setting('default_acompte_pct') ?? 0);
  return viewHead('Réglages') + `
  <div class="grid-cards" style="grid-template-columns:repeat(auto-fill,minmax(360px,1fr))">
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Pourcentages par défaut</h3>
      <p class="help" style="margin:0 0 12px">Appliqués aux nouvelles dates confirmées. Chaque date et chaque projet peuvent les remplacer.</p>
      <div class="steps">
        <label for="set-ac">Acompte (% du cachet)</label><input id="set-ac" type="number" step="any" data-act-setting="default_acompte_pct" value="${esc(ac)}">
        <label>Solde</label><span><b>${esc(100 - ac)} %</b> <span class="muted">(100 % − acompte)</span></span>
        <label for="set-artbo-b">Commission L'ArtBo par défaut — booking (%)</label><input id="set-artbo-b" type="number" step="any" data-act-setting="default_artbo_pct_booking" value="${esc(setting('default_artbo_pct_booking')??15)}">
        <label for="set-artbo-p">Commission L'ArtBo par défaut — production (%)</label><input id="set-artbo-p" type="number" step="any" data-act-setting="default_artbo_pct_production" value="${esc(setting('default_artbo_pct_production')??20)}">
        <label for="set-cnm">Taxe CNM (%)</label><input id="set-cnm" type="number" step="any" data-act-setting="default_cnm_pct" value="${esc(setting('default_cnm_pct')??'')}">
        <label for="set-mvm">Coût Movinmotion par bulletin (€)</label><input id="set-mvm" type="number" step="any" data-act-setting="movinmotion_payslip_cost" value="${esc(setting('movinmotion_payslip_cost')??'')}">
      </div>
      <p class="help" style="margin:14px 0 8px">Les nouvelles dates confirmées prennent ces pourcentages. Les dates déjà confirmées gardent les leurs, sauf si tu les mets à jour :</p>
      <button class="btn sm" data-act="applyAcompte">Appliquer ${esc(ac)} % / ${esc(100-ac)} % aux acomptes et soldes pas encore envoyés</button></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Budget type</h3>
      <p class="help" style="margin:0 0 12px">Le budget prévisionnel posé sur chaque nouvelle date confirmée en production.</p>
      ${templateForm('settings')}</div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Pôles des tâches</h3>
      <p class="help" style="margin:0 0 12px">Renommer un pôle met à jour les tâches qui l’utilisent.</p>
      ${departments().map((d,i)=>`<div class="link-row" style="grid-template-columns:44px 1fr auto"><input type="color" value="${esc(d.color)}" data-dept="${i}" data-k="color" aria-label="Couleur du pôle ${esc(d.name)}" style="padding:2px;height:32px">
        <input value="${esc(d.name)}" data-dept="${i}" data-k="name" aria-label="Nom du pôle">
        <button class="btn icon sm ghost danger" data-act="rmDept" data-i="${i}" aria-label="Supprimer le pôle ${esc(d.name)}">✕</button></div>`).join('')}
      <button class="btn sm" data-act="addDept" style="margin-top:10px">Ajouter un pôle</button></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Partenaires / co-producteurs</h3>
      <p class="help" style="margin:0 0 12px">% de la commission L'ArtBo reversé au partenaire, sur les projets où il est choisi.</p>
      <table><tbody>${S.db.partners.map(p=>`<tr><td>${cIn('partners',p.id,'name',p.name)}</td><td class="num">${cIn('partners',p.id,'default_pct',p.default_pct,'number','class="narrow"')} %</td></tr>`).join('')}</tbody></table>
      <button class="btn sm" data-act="newPartner" style="margin-top:10px">Ajouter un partenaire</button></div>
    <div class="panel pad" style="grid-column:1/-1"><h3 style="font-size:22px;margin-bottom:6px">Modèles de mail</h3>
      <p class="help" style="margin:0 0 12px">Rangés par type de mail : clique sur un groupe pour le déplier. Les modèles « génériques » servent pour les artistes qui n’ont pas le leur. Les balises comme {{date}} ou {{structure}} sont remplacées par les infos de la date ou de la structure ; une balise inconnue (ex. {{date_concert}}) reste surlignée en jaune pour être complétée à la main.</p>
      <div class="steps" style="margin-bottom:12px">
        <label for="set-mfont">Police par défaut des mails</label><select id="set-mfont" data-setting-text="mail_font">${FONTS.map(([v, l]) => `<option value="${esc(v)}" ${v === mailFont().family ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <label for="set-msize">Taille par défaut</label><select id="set-msize" data-setting-text="mail_font_size">${SIZES.map(n => `<option value="${n}" ${n === mailFont().size ? 'selected' : ''}>${n}</option>`).join('')}</select>
      </div>
      ${templatesList()}
      <button class="btn sm primary" data-act="newTemplate" style="margin-top:10px">Nouveau modèle</button></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Contrats</h3>
      <p class="help" style="margin:0 0 12px">Modèles Google Docs avec les balises &lt;&lt;…&gt;&gt; de la fiche de renseignements. Dépose le .docx dans le Drive, ouvre-le puis « Fichier › Enregistrer au format Google Docs », et colle ici le lien du Google Doc.</p>
      <div class="steps">
        <label for="set-tcc">Modèle contrat de cession</label><input id="set-tcc" data-setting-text="contract_template_cc" value="${esc(setting('contract_template_cc')||'')}" placeholder="https://docs.google.com/document/d/…">
        <label for="set-tcr">Modèle contrat de co-réalisation</label><input id="set-tcr" data-setting-text="contract_template_cr" value="${esc(setting('contract_template_cr')||'')}" placeholder="https://docs.google.com/document/d/…">
      </div></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Google : Drive et Gmail</h3>
      <p class="help" style="margin:0 0 12px">Le script Google installé sur le compte production@ crée les dossiers Drive des dates et les brouillons Gmail.</p>
      <div class="steps">
        <label for="set-gas">Adresse du script (Apps Script)</label><input id="set-gas" data-setting-text="drive_webhook_url" value="${esc(setting('drive_webhook_url')||'')}" placeholder="https://script.google.com/macros/s/…/exec">
        <label>Code secret à coller dans le script</label><span class="secret-line"><code>${esc(String(setting('drive_webhook_secret')||'').slice(0,8))}…</code> <button class="btn sm ghost" data-act="copySecret">Copier</button></span>
        <label for="set-mac">Dossier Google Drive sur le Mac</label><input id="set-mac" data-setting-text="drive_mac_root" value="${esc(setting('drive_mac_root')||'')}" placeholder="/Users/…/Library/CloudStorage/GoogleDrive-…/Mon Drive">
        <label for="set-emp">Dossier Drive des salariés</label><input id="set-emp" data-setting-text="employees_folder_id" value="${esc(setting('employees_folder_id')||'')}" placeholder="ID ou lien du dossier">
        <label for="set-fin">Dossier « 01_Finance » (bulletins de paie, notes de frais)</label><input id="set-fin" data-setting-text="finance_folder_id" value="${esc(setting('finance_folder_id')||'')}" placeholder="Lien du dossier">
        <label for="set-ndft">Dossier type d’une note de frais (« NOM Prénom »)</label><input id="set-ndft" data-setting-text="ndf_template_folder_id" value="${esc(setting('ndf_template_folder_id')||'')}" placeholder="Lien du dossier">
        <label for="set-temp">Dossier « - Temp » (tableaux de renommage…)</label><input id="set-temp" data-setting-text="temp_folder_id" value="${esc(setting('temp_folder_id')||'')}" placeholder="Lien du dossier">
        <label for="set-site">Adresse du site (liens des fiches)</label><input id="set-site" data-setting-text="site_url" value="${esc(setting('site_url')||'')}">
        <label>Code du script (Code.gs)</label><span class="vh-actions"><button class="btn sm" data-act="copyMainScript">Copier le code à jour</button><button class="btn sm ghost" data-act="testMainScript">Tester le script</button></span>
      </div>
      <p class="help" style="margin:8px 0 0">Mettre à jour le script : sur production@, ouvre script.google.com › le projet du script › fichier Code.gs › sélectionne tout et colle le code copié › Enregistrer › Déployer › Gérer les déploiements › crayon › Version : Nouvelle version › Déployer. L’adresse ne change pas.</p>
      <div class="vh-actions" style="margin-top:12px"><button class="btn sm" data-act="testScript">Tester le script</button>
        <button class="btn sm" data-act="driveScan">Rattacher les dossiers Drive existants</button></div>
      <p class="help" style="margin:14px 0 6px">Noms des dossiers de dates (« MM-DD • Ville • Salle (79) ») et des contrats (« Artiste • AAAA-MM-JJ • Ville (79) • Salle • CC/CR ») : la vérification crée un Google Sheet avec les renommages proposés, sans rien toucher. Décoche ce qui ne convient pas, puis applique.</p>
      <div class="vh-actions"><button class="btn sm" data-act="renameAudit">Vérifier les noms</button>
        ${setting('rename_sheet_url') ? `<a class="btn sm" href="${esc(setting('rename_sheet_url'))}" target="_blank" rel="noopener">Ouvrir le dernier tableau</a>` : ''}
        <button class="btn sm" data-act="renameApply">Appliquer les renommages cochés</button></div></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Prospection</h3>
      <p class="help" style="margin:0 0 10px">Les mails de prospection et les relances partent du Gmail de <b>${esc(setting('prospect_from') || 'anthony@lartboristerie.com')}</b> grâce à un petit script installé sur ce compte (une seule fois) :</p>
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
      <div class="vh-actions" style="margin-top:10px"><button class="btn sm" data-act="testProspectScript">Tester</button></div>
      <p class="help" style="margin:10px 0 0">Chloé peut aussi prospecter depuis <b>production@</b> : choisis « Envoyé par : Production » dans la fenêtre de prospection. Ces mails passent par le script Google principal (Réglages › Google) : il faut y avoir ajouté le service <b>Gmail API</b> (Services › + › Gmail API) pour les relances.</p>
      <h4 class="block-title" style="margin:16px 0 6px">Signature d’Anthony (mails envoyés par anthony@)</h4>
      ${rtToolbar('set-sig')}<div class="mail-preview" id="set-sig" contenteditable="true" style="${rtStyle()}">${setting('prospect_signature') || ''}</div>
      <div class="vh-actions" style="margin-top:8px"><button class="btn sm" data-act="saveSignature">Enregistrer la signature</button></div>
      <h4 class="block-title" style="margin:16px 0 6px">Signature de Chloé (tous les mails envoyés par production@ : prospection, confirmations, boucles)</h4>
      ${rtToolbar('set-sig-prod')}<div class="mail-preview" id="set-sig-prod" contenteditable="true" style="${rtStyle()}">${setting('prospect_signature_production') || ''}</div>
      <div class="vh-actions" style="margin-top:8px"><button class="btn sm" data-act="saveSignature" data-key="prospect_signature_production" data-el="set-sig-prod">Enregistrer la signature</button></div></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Brevo</h3>
      <p class="help" style="margin:0 0 12px">Chaque nouveau contact de la Matrice qui a un mail est ajouté automatiquement dans Brevo (mail, prénom, nom, structure). Un mail déjà présent dans Brevo n’est jamais modifié : ni ses infos, ni ses listes, et un désabonné reste désabonné. Dans Brevo : ton nom en haut à droite › « SMTP et API » › onglet « Clés API » › « Générer une nouvelle clé API », puis colle-la ici. La liste est facultative : son numéro est dans Contacts › Listes (colonne ID).</p>
      <div class="steps">
        <label for="set-brevo">Clé API Brevo</label><input id="set-brevo" type="password" autocomplete="off" data-1p-ignore data-setting-text="brevo_api_key" value="${esc(setting('brevo_api_key')||'')}" placeholder="xkeysib-…">
        <label for="set-brevo-list">Liste Brevo (n°, ou plusieurs séparés par des virgules)</label><input id="set-brevo-list" data-setting-text="brevo_list_id" value="${esc(setting('brevo_list_id')||'')}" placeholder="ex. 3">
      </div>
      <div class="vh-actions" style="margin-top:12px"><button class="btn sm" data-act="brevoSyncAll" ${setting('brevo_api_key') ? '' : 'disabled title="Colle d’abord la clé API"'}>Envoyer tous les contacts existants à Brevo</button></div></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">IA (résumés de suivi)</h3>
      <p class="help" style="margin:0 0 12px">Le bouton « Mettre à jour avec l’IA » d’un suivi utilise Gemini, l’IA gratuite de Google. Va sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> avec le compte production@, clique sur « Create API key » (« Créer une clé API »), copie la clé (elle commence par « AIza » ou « AQ. ») et colle-la ici. Les demandes partent toujours des serveurs de Paris : Google applique alors ses règles européennes (pas d’entraînement de son IA sur vos données, pas de relecture humaine).</p>
      <div class="steps">
        <label for="set-ai">Clé Google AI Studio</label><span class="secret-line"><input id="set-ai" type="password" autocomplete="off" data-1p-ignore data-ai-key="1" placeholder="AIza… ou AQ.…" style="flex:1">
          <span class="muted" id="ai-state">…</span></span>
      </div></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Pennylane</h3>
      <p class="help" style="margin:0 0 12px">La Matrice crée dans Pennylane les devis (cession, co-réalisation, co-production…) et les factures d’acompte, de solde et de commission <b>en brouillon</b> : rien n’est envoyé, tu vérifies et tu finalises dans Pennylane. Dans Pennylane : Paramètres › Connectivité › Développeurs › « Générer un jeton API », droits <b>lecture et écriture</b> sur Clients, Factures clients et Devis. Copie le jeton et colle-le ici : il est gardé sur le serveur, jamais affiché dans le site.</p>
      <div class="steps">
        <label for="set-pl">Jeton API Pennylane</label><span class="secret-line"><input id="set-pl" type="password" autocomplete="off" data-1p-ignore data-pl-key="1" placeholder="Coller le jeton" style="flex:1">
          <span class="muted" id="pl-state">…</span> <button class="btn sm" data-act="testPennylane">Tester</button></span>
      </div></div>
    <div class="panel pad"><h3 style="font-size:22px;margin-bottom:6px">Version</h3>
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
    if (kt === 'brevo_api_key' && v){ const k = v.match(/xkeysib-[\w-]+/); if (!k){ toast('Ce n’est pas une clé API Brevo : elle commence par « xkeysib- » (Brevo › SMTP et API › Clés API)', true); e.target.value = setting('brevo_api_key') || ''; return; } v = k[0]; }
    if (await setSetting(kt, v)){ e.target.value = v; toast('Réglage enregistré'); if (/^mail_font/.test(kt)) render(); }
    return; }
  const k = e.target.dataset.actSetting; if (!k) return;
  const v = e.target.value===''?null:Number(e.target.value);
  if (k==='default_acompte_pct'){
    if (v==null || v<0 || v>100) return toast("L'acompte doit être entre 0 et 100 %", true);
    if (await setSetting(k, v) && await setSetting('default_solde_pct', 100 - v)) toast(`Acompte ${v} % · solde ${100 - v} %`);
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
  const ac = Number(setting('default_acompte_pct') ?? 0);
  if (!confirm(`Mettre ${ac} % d’acompte et ${100-ac} % de solde sur les dates à venir pas encore facturées ?`)) return;
  // seulement l'acompte et le solde créés à la confirmation (pas les acomptes ajoutés à la main)
  // dates à venir dont les conditions ne sont pas validées, avec un seul acompte et rien d'envoyé / payé / saisi à la main
  const now = new Date().toLocaleDateString('sv-SE');
  const ids = S.db.shows.filter(s => !s.terms_validated_at && s.prod_mode !== 'booking' && (!s.date || s.date >= now)).map(s => s.id).filter(id => {
    const p = S.db.show_payments.filter(x => x.show_id === id && ['acompte','solde'].includes(x.kind));
    return p.filter(x => x.kind === 'acompte').length === 1 && p.every(x => !x.sent_at && !x.paid_at && (x.amount == null || x.amount === ''));
  });
  for (const [kind, pct] of [['acompte', ac], ['solde', 100-ac]]){
    for (let i = 0; i < ids.length; i += 100){
      const {error} = await sb.from('show_payments').update({pct}).eq('kind', kind).in('show_id', ids.slice(i, i + 100));
      if (error) return toast(error.message, true);
    }
  }
  S.db.show_payments = await fetchAll('show_payments'); touch('show_payments');
  toast('Acomptes et soldes mis à jour'); render();
}
