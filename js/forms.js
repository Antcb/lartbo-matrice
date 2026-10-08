/**
 * Formulaires de création / modification (date, projet, tâche, contact, structure, suivi).
 */
import { CFG } from './config.js';
import { CONFIRMED_PROD, CONTRACTS, DEPARTMENTS, PRIORITIES, PROSPECT, STATUSES, TASK_STATUS, TICKETING, stClass } from './constants.js';
import { insert, remove, save, syncLinks, uploadFiles } from './data.js';
import { fillCoords, geocode } from './geo.js';
import { byId, linksOfContact, linksOfStructure, optsOf, projIds, projName, prospectTitle } from './selectors.js';
import { S } from './state.js';
import { openModal } from './ui/modal.js';
import { esc, fmtDate, toast } from './utils.js';
import { driveHTML } from './views/production.js';

export function showFields(){
  return [
    {k:'venue', label:'Festival / Salle', full:true},
    {k:'project_id', label:'Projet', type:'select', options:optsOf('projects')},
    {k:'status', label:'Statut', type:'select', options:STATUSES, blank:false},
    {k:'date', label:'Date', type:'date'}, {k:'date_end', label:'Fin (si plusieurs jours)', type:'date'},
    {k:'structure_id', label:'Structure', type:'select', options:optsOf('structures')},
    {k:'city', label:'Ville'}, {k:'department', label:'Département / pays (ex. 75, CH)'},
    {k:'contract_type', label:'Type de contrat', type:'select', options:CONTRACTS},
    {k:'ticketing_type', label:'Billetterie', type:'select', options:TICKETING},
    {k:'fee_ht', label:'Cachet HT (€)', type:'number'}, {k:'request_date', label:'Date de la demande', type:'date'},
    {k:'capacity', label:'Jauge', type:'number'},
    {k:'ticketing_enabled', label:'Concernée par le ticketing', type:'checkbox'},
    {k:'communication_enabled', label:'Concernée par la communication', type:'checkbox'},
    {k:'notes', label:'Notes', type:'textarea', full:true},
  ];
}

export function editShow(id, projectId, prefill={}){
  const s = id ? byId('shows', id) : {status:'Intérêt Salle', project_id: projectId||null, communication_enabled:true, date:null, ...prefill};
  openModal({
    title: id ? s.venue : 'Nouvelle date', fields: showFields(), values: s,
    extra: (id && s.structure_id ? `<div class="full"><a href="#" data-act="openStructure" data-id="${s.structure_id}">Ouvrir la fiche structure et son suivi</a></div>` : '') + (id && s.status?.startsWith('Confirmée') ? `<div class="full drive">${driveHTML(s)}</div>` : ''),
    onDelete: id ? () => remove('shows', id) : null,
    onSave: async v => {
      if (!v.venue) { toast('Indique le nom du lieu', true); return false; }
      const st = byId('structures', v.structure_id);
      if (st){ v.city = v.city || st.city; }
      const changedPlace = !id || v.city!==s.city || v.structure_id!==s.structure_id;
      if (changedPlace){ v.lat=null; v.lng=null;
        if (st && st.lat!=null){ v.lat=st.lat; v.lng=st.lng; }
        else await fillCoords(v, [v.city, v.department && /^\d/.test(v.department) ? 'France' : ''].filter(Boolean).join(', '));
      }
      if (id) await save('shows', id, v, {rerender:false}); else await insert('shows', v);
      if (CONFIRMED_PROD.includes(v.status) && !CONFIRMED_PROD.includes(s.status)) toast('Date confirmée : lignes de facturation et dossier Drive créés');
    }
  });
}

export function editProject(id){
  const p = id ? byId('projects', id) : {active:true};
  openModal({ title: id ? p.name : 'Nouveau projet', values: p,
    fields: [
      {k:'name', label:'Nom', full:true}, {k:'active', label:'Projet actif', type:'checkbox'},
      {k:'default_partner_id', label:'Co-producteur par défaut', type:'select', options:optsOf('partners')},
      {k:'default_artbo_pct', label:"% L'ArtBo (15 ou 20)", type:'number'}, {k:'default_partner_pct', label:'% partenaire sur la commission', type:'number'},
      {k:'drive_artist_folder_id', label:'ID du dossier artiste dans Drive (trouvé automatiquement sinon)', full:true},
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    onDelete: id ? () => remove('projects', id) : null,
    onSave: async v => { if (!v.name) return false; if (id) await save('projects', id, v, {rerender:false}); else await insert('projects', v); }
  });
}

export function editTask(id, prefill={}){
  const t = id ? byId('tasks', id) : {status:'To Do', assigned_to: S.user.email, project_ids: S.project?[S.project]:[], ...prefill};
  const projOpts = S.db.projects.slice().sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name)).filter(x=>x.active || projIds(t).includes(x.id)).map(x=>[x.id,x.name]);
  const shows = S.db.shows.filter(s=>s.status!=='Annulée').sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(s=>[s.id, `${fmtDate(s.date)} — ${s.venue}`]);
  openModal({ title: id ? 'Tâche' : 'Nouvelle tâche', values: {...t, project_ids: projIds(t)},
    fields: [
      {k:'title', label:'Tâche', full:true},
      {k:'deadline', label:'Échéance', type:'date'}, {k:'status', label:'Statut', type:'select', options:TASK_STATUS, blank:false},
      {k:'assigned_to', label:'Pour', type:'select', options:CFG.TEAM.map(e=>[e,e.split('@')[0]])},
      {k:'priority', label:'Priorité (si pas d’échéance)', type:'select', options:PRIORITIES},
      {k:'project_ids', label:'Projet(s)', type:'checks', options:projOpts, full:true},
      {k:'structure_id', label:'Structure', type:'select', options:optsOf('structures')},
      {k:'show_id', label:'Date', type:'select', options:shows, full:true},
      {k:'department', label:'Pôle', type:'select', options:DEPARTMENTS}, {k:'tags', label:'Tags (Call, Mail…)', type:'tags'},
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    onDelete: id ? () => remove('tasks', id) : null,
    onSave: async v => { if (!v.title){ toast('Donne un nom à la tâche', true); return false; } v.project_id = v.project_ids[0] || null; if (id) await save('tasks', id, v, {rerender:false}); else await insert('tasks', v); }
  });
}

export function editContact(id){
  const c = id ? byId('contacts', id) : {};
  const links = id ? linksOfContact(id).map(s=>s.id) : [];
  openModal({ title: id ? c.display_name : 'Nouveau contact', values: {...c, _structures: links},
    fields: [
      {k:'first_name', label:'Prénom'}, {k:'last_name', label:'Nom'},
      {k:'_structures', label:'Structures', type:'links', source:'structures', labelKey:'name', full:true},
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
    }
  });
}

export function editStructure(id){
  const s = id ? byId('structures', id) : {country:'France'};
  const links = id ? linksOfStructure(id).map(c=>c.id) : [];
  const shows = id ? S.db.shows.filter(x=>x.structure_id===id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')) : [];
  openModal({ title: id ? s.name : 'Nouvelle structure', values: {...s, _contacts: links},
    fields: [
      {k:'name', label:'Nom', full:true},
      {k:'_contacts', label:'Contacts', type:'links', source:'contacts', labelKey:'display_name', full:true},
      {k:'tags', label:'Tags (Festival, SMAC, Salle…)', type:'tags', full:true},
      {k:'address', label:'Adresse', full:true},
      {k:'postal_code', label:'Code postal'}, {k:'city', label:'Ville'},
      {k:'region', label:'Région'}, {k:'country', label:'Pays'},
      {k:'capacity_1', label:'Jauge 1', type:'number'}, {k:'capacity_2', label:'Jauge 2', type:'number'},
      {k:'pricing', label:'Tarif', type:'select', options:['Payant','Gratuit','Prix Libre']}, {k:'website', label:'Site web'},
      {k:'notes', label:'Notes', type:'textarea', full:true},
    ],
    extra: shows.length ? `<div class="full"><label class="muted" style="font-size:12px;font-weight:600">Historique des dates</label>${shows.map(x=>`<div>${fmtDate(x.date)} — ${esc(projName(x.project_id))} <span class="st ${stClass(x.status)}">${esc(x.status)}</span></div>`).join('')}</div>` : '',
    onDelete: id ? () => remove('structures', id) : null,
    onSave: async v => {
      const ids = v._contacts; delete v._contacts;
      if (!v.name) return false;
      if (!id || v.address!==s.address || v.city!==s.city || v.postal_code!==s.postal_code){
        v.lat=null; v.lng=null;
        const fr = !v.country || /^france$/i.test(v.country);
        const g = (v.city||v.postal_code) ? await geocode([v.postal_code, v.city].filter(Boolean).join(' '), {france:fr}) : (v.address ? await geocode(v.address, {france:fr}) : null);
        if (g){ v.lat=g.lat; v.lng=g.lng; if (g.department_code){ v.department_code=g.department_code; v.department_name=g.department_name; v.region = v.region || g.region; v.city = v.city || g.city; v.postal_code = v.postal_code || g.postcode; } }
      }
      let row; if (id){ await save('structures', id, v, {rerender:false}); row={id}; } else row = await insert('structures', v);
      if (row) await syncLinks('structure', row.id, ids);
    }
  });
}

export function editProspect(id){
  const p = id ? byId('prospects', id) : {status:'Mailed', project_ids: S.project?[S.project]:[], name:'Suivi', structure_id:S.newSuiviStructure||null};
  const activeProjects = S.db.projects.slice().sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name)).filter(x=>x.active || projIds(p).includes(x.id)).map(x=>[x.id,x.name]);
  openModal({ title: id ? prospectTitle(p) : 'Nouveau suivi', values: {...p, project_ids: projIds(p)},
    fields: [
      {k:'structure_id', label:'Structure', type:'select', options:optsOf('structures'), full:true},
      {k:'project_ids', label:'Artiste(s) concerné(s)', type:'checks', options:activeProjects, full:true},
      {k:'status', label:'Statut', type:'select', options:PROSPECT, blank:false},
      {k:'last_contact', label:'Dernier contact', type:'date'},
      {k:'summary', label:'Résumé', type:'textarea', full:true},
      ...(id ? [] : [{k:'_files', label:'Pièces jointes (PDF de mails…)', type:'files', full:true}]),
    ],
    onDelete: id ? () => remove('prospects', id) : null,
    onSave: async v => {
      if (!v.structure_id){ toast('Choisis la structure', true); return false; }
      const files = v._files || []; delete v._files;
      v.project_id = v.project_ids[0] || null;
      v.name = p.name || 'Suivi';
      if (id){ await save('prospects', id, v, {rerender:false}); return; }
      const row = await insert('prospects', v);
      if (!row) return false;
      if (files.length) await uploadFiles(row.id, files);
      S.view='structures'; S.structurePage=row.structure_id; S.focusProspect=row.id;
    }
  });
}
