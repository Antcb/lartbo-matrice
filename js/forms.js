/**
 * Formulaires de création / modification : date, projet, tâche, contact, structure, suivi, événement,
 * créations rapides (structure, contact) depuis un champ de recherche, export CSV des suivis, photo de projet.
 */
import { ask, askText } from './ui/dialog.js';
import { FORMAT_FIELD, exportTable } from './exports.js';
import { propagateCommission } from './commission.js';
import { hasFinancialRecord } from './calc.js';
import { render } from './app.js';
import { CFG } from './config.js';
import { CONTACT_ROLES, STRUCT_TAGS, CONFIRMED_PROD, CONTRACTS, EVENT_KINDS, PRICING, PRIORITIES, PRIORITY_OPTS, PROSPECT, PROSPECT_OPTS, STATUSES, TASK_STATUS, TASK_STATUS_OPTS, TEAM_NAMES, TICKETING, isOff } from './constants.js';
import { insert, purgeStored, refreshFor, remove, removeWhere, save, saveLinger, sb, signedUrl, syncLinks, uploadFiles } from './data.js';
import { fillCoords, geocode, geoFrance, searchPlaces } from './geo.js';
import { contactMails, contactsWithMail, defaultCommission, settingAcompte, suiviClosed, attachmentsOf, byId, deptNames, isDone, eventsOfStructure, setting, lastExchange, linksOfContact, linksOfStructure, placeOfSuivi, projIds, showPlaceNote, projName, projectOptions, prospectTitle, spectaclesOf, defaultSpectacleId } from './selectors.js';
import { S, touch } from './state.js';
import { CREATORS } from './ui/autocomplete.js';
import { fileRow } from './ui/bits.js';
import { hiddenFields, openModal } from './ui/modal.js';
import { $, downloadCSV, esc, fmtDate, norm, toast, today, workDay, addDays, pct } from './utils.js';
import { driveHTML } from './views/production.js';
import { cancelAutoRelances, closeNoAnswer, deleteProspect, prospectDeleteAsk } from './prospection.js';
import { afterFeeChange, askConfirmation, becameConfirmed } from './confirm-flow.js';
import { spectFields, spectValue } from './budget-template.js';
import { deptOf } from './contract.js';

const team = () => CFG.TEAM.map(e=>[e, TEAM_NAMES[e]||e]);
const activeProjects = keep => projectOptions(true, keep).map(x=>[x.id, x.name]);

/* ------------------------------------------------------------------ Dates */
export function showFields(s){
  return [
    {k:'structure_id', label:'Structure (salle, festival, organisateur)', type:'ac', kind:'structures', create:true, full:true},
    // lieu réel (v1.60.2) : choisi parmi les salles / festivals connus (adresse et code postal repris) ou tapé
    {k:'venue', label:'Nom du lieu / festival', type:'lieu', fill:'', full:true},
    {k:'project_id', label:'Artiste', type:'project'},
    {k:'spectacle_id', label:'Spectacle', type:'select', blank:false, options: spectacleOptions(s.project_id, s.spectacle_id)},
    {k:'status', label:'Statut', type:'select', options:STATUSES.includes(s.status)||!s.status ? STATUSES : [s.status, ...STATUSES], blank:false},
    {k:'date', label:'Date', type:'date'}, {k:'date_end', label:'Fin (si plusieurs jours)', type:'date'},
    {k:'address', label:'Adresse du lieu', type:'place', fill:'', full:true, placeholder:'Taper l’adresse du lieu (facultatif)'},
    {k:'postal_code', label:'Code postal'},
    {k:'city', label:'Ville', type:'city', fill:''}, {k:'department', label:'Département (ou pays)', placeholder:'ex. 69, CH, BE'},
    // décision d'Anthony du 07/11/2026 : l'adresse de la structure n'est le lieu de la date que sur ce choix explicite (sinon : à compléter)
    {k:'venue_is_structure', label:'Utiliser l’adresse de la structure comme lieu de représentation', type:'checkbox', full:true},
    {k:'_h_place', type:'html', full:true, html:`<p class="help m0" data-place-note>${esc(placeHelp(s))}</p>`},
    {k:'contract_type', label:'Type de contrat', type:'select', options:CONTRACTS},
    {k:'fee_ht', label:'Cachet HT (€)', type:'number'},
    {k:'ticketing_type', label:'Billetterie', type:'select', options:TICKETING},
    {k:'capacity', label:'Jauge', type:'number'},
    {k:'request_date', label:'Date de la demande', type:'date'},
    {k:'ticketing_enabled', label:'Concernée par le ticketing', type:'checkbox'},
    {k:'communication_enabled', label:'Concernée par la communication', type:'checkbox'},
    {k:'notes', label:'Notes', type:'textarea', full:true},
  ];
}

/** Spectacles proposés pour une date (v1.57) : ceux de l'artiste encore actifs, plus celui déjà choisi ; « non précisé » toujours possible
 *  pour une date existante (jamais d'attribution automatique) */
export function spectacleOptions(projectId, current){
  const list = spectaclesOf(projectId).filter(x => x.active || x.id === current);
  return [['', list.length ? '— choisir le spectacle —' : 'Non précisé (aucun spectacle pour cet artiste)'], ...list.map(x => [x.id, x.name + (x.active ? '' : ' (inactif)')])];
}

/** Nouveau spectacle d'un artiste : nom et budget type dès la création (v1.57) ; montants vides = non renseignés */
export function newSpectacle(projectId){
  const nums = spectFields().map(([k, label]) => ({k, label, type: 'text', placeholder: 'vide = non renseigné'}));
  return openModal({title: `Nouveau spectacle · ${projName(projectId)}`, values: {},
    fields: [{k: 'name', label: 'Nom du spectacle (ex. « Jeune public »)', full: true}, ...nums],
    onSave: async v => {
      if (!v.name){ toast('Indique le nom du spectacle', true); return false; }
      const t = {};
      for (const [k, label] of spectFields()){ const r = spectValue(v[k]); if (!r.ok){ toast(`${label} : nombre positif ou vide`, true); return false; } if (r.v != null) t[k] = r.v; }
      const sort = Math.max(0, ...spectaclesOf(projectId).map(x => x.sort || 0)) + 1;
      const row = await insert('spectacles', {project_id: projectId, name: v.name, active: true, budget_template: t, sort});
      if (row){ S.tab['fold:spectacle-' + row.id] = true; toast('Spectacle créé'); }
      return row;
    }});
}

/** Valeurs d'une nouvelle date posée depuis une structure : l'organisateur et son nom comme nom du lieu, rien d'autre (décisions du
 *  07/11/2026 : adresse, code postal, ville, département et coordonnées suivent la source du lieu — la structure seulement si elle
 *  est confirmée comme lieu, case de la date) */
export const showPrefillFromStructure = st => st ? {structure_id: st.id, venue: st.name} : {};
/** Texte d'aide sous la case « Utiliser l'adresse de la structure… » : où en est la localisation de la date */
function placeHelp(s){
  const note = s?.id ? showPlaceNote(s) : '';
  return (note ? note + '. ' : '') + 'Sans lieu choisi, adresse propre ou cette case (cochée aussi en choisissant la structure elle-même comme lieu), l’adresse, le code postal et la ville du lieu restent à compléter dans la fiche, le contrat et les mails.';
}
/** Nouvelle date posée depuis un suivi (v1.60.2) : le lieu choisi dans le suivi s'il y en a un, sinon celui de sa structure */
export const showPrefillFromSuivi = (p, st) => { const pl = placeOfSuivi(p);
  return pl ? {structure_id: st?.id || null, ...pl, venue: pl.venue || st?.name || null} : showPrefillFromStructure(st); };

/** Coordonnées d'une date à l'enregistrement (v1.60.2) : un lieu ou une adresse choisis dans la fenêtre gardent les leurs ;
 *  un emplacement changé à la main est relocalisé (adresse complète si elle est connue) ; les coordonnées de la structure ne sont
 *  copiées sur la date que si la case « Utiliser l'adresse de la structure… » est cochée (07/11/2026) — sinon rien n'est écrit et la
 *  carte garde le repère de la structure comme localisation héritée (showPlace). Coordonnées déjà enregistrées : jamais effacées
 *  sans changement du lieu. Le département suit le code postal (règle {{cp}}, deptOf). */
async function locateShow(v, s){
  const st = byId('structures', v.structure_id);
  const french = d => !d || /^(\d{2,3}|2[AB])$/i.test(String(d).trim());
  // département vide : tiré du code postal seulement pour un lieu en France (structure en France ou sans pays) — jamais d'Aube pour Berlin 10115
  const inFrance = v.department ? french(v.department) : !st || !st.country || /^\s*france\s*$/i.test(st.country);
  if (/^\d{5}$/.test(String(v.postal_code || '').replace(/\s/g, '')) && inFrance && (!v.department || v.postal_code !== s.postal_code))
    v.department = deptOf(v.postal_code, '');
  const moved = ['address', 'postal_code', 'city'].some(k => (v[k] || '') !== (s[k] || ''));
  if (v.lat != null && v.lat !== s.lat) return;   // coordonnées du lieu / de l'adresse choisis
  if (!moved){
    if (v.lat != null) return;
    // lieu inchangé (adresse, code postal, ville, organisateur, case « adresse de la structure ») : RIEN n'est écrit — une ancienne
    // date garde son repère hérité (« lieu à confirmer »), jamais déplacée ni géocodée d'office (décision du 07/11, relecture v1.60.2)
    if ((v.structure_id || null) === (s.structure_id || null) && !!v.venue_is_structure === !!s.venue_is_structure) return;
    // rien n'a bougé et la structure, dans la même ville, sert déjà de repère (showCoords) : rien n'est écrit sur la date
    if (st && st.lat != null && (!v.city || !st.city || norm(v.city) === norm(st.city))) return;
  }
  v.lat = v.lng = null;
  if (st && st.lat != null && !v.address && (!v.city || norm(v.city) === norm(st.city || ''))){
    // structure confirmée comme lieu : ses coordonnées ; sinon rien de l'organisateur (repère hérité « lieu à confirmer »)
    if (v.venue_is_structure){ v.lat = st.lat; v.lng = st.lng; }
    return;
  }
  const fr = !v.department || french(v.department);
  await fillCoords(v, [v.address, v.postal_code, v.city, fr ? 'France' : v.department].filter(Boolean).join(' '));
}

export function editShow(id, projectId, prefill={}){
  const s = id ? byId('shows', id) : {status:'Intérêt Salle', contract_type:'Cession', project_id: projectId||S.project||null, communication_enabled:true, date:null, ...prefill};
  // nouvelle date : spectacle présélectionné (seul actif, sinon celui par défaut de l'artiste), toujours modifiable (v1.60.3)
  if (!id && !s.spectacle_id && s.project_id) s.spectacle_id = defaultSpectacleId(s.project_id) || null;
  const extra = hiddenFields(s, [['lat',1],['lng',1],['prospect_id']])
    + (id && s.structure_id ? `<div class="full"><button type="button" class="btn sm" data-act="openStructure" data-id="${s.structure_id}">Ouvrir la fiche structure et son suivi</button></div>` : '')
    + (id && s.status?.startsWith('Confirmée') ? `<div class="full drive">${driveHTML(s)}</div>` : '');
  const p = openModal({
    title: id ? s.venue : 'Nouvelle date', fields: showFields(s), values: s, extra,
    deleteAsk: () => ({title: 'Supprimer la date ?', text: `Supprimer la date « ${[s.date ? fmtDate(s.date) : 'sans date', s.venue].filter(Boolean).join(' · ')} » avec ses lignes de facturation et son budget ? Les tâches liées restent ; le dossier Google Drive n’est pas touché.`,
      actions: [{value: 'del', label: 'Supprimer la date', danger: true}]}),
    onDelete: id ? () => remove('shows', id) : null,
    onSave: async v => {
      if (!v.venue) { toast('Indique le nom du lieu ou du festival', true); return false; }
      if (!v.project_id) { toast('Choisis l’artiste', true); return false; }
      // spectacle (v1.57) : il doit appartenir à l'artiste de la date ; une nouvelle date d'un artiste qui a des spectacles en demande un
      if (v.spectacle_id && byId('spectacles', v.spectacle_id)?.project_id !== v.project_id) { toast('Ce spectacle n’est pas celui de cet artiste : choisis-en un autre', true); return false; }
      if (!id && !v.spectacle_id && spectaclesOf(v.project_id).some(x => x.active)) { toast('Choisis le spectacle de cette date', true); return false; }
      await locateShow(v, s);
      const before = s.status, wasOff = isOff(before), nowOff = isOff(v.status), oldFee = s.fee_ht;
      let showId = id, ok = true;
      if (id){
        if (nowOff && !wasOff){ ok = !!(await saveLinger('shows', id, v, `Date passée en « ${v.status} »`)); }
        else ok = !!(await save('shows', id, v, {rerender:false}));
      } else showId = (await insert('shows', v))?.id;
      if (!ok || !showId) return false;
      if (id && Number(v.fee_ht) !== Number(oldFee)) await afterFeeChange(id, {level: 2});   // cachet changé : même règle partout (§6.5, Q5)
      // date qui passe en confirmée : envoyer la confirmation maintenant ? (une fois cette fenêtre fermée)
      if (becameConfirmed(before, v.status)) setTimeout(() => askConfirmation(showId), 80);
    }
  });
  // Choix d'une structure (organisateur) → son nom comme lieu si le nom est vide, rien d'autre : ni adresse, code postal, ville,
  // département ni coordonnées (décisions du 07/11/2026 : la structure n'est le lieu que sur confirmation).
  // La structure elle-même choisie dans la liste « Lieu » vaut confirmation : la case « Utiliser l'adresse de la structure… » est
  // cochée quand ce lieu est aussi l'organisateur de la date (choisi avant ou après) ; un autre lieu choisi ensuite la décoche.
  const dlg = $('#modal');
  let placeStructure = null, autoChecked = false;
  const onChosen = e => {
    const box = e.target.closest('.ac'); if (!box) return;
    const name = box.querySelector('.ac-val').name;
    const f = dlg.querySelector('form').elements, box2 = f.venue_is_structure;
    const sync = () => { if (!box2) return; const on = !!placeStructure && placeStructure === (f.structure_id?.value || null);
      if (on && !box2.checked){ box2.checked = true; autoChecked = true; } else if (!on && autoChecked){ box2.checked = false; autoChecked = false; } };
    if (name === 'venue'){ placeStructure = e.detail?.place_structure || null; sync(); return; }
    if (name !== 'structure_id') return;
    const st = byId('structures', e.detail.id); if (!st) return;
    const pre = showPrefillFromStructure(st);
    const put = (k, v) => { const el = f[k]; if (!el) return; el.value = v ?? ''; const vis = el.closest('.ac')?.querySelector('.ac-input'); if (vis) vis.value = v ?? ''; };
    if (!f.venue.value) put('venue', pre.venue);
    sync();
  };
  dlg.addEventListener('ac-chosen', onChosen);
  // autre artiste choisi → ses spectacles (v1.57) ; le spectacle choisi reste seulement s'il est aussi le sien
  const onProject = e => {
    if (e.target.id !== 'fld-project_id') return;
    const sel = dlg.querySelector('#fld-spectacle_id'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = spectacleOptions(e.target.value, null).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    else if (!id) sel.value = defaultSpectacleId(e.target.value);   // nouvelle date sans spectacle valable : présélection du nouvel artiste (v1.60.3)
  };
  dlg.addEventListener('change', onProject);
  dlg.addEventListener('close', () => { dlg.removeEventListener('ac-chosen', onChosen); dlg.removeEventListener('change', onProject); }, {once:true});
  return p;
}

/* ------------------------------------------------------------------ Projets */
export function editProject(id){
  const p = id ? byId('projects', id) : {active:true, mode:'production', default_artbo_pct: defaultCommission('production')};
  openModal({ title: id ? p.name : 'Nouveau projet', values: {...p, _make_folder: !id},
    fields: [
      {k:'name', label:'Nom', full:true}, {k:'active', label:'Projet actif', type:'checkbox'},
      {k:'mode', label:'Type de suivi', type:'select', blank:false, options:[['production','Production (L’ArtBo produit les dates)'],['booking','Booking seul (commission facturée à l’artiste)']],
        help:'Les dates existantes suivent, sauf celles réglées à la main et celles qui ont des opérations financières enregistrées (facture, versement, numéro, lien Pennylane).'},
      {k:'default_artbo_pct', label:"Commission L'ArtBo (%)", type:'number', help:'Par défaut : booking ' + pct(defaultCommission('booking')) + ', production ' + pct(defaultCommission('production')) + ' (Réglages › Pourcentages par défaut).'},
      {k:'default_acompte_pct', label:'Acompte par défaut (% du cachet)', type:'number', placeholder: String(settingAcompte()), help:'Vide : Réglages (' + pct(settingAcompte()) + '). 0 : sans acompte. Une date garde l’acompte posé sur elle ; s’applique aux prochaines dates confirmées.'},
      {k:'default_partner_id', label:'Co-producteur par défaut', type:'select', options:S.db.partners.map(x=>[x.id,x.name])},
      {k:'default_partner_pct', label:'% partenaire sur la commission', type:'number'},
      ...(p.drive_artist_folder_id ? [] : [{k:'_make_folder', label:'Créer son dossier Drive à son nom (à partir du modèle artiste)', type:'checkbox', full:true}]),
      {k:'drive_artist_folder_id', label:'Dossier Drive existant (lien ou identifiant) — sinon laisse vide', full:true},
      {k:'_h_acc', type:'html', full:true, html:'<h3 class="block-title mt-sm">Accueil (repris dans les contrats)</h3>'},
      {k:'road_people', label:'Personnes sur la route (= repas)', type:'number'},
      {k:'setup_hours', label:'Mise à disposition du lieu (montage, balances) en heures', type:'number'},
      {k:'rooms_single', label:'Chambres single', type:'number'},
      {k:'rooms_twin', label:'Chambres twin', type:'number'},
      {k:'_h_tpl', type:'html', full:true, html:'<h3 class="block-title mt-sm">Modèles de contrat propres à l’artiste</h3><p class="help m0">Lien d’un Google Doc. Laisse vide pour utiliser le modèle général (Réglages › Contrats).</p>'},
      {k:'contract_template_cc', label:'Contrat de cession', full:true, placeholder:'https://docs.google.com/document/d/…'},
      {k:'contract_template_cr', label:'Contrat de co-réalisation', full:true, placeholder:'https://docs.google.com/document/d/…'},
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    deleteAsk: () => ({title: 'Supprimer l’artiste ?', text: `Supprimer l’artiste « ${p.name || ''} » de la Matrice ?\nSes lignes de budget et ses modèles de mail propres sont supprimés avec lui ; ses dates, suivis et tâches restent, sans artiste.\nSes membres et son journal (échanges et pièces jointes) restent en base mais ne s’affichent plus nulle part.\nSes dossiers et fichiers Google Drive ne sont pas touchés.`,
      actions: [{value: 'del', label: 'Supprimer l’artiste', danger: true}]}),
    onDelete: id ? () => deleteProject(id) : null,
    onSave: async v => {
      if (!v.name) return false;
      if (v.default_acompte_pct != null && v.default_acompte_pct !== '' && !(Number(v.default_acompte_pct) >= 0 && Number(v.default_acompte_pct) <= 100)){ toast('L’acompte doit être entre 0 et 100 %', true); return false; }
      const makeFolder = v._make_folder; delete v._make_folder;
      if (v.drive_artist_folder_id) v.drive_artist_folder_id = driveId(v.drive_artist_folder_id);
      ['contract_template_cc','contract_template_cr'].forEach(k => { if (v[k]) v[k] = (String(v[k]).match(/[-\w]{25,}/) || [v[k]])[0]; });
      if (id){ const pctChanged = String(v.default_artbo_pct ?? '') !== String(p.default_artbo_pct ?? ''); const prevMode = p.mode;
        const ok = await save('projects', id, v, {rerender:false}); if (ok && makeFolder && !v.drive_artist_folder_id) createArtistFolder(id);
        if (ok && pctChanged) setTimeout(() => propagateCommission(id), 0);   // après la fermeture de la fenêtre
        // l'artiste change de mode : ses dates suivent (fait aussi par la base), sauf celles réglées à la main
        if (ok && v.mode && v.mode !== prevMode){   // la base a mis à jour les dates (et ajouté acomptes / soldes en production) : on recharge
          const ids = S.db.shows.filter(x => x.project_id === id).map(x => x.id);
          await refreshFor('shows', 'project_id', id); await refreshFor('show_payments', 'show_id', ids); render();
          // dates engagées (opérations financières enregistrées) : elles gardent leur mode — dit clairement (lot D1)
          const kept = S.db.shows.filter(x => x.project_id === id && !x.prod_mode_manual && (x.prod_mode || 'production') !== v.mode && hasFinancialRecord(x.id));
          if (kept.length) toast(`${kept.length} date${kept.length > 1 ? 's gardent leur' : ' garde son'} mode (${kept.length > 1 ? 'elles ont' : 'elle a'} des opérations financières enregistrées) : ${kept.map(x => x.venue || '').slice(0, 5).join(', ')}${kept.length > 5 ? '…' : ''}.`);
        }
        return; }
      const row = await insert('projects', v);
      // nouvel artiste : son dossier Drive est créé à son nom, à partir du modèle (LARTBOTRICE › 01_Modèles Drive)
      if (row && makeFolder && !row.drive_artist_folder_id) createArtistFolder(row.id);
    }
  });
  // le type de suivi change : la commission suit (booking / production) tant qu'elle est celle par défaut
  const modeSel = document.querySelector('#modal [name=mode]'), pctIn = document.querySelector('#modal [name=default_artbo_pct]');
  if (modeSel && pctIn){ let prev = modeSel.value;
    modeSel.addEventListener('change', () => { if (pctIn.value === '' || Number(pctIn.value) === defaultCommission(prev)) pctIn.value = defaultCommission(modeSel.value); prev = modeSel.value; }); }
}

/** Dossier Drive d'un artiste (créé depuis le modèle s'il n'existe pas encore) */
export async function createArtistFolder(projectId){
  const {callScript} = await import('./mail.js');
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'Création du dossier Drive de l’artiste à partir du modèle… (1 à 2 minutes, tu peux continuer)';
  document.querySelectorAll('.toast').forEach(x => x.remove()); document.body.appendChild(t);
  S.folderPending = projectId; render();
  try {
    // Google coupe un appel au bout de 6 min : le script s'arrête avant (done:false) et on le relance, la copie reprend où elle en était
    let out = await callScript('artist_folder', {project_id: projectId});
    for (let i = 0; out.done === false && i < 8; i++){ t.textContent = 'Copie du modèle dans le dossier de l’artiste… (suite, tu peux continuer)'; out = await callScript('artist_folder', {project_id: projectId}); }
    if (out.done === false) throw new Error('la copie du modèle n’est pas terminée : reclique sur « Créer le dossier Drive » pour la finir');
    const p = byId('projects', projectId); if (p) p.drive_artist_folder_id = out.folder_id;
    S.folderPending = null; touch('projects'); render();
    toast(out.created ? 'Dossier Drive de l’artiste créé' : 'Dossier Drive de l’artiste retrouvé et relié', false, out.url ? {label: 'Ouvrir', fn: () => window.open(out.url, '_blank')} : null);
  } catch (err) { S.folderPending = null; render(); toast('Dossier Drive : ' + err.message, true); }
}

/** Identifiant d'un dossier Drive à partir d'un lien collé */
export const driveId = s => { const m = String(s).match(/folders\/([\w-]{10,})/) || String(s).match(/[?&]id=([\w-]{10,})/); return m ? m[1] : String(s).trim(); };

/* ------------------------------------------------------------------ Tâches */
/** Tâche Booking : à réaliser sous 10 jours par défaut */
const BOOKING_DAYS = 10;
// échéance à J+n, décalée au lundi si elle tombe un samedi ou un dimanche
const inDays = n => workDay(addDays(today(), n));   // fonctions officielles (§1.6), jour de Paris

/** Suivis proposés pour une tâche : ceux de sa structure d'abord, puis les autres suivis ouverts */
function suiviOptions(t){
  const open = S.db.prospects.filter(p => !suiviClosed(p) || p.id === t.prospect_id);
  const mine = open.filter(p => t.structure_id && p.structure_id === t.structure_id), rest = open.filter(p => !mine.includes(p));
  const lab = p => prospectTitle(p) + (suiviClosed(p) ? (p.status === 'Confirmed' ? ' (confirmé)' : ' (clos)') : '');
  return [...mine, ...rest.sort((a,b) => lab(a).localeCompare(lab(b)))].map(p => [p.id, lab(p)]);
}

export function editTask(id, prefill={}){
  const t = id ? byId('tasks', id) : {status:'To Do', assigned_to: S.user.email, project_ids: S.project?[S.project]:[], ...prefill};
  if (!id && !t.deadline && /^booking$/i.test(t.department || '')) t.deadline = inDays(BOOKING_DAYS);
  const files = id ? attachmentsOf('task_id', id) : [];
  openModal({ title: id ? 'Tâche' : 'Nouvelle tâche', values: {...t, project_ids: projIds(t)},
    fields: [
      {k:'title', label:'Tâche', full:true},
      {k:'department', label:'Pôle', type:'select', options:deptNames().concat(t.department && !deptNames().includes(t.department) ? [t.department] : [])},
      {k:'assigned_to', label:'Pour', type:'select', options:team()},
      {k:'deadline', label:'Échéance', type:'date'}, {k:'status', label:'Statut', type:'select', options:TASK_STATUS_OPTS, blank:false},
      {k:'project_ids', label:'Projet(s)', type:'checks', options:activeProjects(projIds(t)), full:true},
      {k:'structure_id', label:'Structure', type:'ac', kind:'structures', create:true},
      {k:'show_id', label:'Date concernée', type:'ac', kind:'shows', placeholder:'Artiste, lieu, ville ou date…'},
      {k:'prospect_id', label:'Suivi (facultatif)', type:'select', options:suiviOptions(t)},
      {k:'priority', label:'Priorité (si pas d’échéance)', type:'select', options:PRIORITY_OPTS}, {k:'tags', label:'Tags', type:'tags', suggest: () => ['Call', 'Mail', ...S.db.tasks.flatMap(x => x.tags || [])]},
      {k:'notes', label:'Notes', type:'textarea', full:true, rows:5},
      ...(files.length ? [{k:'_existing', type:'html', label:'Pièces jointes', full:true, html: files.map(f=>fileRow(f, 'openAttachment', 'delAttachment')).join('')}] : []),
      {k:'_files', label: files.length ? 'Ajouter des pièces jointes' : 'Pièces jointes', type:'files', full:true},
    ],
    // suppression (Q20, v1.46b) : « Annuler » ne supprime jamais rien ; une relance téléphone ouverte propose deux issues nommées
    deleteAsk: id ? () => {
      const n = attachmentsOf('task_id', id).length, phone = t.auto_kind === 'relance_tel' && t.prospect_id && !isDone(t);
      return {title: 'Supprimer la tâche ?', text: `Supprimer la tâche « ${t.title || 'sans titre'} »${n ? ` et ${n > 1 ? `ses ${n} pièces jointes` : 'sa pièce jointe'}` : ''} ?`
          + (phone ? '\nRelance téléphone sans réponse : tu peux aussi clore le suivi (noté dans son journal).' : ''),
        actions: phone ? [{value: 'task', label: 'Supprimer seulement la tâche', danger: true}, {value: 'close', label: 'Supprimer et clore le suivi', danger: true}]
          : [{value: 'task', label: 'Supprimer la tâche', danger: true}]};
    } : null,
    onDelete: id ? async choice => {
      if (choice === 'close') await closeNoAnswer(id, {deleted:true});
      const paths = attachmentsOf('task_id', id).map(f => f.path);
      if (!(await remove('tasks', id))) return false;
      await removeWhere('attachments', 'task_id', id);
      await purgeStored(paths);   // fichiers des pièces jointes effacés avec la tâche (§4.4)
      return true; } : null,
    onSave: async v => {
      if (!v.title){ toast('Donne un nom à la tâche', true); return false; }
      v.prospect_id = v.prospect_id || null;
      const up = v._files || []; delete v._files; delete v._existing;
      v.project_id = v.project_ids[0] || null;
      // date et heure réelles de réalisation (Q17, v1.46b) : posées en passant à « Faite » / « Annulée », effacées en revenant « À faire »
      const cur = id ? byId('tasks', id) : null, wasDone = !!cur && isDone(cur), nowDone = isDone(v);   // état actuel (mise à jour en direct comprise)
      if (nowDone && !wasDone) v.done_at = new Date().toISOString();
      else if (!nowDone && wasDone) v.done_at = null;
      let row = {id};
      if (id && nowDone && !wasDone){   // terminée depuis la fenêtre : 5 s pour annuler, comme la case (§4.3)
        if (!(await saveLinger('tasks', id, v, v.status === 'Cancelled' ? 'Tâche annulée' : 'Tâche terminée'))) return false;
      } else if (id){ if (!(await save('tasks', id, v, {rerender:false}))) return false; }
      else row = await insert('tasks', v);
      if (row && up.length) await uploadFiles({task_id: row.id}, up);
    }
  });
  // Nouvelle tâche passée en pôle Booking : échéance à J+10 si elle n'en a pas
  if (!id){
    const f = $('#modal form').elements;
    f.department?.addEventListener('change', () => {
      if (/^booking$/i.test(f.department.value) && !f.deadline.value){
        f.deadline.value = inDays(BOOKING_DAYS);
        const txt = f.deadline.closest('.dt')?.querySelector('.dt-txt'); if (txt) txt.value = inDays(BOOKING_DAYS).split('-').reverse().join('/');
      }
    });
  }
}

/* ------------------------------------------------------------------ Contacts */
/** Doublon par mail : null (aucun), 'save' (enregistrer quand même), 'cancel' (rester dans la fenêtre) ou le contact existant choisi */
async function askDuplicate(v, id, openLabel){
  const dups = contactsWithMail([v.email, v.email_2], id); if (!dups.length) return null;
  const d = dups[0], st = linksOfContact(d.id).map(s => s.name).filter(Boolean).join(', ');
  const mail = [v.email, v.email_2].find(m => m && [d.email, d.email_2].some(x => String(x || '').trim().toLowerCase() === String(m).trim().toLowerCase()));
  const r = await ask({title: 'Contact déjà présent', text: `Le mail ${mail} est déjà celui de « ${d.display_name || [d.first_name, d.last_name].filter(Boolean).join(' ') || 'contact sans nom'} »${st ? ` (${st})` : ''}${dups.length > 1 ? ` et de ${dups.length - 1} autre${dups.length > 2 ? 's' : ''} contact${dups.length > 2 ? 's' : ''}` : ''}.\nAucune fusion n’est faite : tu peux ouvrir la fiche existante, ou enregistrer quand même un second contact.${openLabel === 'Ouvrir la fiche existante' ? '\nEn ouvrant la fiche existante, ce que tu viens de saisir ici n’est pas enregistré.' : ''}`,
    actions: [{value: 'open', label: openLabel}, {value: 'save', label: 'Enregistrer quand même'}]});
  return r === 'open' ? d : r === 'save' ? 'save' : 'cancel';
}
/** Coordonnées d'un contact : les mêmes cases partout où l'on crée ou modifie une personne (les 2 mails partent dans Brevo) */
const CONTACT_COORDS = [
  {k:'email', label:'Mail', type:'email'}, {k:'email_2', label:'Mail 2', type:'email'},
  {k:'phone', label:'Téléphone'}, {k:'phone_2', label:'Téléphone 2'},
];
export function editContact(id, prefill={}){
  const c = id ? byId('contacts', id) : {...prefill};
  const links = id ? linksOfContact(id).map(s=>s.id) : (prefill._structures || []);
  const brevo = !id ? '' : c.brevo_error ? `<p class="help full" style="color:var(--danger)">Brevo : ${esc(c.brevo_error)}</p>`
    : c.brevo_at ? `<p class="help full">Dans Brevo (mis à jour le ${fmtDate(c.brevo_at)}).</p>` : '';
  return openModal({ title: id ? c.display_name : 'Nouveau contact', values: {...c, _structures: links}, extra: brevo,
    fields: [
      {k:'first_name', label:'Prénom'}, {k:'last_name', label:'Nom'},
      {k:'_structures', label:'Structures', type:'links', source:'structures', create:true, full:true},
      {k:'roles', label:'Poste(s)', type:'tags', full:true, suggest: () => [...CONTACT_ROLES, ...S.db.contacts.flatMap(x => x.roles || [])]},
      ...CONTACT_COORDS,
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    deleteAsk: () => ({title: 'Supprimer le contact ?', text: `Supprimer le contact « ${c.display_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'sans nom'} » et ses liens avec les structures ? Les dates, suivis et échanges qui le citaient restent, sans contact. Il n’est pas retiré de Brevo.`,
      actions: [{value: 'del', label: 'Supprimer le contact', danger: true}]}),
    onDelete: id ? () => remove('contacts', id) : null,
    onSave: async v => {
      const ids = v._structures; delete v._structures;
      v.display_name = [v.first_name, v.last_name].filter(Boolean).join(' ') || c.display_name || v.email || v.email_2;
      if (!v.display_name){ toast('Indique au moins un nom', true); return false; }
      // doublon par mail (décisions du 27/10) : avertissement et accès à la fiche existante ; jamais de fusion automatique.
      // Seulement à la création, ou pour une adresse ajoutée / modifiée : changer le téléphone ou les notes ne le refait pas.
      const key = m => String(m || '').trim().toLowerCase(), before = id ? [c.email, c.email_2].map(key) : [];
      const fresh = [v.email, v.email_2].filter(m => key(m) && !before.includes(key(m)));
      const dup = fresh.length ? await askDuplicate({email: fresh[0], email_2: fresh[1] || null}, id, 'Ouvrir la fiche existante') : null;
      if (dup === 'cancel') return false;
      if (dup && dup !== 'save'){ setTimeout(() => editContact(dup.id), 0); return null; }   // la fenêtre se ferme sans rien enregistrer, la fiche existante s'ouvre
      let row; if (id){ await save('contacts', id, v, {rerender:false}); row={id}; } else row = await insert('contacts', v);
      if (row) await syncLinks('contact', row.id, ids);
      return row;
    }
  });
}

/* ------------------------------------------------------------------ Structures */
const structFields = () => [
  {k:'name', label:'Nom', full:true},
  {k:'tags', label:'Types (tags)', type:'tags', full:true, suggest: () => [...STRUCT_TAGS, ...S.db.structures.flatMap(x => x.tags || [])]},
  {k:'address', label:'Adresse — tape une adresse ou une ville, les champs se remplissent', type:'place', full:true},
  {k:'postal_code', label:'Code postal'}, {k:'city', label:'Ville'},
  {k:'region', label:'Région'}, {k:'country', label:'Pays'},
];
const structHidden = s => hiddenFields(s, [['lat',1],['lng',1],['department_code'],['department_name']]);

async function locate(v, before={}){
  const moved = ['address','postal_code','city','country'].some(k => (v[k] || '') !== (before[k] || ''));
  // coordonnées déjà fournies par le choix d'une adresse dans la liste : rien à faire
  if (v.lat != null && v.lat !== before.lat) return;
  if (!moved && before.lat != null) return;
  if (!v.city && !v.postal_code && !v.address) return;
  // l'emplacement a changé à la main : l'ancien département, l'ancienne région et les coordonnées ne valent plus
  if (moved){ v.lat = v.lng = null; v.department_code = v.department_name = null; if ((v.region || '') === (before.region || '')) v.region = null; }
  const fr = !v.country || /^france$/i.test(v.country);
  const q = [v.address, v.postal_code, v.city].filter(Boolean).join(' ');
  // ville seule : on ne cherche qu'une commune (pas une « rue de Charleroi » en France)
  const g = !fr ? null : v.address ? (await geocode(q, {france:true}) || (v.city ? await geoFrance(v.city) : null)) : await geoFrance([v.postal_code, v.city].filter(Boolean).join(' '));
  if (g && g.department_code){ v.lat=g.lat; v.lng=g.lng; v.department_code=g.department_code; v.department_name=g.department_name; v.region = v.region || g.region; v.city = v.city || g.city; v.postal_code = v.postal_code || g.postcode; return; }
  // hors de France (ou introuvable en France) : la ville est cherchée dans le monde, avec sa région et son pays
  // résultat retenu seulement s'il est bien dans le pays indiqué (et au bon code postal s'il est donné) : pas d'homonyme à l'autre bout du monde
  const sameCountry = x => fr ? x.country !== 'France' : norm(x.country || '') === norm(v.country) || norm(x.country_code || '') === norm(v.country);
  const okPlace = x => norm(x.city || '') === norm(v.city) && sameCountry(x) && (!v.postal_code || !x.postcode || String(x.postcode).replace(/\s/g,'') === String(v.postal_code).replace(/\s/g,''));
  const p = v.city ? (await searchPlaces([v.city, fr ? '' : v.country].filter(Boolean).join(' '), {cities:true})).find(okPlace) : null;
  if (p){ v.lat=p.lat; v.lng=p.lng; v.region = v.region || p.region || null; if (p.country && fr) v.country = p.country; return; }
  // dernier recours : l'adresse complète avec le pays ; sinon pas de coordonnées (mieux que de fausses)
  if (!fr){ const w = await geocode([q, v.country].filter(Boolean).join(' '), {france:false}); if (w && norm(w.label || '').includes(norm(v.country))){ v.lat=w.lat; v.lng=w.lng; } }
}

/** Champs de la fiche structure (les mêmes partout : onglet Structures, nouveau suivi, nouvelle date, tâche…) */
const structFormFields = (isNew, nested=false) => [...structFields(),
  {k:'website', label:'Site web'},
  // fenêtre par-dessus un autre formulaire : on choisit des contacts existants (les créer ouvrirait une 3e fenêtre)
  {k:'_contacts', label:'Contacts', type:'links', source:'contacts', create:!nested, full:true},
  {k:'notes', label:'Notes', type:'textarea', full:true},
  // à la création : le festival / la salle / l'événement de la structure, avec ses dates, sa jauge et son tarif
  ...(isNew ? [{k:'_h_ev', type:'html', full:true, html:'<h3 class="block-title mt-sm">Festival, salle ou événement</h3><p class="help m0">Facultatif. D’autres pourront être ajoutés dans l’onglet « Festivals / salles » de la fiche.</p>'},
    ...eventFields('_ev_')] : []),
];

/** Enregistre la fiche structure (+ contacts liés, + festival / salle à la création) ; renvoie la ligne */
async function saveStructure(id, s, v){
  const ids = v._contacts || []; delete v._contacts;
  if (!v.name){ toast('Indique le nom de la structure', true); return false; }
  const ev = takeEvent(v, '_ev_');
  await locate(v, s);
  let row; if (id){ await save('structures', id, v, {rerender:false}); row = {id, ...v}; } else row = await insert('structures', v);
  if (!row) return false;
  await syncLinks('structure', row.id, ids);
  if (!id && ev) await insert('structure_events', {...ev, name: ev.name || v.name, city: ev.city || v.city || null, structure_id: row.id});
  return row;
}

export function editStructure(id){
  const s = id ? byId('structures', id) : {country:'France'};
  const links = id ? linksOfStructure(id).map(c=>c.id) : [];
  openModal({ title: id ? s.name : 'Nouvelle structure', values: {...s, _contacts: links}, extra: structHidden(s),
    fields: structFormFields(!id),
    deleteAsk: () => ({title: 'Supprimer la structure ?', text: `Supprimer la structure « ${byId('structures', id)?.name || ''} » ? Ses liens avec les contacts sont retirés ; les dates, suivis et tâches liés restent, sans structure. Ses événements (festivals, saisons) restent en base mais ne s’affichent plus.`,
      actions: [{value: 'del', label: 'Supprimer la structure', danger: true}]}),
    onDelete: id ? () => remove('structures', id) : null,
    onSave: async v => { const row = await saveStructure(id, s, v); if (!row) return false;
      // nouvelle structure : sa fiche s'ouvre une fois la fenêtre fermée
      if (!id) setTimeout(() => { S.view = 'structures'; S.structurePage = row.id; S.tab.structure = 'home'; S.focusProspect = null; render(); window.scrollTo(0, 0); }, 0);
    }
  });
}

/** Champs d'un festival / d'une salle / d'un événement (prefix : '_ev_' dans la fiche structure) */
function eventFields(pre=''){
  return [
    {k:pre+'kind', label:'Type', type:'select', options:EVENT_KINDS},
    {k:pre+'name', label:'Nom du festival, de la salle ou de l’événement', placeholder: pre ? 'Vide = nom de la structure' : ''},
    {k:pre+'date_start', label:'Début', type:'date'}, {k:pre+'date_end', label:'Fin', type:'date'},
    {k:pre+'period', label:'Période habituelle', placeholder:'ex. 2e week-end de juillet'},
    {k:pre+'city', label:'Ville', type:'city', fill:pre},
    {k:pre+'capacity', label:'Jauge', type:'number'},
    {k:pre+'pricing', label:'Payant ou gratuit', type:'select', options:PRICING},
    {k:pre+'price_avg', label:'Prix moyen du billet (€)', type:'number'},
    {k:pre+'place', label:'Lieu (si différent)'},
    ...(pre ? [] : [{k:'notes', label:'Notes', type:'textarea', full:true}]),
  ];
}

/** Sort les champs « _ev_… » des valeurs du formulaire ; renvoie l'événement s'il y a quelque chose dedans */
function takeEvent(v, pre){
  const ev = {}; let any = false;
  for (const k of Object.keys(v)) if (k.startsWith(pre)){ const f = k.slice(pre.length); ev[f] = v[k]; delete v[k]; if (ev[f] != null && ev[f] !== '') any = true; }
  return any ? ev : null;
}

/** Création rapide d'une structure depuis un champ de recherche (fenêtre par-dessus le formulaire) */
CREATORS.structures = async name => {
  // mêmes cases que « Nouvelle structure » dans l'onglet Structures
  const row = await openModal({ level:2, wide:true, title:'Nouvelle structure', values:{name, country:'France', _contacts:[]}, extra: structHidden({}), fields: structFormFields(true, true), saveLabel:'Créer la structure',
    onSave: v => saveStructure(null, {}, v) });
  if (!row) return null;
  toast(`Structure « ${row.name} » créée`);
  return {id: row.id, label: row.name};
};

CREATORS.contacts = async name => {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  const row = await openModal({ level:2, title:'Nouveau contact', values:{first_name:first, last_name:rest.join(' ')}, saveLabel:'Créer le contact',
    fields:[{k:'first_name', label:'Prénom'}, {k:'last_name', label:'Nom'}, {k:'roles', label:'Poste(s)', type:'tags', full:true, suggest: () => [...CONTACT_ROLES, ...S.db.contacts.flatMap(x => x.roles || [])]}, ...CONTACT_COORDS],
    onSave: async v => { v.display_name = [v.first_name, v.last_name].filter(Boolean).join(' ') || v.email || v.email_2; if (!v.display_name){ toast('Indique au moins un nom', true); return false; }
      // doublon par mail : on peut reprendre le contact existant au lieu d'en créer un second (aucune fusion automatique)
      const dup = await askDuplicate(v, null, 'Utiliser ce contact');
      if (dup === 'cancel') return false;
      if (dup && dup !== 'save') return dup;
      return await insert('contacts', v); } });
  if (!row) return null;
  return {id: row.id, label: row.display_name};
};

/* ------------------------------------------------------------------ Suivis */
export function editProspect(id){
  const p = id ? byId('prospects', id) : {status:'Mailed', project_ids: [], name:'Suivi', structure_id:S.newSuiviStructure||null, last_contact: today()};
  openModal({ title: id ? prospectTitle(p) : 'Nouveau suivi', values: {...p, project_ids: projIds(p)},
    fields: [
      {k:'structure_id', label:'Structure — tape le nom, ou crée-la si elle n’existe pas', type:'ac', kind:'structures', create:true, activeOnly:true, full:true},
      {k:'project_ids', label:'Artiste(s) concerné(s)', type:'checks', options:activeProjects(projIds(p)), full:true},
      {k:'status', label:'Statut', type:'select', options:PROSPECT_OPTS, blank:false},
      {k:'last_contact', label:'Dernier contact', type:'date'},
      ...(id ? [{k:'summary', label:'Résumé', type:'textarea', full:true}] : [
        {k:'_contact', label:'Interlocuteur (contact de la structure)', type:'ac', kind:'contacts', create:true, full:true},
        {k:'_note', label:'Notes de ce premier échange', type:'textarea', full:true, rows:5},
        {k:'_kind', label:'Type d’échange', type:'select', options:['Appel','Mail','RDV','Note'], blank:false},
        {k:'_files', label:'Pièces jointes (PDF de mails…)', type:'files', full:true}]),
    ],
    deleteAsk: id ? () => prospectDeleteAsk(id) : null,
    onDelete: id ? () => deleteProspect(id) : null,   // journal, pièces et fichiers stockés avec lui (v1.46b)
    onSave: async v => {
      if (!v.structure_id){ toast('Choisis ou crée la structure', true); return false; }
      const files = v._files || [], note = v._note, contact = v._contact, kind = v._kind || 'Appel';
      ['_files','_note','_contact','_kind'].forEach(k => delete v[k]);
      v.project_id = v.project_ids[0] || null;
      v.name = p.name || 'Suivi';
      if (id){ if (await save('prospects', id, v, {rerender:false}) && suiviClosed(v)) await cancelAutoRelances(id); return; }
      const row = await insert('prospects', v);
      if (!row) return false;
      const c = byId('contacts', contact);
      if (c && !linksOfStructure(v.structure_id).some(x=>x.id===c.id)) await syncLinks('structure', v.structure_id, [...linksOfStructure(v.structure_id).map(x=>x.id), c.id]);
      if (note || c) await insert('prospect_logs', {prospect_id:row.id, date:v.last_contact||today(), kind, contact_name:c?.display_name||null, body:note||null, author:S.user.email});
      if (files.length) await uploadFiles({prospect_id: row.id}, files);
      S.view='prospects'; S.suiviPage=row.id; S.wsTarget=undefined; S.wsFor=null;
    }
  });
}

/** Export CSV des suivis : un projet, un ou plusieurs statuts → une ligne par contact de la structure */
export function exportSuivis(projectId){
  const fixed = projectId ? byId('projects', projectId) : null;
  openModal({ title: fixed ? `Exporter les suivis — ${fixed.name}` : 'Exporter les suivis', saveLabel:'Télécharger',
    values:{project: projectId || S.project || '', statuses: PROSPECT.filter(x=>x!=='Closed'), format:'xlsx'},
    fields:[
      ...(fixed ? [] : [{k:'project', label:'Projet', type:'project', full:true}]),
      {k:'statuses', label:'Statuts', type:'checks', options:PROSPECT_OPTS, full:true},
      {k:'from', label:'Dernier échange à partir du', type:'date'}, {k:'to', label:'jusqu’au', type:'date'},
      FORMAT_FIELD,
    ],
    onSave: async v => {
      const pid = projectId || v.project;
      if (!pid){ toast('Choisis un projet', true); return false; }
      if (!v.statuses.length){ toast('Coche au moins un statut', true); return false; }
      const list = S.db.prospects.filter(p => projIds(p).includes(pid) && v.statuses.includes(p.status)).filter(p => {
        const last = lastExchange(p);
        if ((v.from || v.to) && !last) return false;
        return (!v.from || last >= v.from) && (!v.to || last <= v.to);
      });
      const rows = [];
      for (const p of list){
        const st = byId('structures', p.structure_id), contacts = linksOfStructure(p.structure_id), last = lastExchange(p) || '';
        const base = {project: projName(pid), structure: st?.name||p.name, city: st?.city||'', status: p.status, last};
        if (!contacts.length) rows.push(base);
        for (const c of contacts) rows.push({...base, first: c.first_name||'', lastname: c.last_name || (c.first_name?'':c.display_name) || '', email: contactMails(c)});
      }
      const columns = [{header:'Projet', key:'project', width:18}, {header:'Structure', key:'structure', width:28}, {header:'Ville', key:'city', width:18},
        {header:'Prénom', key:'first', width:14}, {header:'Nom', key:'lastname', width:16}, {header:'Mail', key:'email', width:28},
        {header:'Statut', key:'status', width:12}, {header:'Dernier échange', key:'last', type:'date', width:14}];
      const artist = projName(pid).replace(/\s*•.*$/, '');
      try { await exportTable({name:`Suivis ${artist}`, title:`${artist} — Suivis`, subtitle:`${list.length} suivi${list.length>1?'s':''} · ${v.statuses.join(', ')}`, columns, rows, format: v.format}); }
      catch (err) { toast(err.message, true); return false; }
      toast(`${rows.length} ligne(s) exportée(s)`);
    }
  });
}

/* ------------------------------------------------------------------ Événements d'une structure */
export function newEvent(structureId){
  const st = byId('structures', structureId);
  const isFest = (st?.tags || []).some(t => /festival/i.test(t));
  openModal({ title:'Nouveau festival, salle ou événement', values:{city: st?.city, kind: isFest ? 'Festival' : 'Salle', name: eventsOfStructure(structureId).length ? '' : st?.name},
    fields: eventFields(),
    onSave: async v => { if (!v.name){ toast('Indique le nom', true); return false; } await insert('structure_events', {...v, structure_id: structureId}); }
  });
}

/* ------------------------------------------------------------------ Photo de projet */
export function projectPhoto(id){
  const p = byId('projects', id);
  let pos = (p.photo_pos || '50% 50% 1').split(' ').map(x=>parseFloat(x)); if (!pos[2]) pos[2] = 1;
  const style = () => `object-position:${pos[0]}% ${pos[1]}%;transform:scale(${pos[2]});transform-origin:${pos[0]}% ${pos[1]}%`;
  let path = p.photo_orig || p.photo_path;   // on recadre toujours depuis l'image d'origine
  const draw = async () => {
    const box = $('#cropper'); if (!box) return;
    const u = path ? await signedUrl(path) : null;
    box.innerHTML = u ? `<img src="${esc(u)}" alt="" style="${style()}">` : '<div class="empty" style="color:#fff">Choisis une image</div>';
  };
  openModal({ title:'Photo du projet', saveLabel:'Enregistrer la photo',
    fields:[{k:'_h', type:'html', full:true, html:`<div class="cropper" id="cropper"></div>
      <div class="target-row" style="justify-content:center;margin-top:10px"><label for="photo-zoom" class="muted">Zoom</label><input id="photo-zoom" type="range" min="1" max="3" step="0.05" value="${pos[2]}" style="max-width:220px"></div>
      <p class="help" style="text-align:center">Fais glisser l’image pour choisir la partie visible dans le carré, et zoome si besoin.</p>
      <div class="dropzone" data-photo-drop="1" style="justify-content:center"><label class="btn sm file-btn">Choisir une image<input type="file" accept="image/*" class="file-input" id="photo-file"></label><span class="drop-hint">ou glisse-la ici</span></div>`}],
    onSave: async () => {
      if (!path){ toast('Choisis une image', true); return false; }
      // l'image est réellement recadrée en carré (comme l'aperçu) puis enregistrée
      const blob = await cropSquare(path, pos).catch(e => { toast('Recadrage impossible : ' + e.message, true); return null; });
      if (!blob) return false;
      const sq = `project/${id}/photo_${Date.now()}_carre.jpg`;
      const {error} = await sb.storage.from('suivi').upload(sq, blob, {contentType:'image/jpeg', upsert:false});
      if (error){ toast(error.message, true); return false; }
      await save('projects', id, {photo_path: sq, photo_orig: path, photo_pos: `${Math.round(pos[0])}% ${Math.round(pos[1])}% ${pos[2]}`}, {rerender:false});
    }
  });
  draw();
  const upload = async file => {
    if (!file || !/^image\//.test(file.type)) return toast('Choisis une image (JPG, PNG…)', true);
    const newPath = `project/${id}/photo_${Date.now()}.${(file.name.split('.').pop()||'jpg').toLowerCase()}`;
    toast('Envoi de l’image…');
    const {error} = await sb.storage.from('suivi').upload(newPath, file, {contentType:file.type, upsert:false});
    if (error) return toast(error.message, true);
    path = newPath; pos = [50, 50, 1]; const zr = $('#photo-zoom'); if (zr) zr.value = 1; draw();
  };
  $('#photo-file').onchange = e => upload(e.target.files[0]);
  const dz = $('[data-photo-drop]');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); upload(e.dataTransfer.files[0]); };
  // Glisser pour recadrer
  const box = $('#cropper'); let drag = null;
  box.onpointerdown = e => { drag = {x:e.clientX, y:e.clientY, p:[...pos]}; box.setPointerCapture(e.pointerId); box.style.cursor='grabbing'; };
  box.onpointermove = e => { if (!drag) return; const img = box.querySelector('img'); if (!img) return;
    const k = 100 / box.clientWidth / pos[2];
    pos = [Math.min(100, Math.max(0, drag.p[0] - (e.clientX-drag.x)*k)), Math.min(100, Math.max(0, drag.p[1] - (e.clientY-drag.y)*k)), pos[2]];
    img.setAttribute('style', style()); };
  $('#photo-zoom').oninput = e => { pos[2] = Number(e.target.value); const img = box.querySelector('img'); if (img) img.setAttribute('style', style()); };
  box.onpointerup = () => { drag = null; box.style.cursor=''; };
}

/** Recadre l'image (object-fit: cover + position + zoom, comme l'aperçu) en un carré JPEG de 600 px */
async function cropSquare(path, [px, py, z]){
  const u = await signedUrl(path);
  const blob = await (await fetch(u)).blob();
  const img = await createImageBitmap(blob);
  const S = 600, c = Math.max(S / img.width, S / img.height), W = img.width * c, H = img.height * c;
  const fx = px / 100, fy = py / 100, ox = (S - W) * fx, oy = (S - H) * fy, ax = S * fx, ay = S * fy;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.drawImage(img, ax + z * (ox - ax), ay + z * (oy - ay), W * z, H * z);
  return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
}

/** Lier un dossier Drive existant à une date (lien collé) */
export async function linkDrive(showId){
  const v = await askText({title: 'Lier un dossier Drive', label: 'Lien du dossier Google Drive de cette date', placeholder: 'https://drive.google.com/drive/folders/…', ok: 'Lier le dossier',
    check: x => /^[\w-]{10,}$/.test(driveId(x)) ? '' : 'Lien de dossier Drive non reconnu'});
  if (!v) return;
  const id = driveId(v);
  await save('shows', showId, {drive_folder_id: id, drive_folder_error: null});
  toast('Dossier Drive lié');
}

export { touch, render };

/** Supprimer un artiste : ses modèles de mail partagés avec d'autres artistes restent (réattribués), seuls les siens partent */
async function deleteProject(id){
  // spectacles (v1.57) : la base refuse de supprimer un artiste qui en a ; on le dit AVANT de toucher aux modèles de mail (relecture V1.57)
  const sp = spectaclesOf(id);
  if (sp.length){ toast(`Cet artiste a ${sp.length} spectacle${sp.length > 1 ? 's' : ''} (${sp.map(x => x.name).join(', ')}) : il ne peut pas être supprimé. Passe-le en inactif.`, true); return false; }
  for (const t of (S.db.mail_templates || []).filter(t => (t.project_ids || []).includes(id) && t.project_ids.length > 1)){
    const ids = t.project_ids.filter(x => x !== id);
    await save('mail_templates', t.id, {project_ids: ids, project_id: ids[0]}, {rerender: false});
  }
  return remove('projects', id);
}
