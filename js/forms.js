/**
 * Formulaires de création / modification : date, projet, tâche, contact, structure, suivi, événement,
 * créations rapides (structure, contact) depuis un champ de recherche, export CSV des suivis, photo de projet.
 */
import { render } from './app.js';
import { CFG } from './config.js';
import { CONFIRMED_PROD, CONTRACTS, PRIORITIES, PROSPECT, STATUSES, TASK_STATUS, TEAM_NAMES, TICKETING, isOff } from './constants.js';
import { insert, remove, removeWhere, save, saveLinger, sb, signedUrl, syncLinks, uploadFiles } from './data.js';
import { fillCoords, geocode } from './geo.js';
import { attachmentsOf, byId, deptNames, lastExchange, linksOfContact, linksOfStructure, projIds, projName, projectOptions, prospectTitle } from './selectors.js';
import { S, touch } from './state.js';
import { CREATORS } from './ui/autocomplete.js';
import { fileRow } from './ui/bits.js';
import { hiddenFields, openModal } from './ui/modal.js';
import { $, downloadCSV, esc, toast, today } from './utils.js';
import { driveHTML } from './views/production.js';

const team = () => CFG.TEAM.map(e=>[e, TEAM_NAMES[e]||e]);
const activeProjects = keep => projectOptions(true, keep).map(x=>[x.id, x.name]);

/* ------------------------------------------------------------------ Dates */
export function showFields(s){
  return [
    {k:'structure_id', label:'Structure (salle, festival, organisateur)', type:'ac', kind:'structures', create:true, full:true},
    {k:'venue', label:'Nom du lieu / festival', full:true},
    {k:'project_id', label:'Artiste', type:'project'},
    {k:'status', label:'Statut', type:'select', options:STATUSES.includes(s.status)||!s.status ? STATUSES : [s.status, ...STATUSES], blank:false},
    {k:'date', label:'Date', type:'date'}, {k:'date_end', label:'Fin (si plusieurs jours)', type:'date'},
    {k:'city', label:'Ville', type:'city', fill:''}, {k:'department', label:'Département (ou pays)', placeholder:'ex. 69, CH, BE'},
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

/** Valeurs d'une nouvelle date posée depuis une structure : ville et département de la fiche (pas de l'adresse administrative) */
export const showPrefillFromStructure = st => st ? {structure_id: st.id, venue: st.name, city: st.city || null, department: st.department_code || (st.country && st.country!=='France' ? st.country : null), lat: st.lat, lng: st.lng} : {};

export function editShow(id, projectId, prefill={}){
  const s = id ? byId('shows', id) : {status:'Intérêt Salle', contract_type:'Cession', project_id: projectId||S.project||null, communication_enabled:true, date:null, ...prefill};
  const extra = hiddenFields(s, [['lat',1],['lng',1],['prospect_id']])
    + (id && s.structure_id ? `<div class="full"><button type="button" class="btn sm" data-act="openStructure" data-id="${s.structure_id}">Ouvrir la fiche structure et son suivi</button></div>` : '')
    + (id && s.status?.startsWith('Confirmée') ? `<div class="full drive">${driveHTML(s)}</div>` : '');
  const p = openModal({
    title: id ? s.venue : 'Nouvelle date', fields: showFields(s), values: s, extra,
    onDelete: id ? () => remove('shows', id) : null,
    onSave: async v => {
      if (!v.venue) { toast('Indique le nom du lieu ou du festival', true); return false; }
      if (!v.project_id) { toast('Choisis l’artiste', true); return false; }
      const st = byId('structures', v.structure_id);
      if (!v.city && st) v.city = st.city;
      const placeChanged = !id || v.city!==s.city || v.structure_id!==s.structure_id;
      if (placeChanged && (v.lat==null || v.city!==s.city)){
        if (st && st.lat!=null && (!v.city || v.city===st.city)){ v.lat=st.lat; v.lng=st.lng; v.department = v.department || st.department_code; }
        else if (v.lat==null || v.city!==s.city){ v.lat=null; v.lng=null; await fillCoords(v, [v.city, v.department && /^\d/.test(v.department) ? 'France' : ''].filter(Boolean).join(', ')); }
      }
      const wasOff = isOff(s.status), nowOff = isOff(v.status);
      if (id){
        if (nowOff && !wasOff){ await saveLinger('shows', id, v, `Date passée en « ${v.status} »`); }
        else await save('shows', id, v, {rerender:false});
      } else await insert('shows', v);
      if (CONFIRMED_PROD.includes(v.status) && !CONFIRMED_PROD.includes(s.status)) toast('Date confirmée : facturation créée dans Production');
    }
  });
  // Choix d'une structure → nom du lieu, ville et département repris de sa fiche
  const dlg = $('#modal');
  const onChosen = e => {
    const box = e.target.closest('.ac'); if (!box || box.querySelector('.ac-val').name !== 'structure_id') return;
    const st = byId('structures', e.detail.id); if (!st) return;
    const f = dlg.querySelector('form').elements;
    const pre = showPrefillFromStructure(st);
    if (!f.venue.value) f.venue.value = pre.venue;
    if (pre.city){ f.city.value = pre.city; const ci = f.city.closest('.ac')?.querySelector('.ac-input'); if (ci) ci.value = pre.city; }
    if (pre.department) f.department.value = pre.department;
    if (f.lat){ f.lat.value = st.lat ?? ''; f.lng.value = st.lng ?? ''; }
  };
  dlg.addEventListener('ac-chosen', onChosen);
  dlg.addEventListener('close', () => dlg.removeEventListener('ac-chosen', onChosen), {once:true});
  return p;
}

/* ------------------------------------------------------------------ Projets */
export function editProject(id){
  const p = id ? byId('projects', id) : {active:true, mode:'production'};
  openModal({ title: id ? p.name : 'Nouveau projet', values: p,
    fields: [
      {k:'name', label:'Nom', full:true}, {k:'active', label:'Projet actif', type:'checkbox'},
      {k:'mode', label:'Type de suivi', type:'select', blank:false, options:[['production','Production (L’ArtBo produit les dates)'],['booking','Booking seul (commission facturée à l’artiste)']],
        help:'Le changement s’applique aux nouvelles dates ; les dates existantes gardent leur suivi.'},
      {k:'default_artbo_pct', label:"% L'ArtBo (15 ou 20)", type:'number'},
      {k:'default_partner_id', label:'Co-producteur par défaut', type:'select', options:S.db.partners.map(x=>[x.id,x.name])},
      {k:'default_partner_pct', label:'% partenaire sur la commission', type:'number'},
      {k:'drive_artist_folder_id', label:'Dossier Drive de l’artiste (lien ou identifiant)', full:true},
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    onDelete: id ? () => remove('projects', id) : null,
    onSave: async v => {
      if (!v.name) return false;
      if (v.drive_artist_folder_id) v.drive_artist_folder_id = driveId(v.drive_artist_folder_id);
      if (id) await save('projects', id, v, {rerender:false}); else await insert('projects', v);
    }
  });
}

/** Identifiant d'un dossier Drive à partir d'un lien collé */
export const driveId = s => { const m = String(s).match(/folders\/([\w-]{10,})/) || String(s).match(/[?&]id=([\w-]{10,})/); return m ? m[1] : String(s).trim(); };

/* ------------------------------------------------------------------ Tâches */
export function editTask(id, prefill={}){
  const t = id ? byId('tasks', id) : {status:'To Do', assigned_to: S.user.email, project_ids: S.project?[S.project]:[], ...prefill};
  const files = id ? attachmentsOf('task_id', id) : [];
  openModal({ title: id ? 'Tâche' : 'Nouvelle tâche', values: {...t, project_ids: projIds(t)},
    fields: [
      {k:'title', label:'Tâche', full:true},
      {k:'department', label:'Pôle', type:'select', options:deptNames().concat(t.department && !deptNames().includes(t.department) ? [t.department] : [])},
      {k:'assigned_to', label:'Pour', type:'select', options:team()},
      {k:'deadline', label:'Échéance', type:'date'}, {k:'status', label:'Statut', type:'select', options:TASK_STATUS, blank:false},
      {k:'project_ids', label:'Projet(s)', type:'checks', options:activeProjects(projIds(t)), full:true},
      {k:'structure_id', label:'Structure', type:'ac', kind:'structures', create:true},
      {k:'show_id', label:'Date concernée', type:'ac', kind:'shows', placeholder:'Artiste, lieu, ville ou date…'},
      {k:'priority', label:'Priorité (si pas d’échéance)', type:'select', options:PRIORITIES}, {k:'tags', label:'Tags (Call, Mail…)', type:'tags'},
      {k:'notes', label:'Notes', type:'textarea', full:true, rows:5},
      ...(files.length ? [{k:'_existing', type:'html', label:'Pièces jointes', full:true, html: files.map(f=>fileRow(f, 'openAttachment', 'delAttachment')).join('')}] : []),
      {k:'_files', label: files.length ? 'Ajouter des pièces jointes' : 'Pièces jointes', type:'files', full:true},
    ],
    onDelete: id ? async () => { await removeWhere('attachments', 'task_id', id); return remove('tasks', id); } : null,
    onSave: async v => {
      if (!v.title){ toast('Donne un nom à la tâche', true); return false; }
      const up = v._files || []; delete v._files; delete v._existing;
      v.project_id = v.project_ids[0] || null;
      let row = {id};
      if (id) await save('tasks', id, v, {rerender:false}); else row = await insert('tasks', v);
      if (row && up.length) await uploadFiles({task_id: row.id}, up);
    }
  });
}

/* ------------------------------------------------------------------ Contacts */
export function editContact(id, prefill={}){
  const c = id ? byId('contacts', id) : {...prefill};
  const links = id ? linksOfContact(id).map(s=>s.id) : (prefill._structures || []);
  return openModal({ title: id ? c.display_name : 'Nouveau contact', values: {...c, _structures: links},
    fields: [
      {k:'first_name', label:'Prénom'}, {k:'last_name', label:'Nom'},
      {k:'_structures', label:'Structures', type:'links', source:'structures', create:true, full:true},
      {k:'roles', label:'Poste(s)', type:'tags', full:true},
      {k:'email', label:'Mail', type:'email'}, {k:'email_2', label:'Mail 2', type:'email'},
      {k:'phone', label:'Téléphone'}, {k:'phone_2', label:'Téléphone 2'},
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    onDelete: id ? () => remove('contacts', id) : null,
    onSave: async v => {
      const ids = v._structures; delete v._structures;
      v.display_name = [v.first_name, v.last_name].filter(Boolean).join(' ') || c.display_name || v.email;
      if (!v.display_name){ toast('Indique au moins un nom', true); return false; }
      let row; if (id){ await save('contacts', id, v, {rerender:false}); row={id}; } else row = await insert('contacts', v);
      if (row) await syncLinks('contact', row.id, ids);
      return row;
    }
  });
}

/* ------------------------------------------------------------------ Structures */
const structFields = () => [
  {k:'name', label:'Nom', full:true},
  {k:'tags', label:'Type (Festival, SMAC, Salle, Association…)', type:'tags', full:true},
  {k:'address', label:'Adresse — tape une adresse ou une ville, les champs se remplissent', type:'place', full:true},
  {k:'postal_code', label:'Code postal'}, {k:'city', label:'Ville'},
  {k:'region', label:'Région'}, {k:'country', label:'Pays'},
];
const structHidden = s => hiddenFields(s, [['lat',1],['lng',1],['department_code'],['department_name']]);

async function locate(v, before={}){
  // coordonnées déjà fournies par le choix d'une adresse : rien à faire
  if (v.lat!=null && v.city===before.city && v.postal_code===before.postal_code && v.address===before.address && before.lat!=null) return;
  if (v.lat!=null && (v.city!==before.city || v.address!==before.address) && v.lat!==before.lat) return;
  if (!v.city && !v.postal_code && !v.address) return;
  const fr = !v.country || /^france$/i.test(v.country);
  const g = await geocode([v.address, v.postal_code, v.city].filter(Boolean).join(' '), {france:fr}) || (v.city ? await geocode(v.city, {france:fr}) : null);
  if (g){ v.lat=g.lat; v.lng=g.lng; if (g.department_code){ v.department_code=g.department_code; v.department_name=g.department_name; v.region = v.region || g.region; v.city = v.city || g.city; v.postal_code = v.postal_code || g.postcode; } }
}

export function editStructure(id){
  const s = id ? byId('structures', id) : {country:'France'};
  const links = id ? linksOfStructure(id).map(c=>c.id) : [];
  openModal({ title: id ? s.name : 'Nouvelle structure', values: {...s, _contacts: links}, extra: structHidden(s),
    fields: [...structFields(),
      {k:'capacity_1', label:'Jauge 1', type:'number'}, {k:'capacity_2', label:'Jauge 2', type:'number'},
      {k:'pricing', label:'Tarif', type:'select', options:['Payant','Gratuit','Prix Libre']}, {k:'website', label:'Site web'},
      {k:'_contacts', label:'Contacts', type:'links', source:'contacts', create:true, full:true},
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    onDelete: id ? () => remove('structures', id) : null,
    onSave: async v => {
      const ids = v._contacts; delete v._contacts;
      if (!v.name){ toast('Indique le nom de la structure', true); return false; }
      await locate(v, s);
      let row; if (id){ await save('structures', id, v, {rerender:false}); row={id}; } else row = await insert('structures', v);
      if (row) await syncLinks('structure', row.id, ids);
    }
  });
}

/** Création rapide d'une structure depuis un champ de recherche (fenêtre par-dessus le formulaire) */
CREATORS.structures = async name => {
  const row = await openModal({ level:2, title:'Nouvelle structure', values:{name, country:'France'}, extra: structHidden({}), fields: structFields(), saveLabel:'Créer la structure',
    onSave: async v => { if (!v.name){ toast('Indique le nom', true); return false; } await locate(v); return await insert('structures', v); } });
  if (!row) return null;
  toast(`Structure « ${row.name} » créée`);
  return {id: row.id, label: row.name};
};

CREATORS.contacts = async name => {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  const row = await openModal({ level:2, title:'Nouveau contact', values:{first_name:first, last_name:rest.join(' ')}, saveLabel:'Créer le contact',
    fields:[{k:'first_name', label:'Prénom'}, {k:'last_name', label:'Nom'}, {k:'email', label:'Mail', type:'email'}, {k:'phone', label:'Téléphone'}, {k:'roles', label:'Poste(s)', type:'tags', full:true}],
    onSave: async v => { v.display_name = [v.first_name, v.last_name].filter(Boolean).join(' ') || v.email; if (!v.display_name) return false; return await insert('contacts', v); } });
  if (!row) return null;
  return {id: row.id, label: row.display_name};
};

/* ------------------------------------------------------------------ Suivis */
export function editProspect(id){
  const p = id ? byId('prospects', id) : {status:'Mailed', project_ids: S.project && byId('projects',S.project)?.active ? [S.project] : [], name:'Suivi', structure_id:S.newSuiviStructure||null, last_contact: today()};
  openModal({ title: id ? prospectTitle(p) : 'Nouveau suivi', values: {...p, project_ids: projIds(p)},
    fields: [
      {k:'structure_id', label:'Structure — tape le nom, ou crée-la si elle n’existe pas', type:'ac', kind:'structures', create:true, full:true},
      {k:'project_ids', label:'Artiste(s) concerné(s)', type:'checks', options:activeProjects(projIds(p)), full:true},
      {k:'status', label:'Statut', type:'select', options:PROSPECT, blank:false},
      {k:'last_contact', label:'Dernier contact', type:'date'},
      ...(id ? [{k:'summary', label:'Résumé', type:'textarea', full:true}] : [
        {k:'_contact', label:'Interlocuteur (contact de la structure)', type:'ac', kind:'contacts', create:true, full:true},
        {k:'_note', label:'Notes de ce premier échange', type:'textarea', full:true, rows:5},
        {k:'_kind', label:'Type d’échange', type:'select', options:['Appel','Mail','RDV','Note'], blank:false},
        {k:'_files', label:'Pièces jointes (PDF de mails…)', type:'files', full:true}]),
    ],
    onDelete: id ? () => remove('prospects', id) : null,
    onSave: async v => {
      if (!v.structure_id){ toast('Choisis ou crée la structure', true); return false; }
      const files = v._files || [], note = v._note, contact = v._contact, kind = v._kind || 'Appel';
      ['_files','_note','_contact','_kind'].forEach(k => delete v[k]);
      v.project_id = v.project_ids[0] || null;
      v.name = p.name || 'Suivi';
      if (id){ await save('prospects', id, v, {rerender:false}); return; }
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
  openModal({ title: fixed ? `Exporter les suivis — ${fixed.name}` : 'Exporter les suivis (CSV)', saveLabel:'Télécharger le CSV',
    values:{project: projectId || S.project || '', statuses: PROSPECT.filter(x=>x!=='Closed')},
    fields:[
      ...(fixed ? [] : [{k:'project', label:'Projet', type:'project', full:true}]),
      {k:'statuses', label:'Statuts', type:'checks', options:PROSPECT.map(x=>[x,x]), full:true},
      {k:'from', label:'Dernier échange à partir du', type:'date'}, {k:'to', label:'jusqu’au', type:'date'},
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
      const rows = [['Projet','Structure','Ville','Prénom','Nom','Mail','Statut','Date du dernier échange']];
      for (const p of list){
        const st = byId('structures', p.structure_id), contacts = linksOfStructure(p.structure_id), last = lastExchange(p) || '';
        const lastFr = last ? last.split('-').reverse().join('/') : '';
        if (!contacts.length) rows.push([projName(pid), st?.name||p.name, st?.city||'', '', '', '', p.status, lastFr]);
        for (const c of contacts) rows.push([projName(pid), st?.name||p.name, st?.city||'', c.first_name||'', c.last_name || (c.first_name?'':c.display_name) || '', c.email||'', p.status, lastFr]);
      }
      downloadCSV(`suivis-${projName(pid).replace(/[^\w]+/g,'-')}-${today()}.csv`, rows);
      toast(`${rows.length-1} ligne(s) exportée(s)`);
    }
  });
}

/* ------------------------------------------------------------------ Événements d'une structure */
export function newEvent(structureId){
  const st = byId('structures', structureId);
  openModal({ title:'Nouveau festival / événement', values:{city: st?.city},
    fields:[{k:'name', label:'Nom du festival / de l’événement', full:true}, {k:'date_start', label:'Début', type:'date'}, {k:'date_end', label:'Fin', type:'date'},
      {k:'period', label:'Période habituelle', placeholder:'ex. 2e week-end de juillet'}, {k:'capacity', label:'Jauge', type:'number'},
      {k:'place', label:'Lieu'}, {k:'city', label:'Ville', type:'city'}, {k:'notes', label:'Notes', type:'textarea', full:true}],
    onSave: async v => { if (!v.name) return false; await insert('structure_events', {...v, structure_id: structureId}); }
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
  const v = prompt('Colle le lien du dossier Google Drive de cette date');
  if (!v) return;
  const id = driveId(v);
  if (!/^[\w-]{10,}$/.test(id)) return toast('Lien de dossier Drive non reconnu', true);
  await save('shows', showId, {drive_folder_id: id, drive_folder_error: null});
  toast('Dossier Drive lié');
}

export { touch, render };
