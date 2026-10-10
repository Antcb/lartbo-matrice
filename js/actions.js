/**
 * Toutes les actions déclenchées par un clic (boutons data-act="…"),
 * et les « crochets » d'enregistrement direct (clé 'change:table.champ').
 */
import { go, render } from './app.js';
import { paymentsOf } from './calc.js';
import { CONFIRMED_PROD, PAY_KINDS, isOff } from './constants.js';
import { insert, openStored, refreshShowSide, remove, removeWhere, save, saveLinger, sb } from './data.js';
import { editContact, editProject, editProspect, editShow, editStructure, editTask, exportSuivis, linkDrive, newEvent, projectPhoto, showPrefillFromStructure } from './forms.js';
import { departments, attachmentsOf, byId, filesOf, logsOf, projIds, projNames, setting, showsFiltered, structName } from './selectors.js';
import { S, touch } from './state.js';
import { MODALS, openModal } from './ui/modal.js';
import { applyAcompte, saveDepartments } from './views/settings.js';
import { hasLogDraft, setLogDraft } from './views/suivi.js';
import { $, fmtDate, toast, today } from './utils.js';

/** Nouveau suivi : créé tout de suite et ouvert dans l'espace de prospection (pas de fenêtre) */
async function newSuivi(structureId){
  await cleanupDraft();
  const pid = S.project && byId('projects', S.project)?.active ? S.project : null;
  const row = await insert('prospects', {name:'Suivi', status:'Mailed', last_contact: today(), structure_id: structureId || null, project_ids: pid ? [pid] : [], project_id: pid});
  if (!row) return;
  S.draftSuivi = row.id; S.view='prospects'; S.suiviPage=row.id; S.wsTarget=undefined; S.wsFor=null; S.wsProject=null;
  render(); window.scrollTo(0,0);
}
/** Un nouveau suivi laissé vide (sans structure ni échange) est supprimé quand on le quitte */
export async function cleanupDraft(){
  const id = S.draftSuivi; if (!id) return; S.draftSuivi = null;
  const p = byId('prospects', id); if (!p) return;
  if (!p.structure_id && !projIds(p).length && !logsOf(id).length && !filesOf(id).length && !p.summary && !p.content_md && !hasLogDraft(id)) await remove('prospects', id);
}

export const ACTIONS = {
  closeModal: t => (t.dataset.level==='2' ? $('#modal2') : $('#modal')).close(),
  modalDelete: async t => { const lvl = Number(t.dataset.level||1); if (confirm('Supprimer définitivement ?')){ await MODALS[lvl].onDelete(); MODALS[lvl].dlg.close(); render(); } },
  unlink: t => t.closest('.chip').remove(),
  subtab: t => { S.tab[t.dataset.key] = t.dataset.tab; render(); },
  fold: t => { const k = 'fold:'+t.dataset.key; S.tab[k] = t.getAttribute('aria-expanded')!=='true'; render(); },

  // En-tête
  toggleNotifs: () => { S.notifOpen = !S.notifOpen; S.userOpen = false; render(); },
  toggleUser: () => { S.userOpen = !S.userOpen; S.notifOpen = false; render(); },
  readAllNotifs: async () => { const me = S.user.email;
    for (const n of S.db.notifications.filter(n=>!(n.read_by||[]).includes(me))) await save('notifications', n.id, {read_by:[...(n.read_by||[]), me]}, {rerender:false});
    render(); },
  openNotif: async t => { const n = byId('notifications', t.dataset.id); const me = S.user.email;
    if (!(n.read_by||[]).includes(me)) await save('notifications', n.id, {read_by:[...(n.read_by||[]), me]}, {rerender:false});
    S.notifOpen = false;
    if (n.show_id){ const s = byId('shows', n.show_id); if (s){ S.view='production'; S.year = Number((s.date||'').slice(0,4)) || S.year; S.openProd.add(s.id); render(); document.getElementById('prod-'+s.id)?.scrollIntoView({block:'center'}); return; } }
    if (n.task_id){ S.view='todo'; render(); return; }
    render(); },

  // Booking
  toggleCancelled: () => { S.showCancelled=!S.showCancelled; render(); },
  pick: (t, e) => { e.stopPropagation(); const p=t.dataset.p; S.routePick[p] = S.routePick[p]===t.dataset.id ? null : t.dataset.id; render(); },
  clearPick: () => { S.routePick = {a:null, b:null}; render(); },
  bookingPane: t => { S.bookingPane = t.dataset.p; render(); },

  // Production
  toggleProd: t => { const id=t.dataset.id; S.openProd.has(id)?S.openProd.delete(id):S.openProd.add(id); render(); },
  expandAll: () => { const ids = showsFiltered().filter(s=>CONFIRMED_PROD.includes(s.status)).map(s=>s.id); if (ids.every(i=>S.openProd.has(i))) S.openProd.clear(); else ids.forEach(i=>S.openProd.add(i)); render(); },
  reloadShow: async t => { await refreshShowSide(t.dataset.id); render(); },
  retryDrive: async t => {
    const {error} = await sb.rpc('request_drive_folder', {p_show: t.dataset.id});
    if (error) return toast(error.message.includes('pas encore branchée') ? 'La création automatique des dossiers Drive n’est pas encore installée. En attendant, utilise « Lier un dossier ».' : error.message, true);
    toast('Création du dossier demandée'); setTimeout(async()=>{ await refreshShowSide(t.dataset.id); render(); }, 6000);
    await refreshShowSide(t.dataset.id); render();
  },
  linkDrive: t => linkDrive(t.dataset.id),
  addPay: async t => {
    const kind = t.dataset.kind, showId = t.dataset.id;
    const n = paymentsOf(showId).filter(p=>p.kind===kind).length;
    const sort = Math.max(0,...paymentsOf(showId).map(p=>p.sort||0)) + 1;
    await insert('show_payments', {show_id:showId, kind, label: PAY_KINDS[kind] + (n?` ${n+1}`:''), pct: kind==='cnm'?Number(setting('default_cnm_pct'))||null:null, sort});
    render();
  },
  delPay: async t => { if (confirm('Supprimer cette ligne de facturation ?') && await remove('show_payments', t.dataset.id)) render(); },

  // Tâches
  toggleTask: async t => {
    const done = t.checked;
    if (done) await saveLinger('tasks', t.dataset.id, {status:'Done', done_at:new Date().toISOString()}, 'Tâche terminée');
    else { S.linger.delete(t.dataset.id); await save('tasks', t.dataset.id, {status:'To Do', done_at:null}); }
  },
  todoFilter: t => { S.todoFilter=t.dataset.f; render(); },
  todoDept: t => { S.todoDept=t.dataset.f; render(); },
  toggleDoneTasks: () => { S.showDoneTasks = !S.showDoneTasks; render(); },
  newTask: () => editTask(null), editTask: t => editTask(t.dataset.id),
  newTaskFor: t => editTask(null, {structure_id: t.dataset.id}),
  newTaskProject: t => editTask(null, {project_ids:[t.dataset.id]}),
  openAttachment: t => { const f = byId('attachments', t.dataset.id); if (f) openStored(f.path); },
  delAttachment: async t => { const f = byId('attachments', t.dataset.id); if (!f || !confirm(`Supprimer « ${f.name} » ?`)) return;
    await sb.storage.from('suivi').remove([f.path]); if (await remove('attachments', f.id)){ t.closest('.file-row')?.remove(); render(); } },

  // Dates
  newShow: t => editShow(null, t.dataset.project || S.project),
  newShowFor: t => editShow(null, S.project, showPrefillFromStructure(byId('structures', t.dataset.id))),
  editShow: (t, e) => { if (e.target.closest('.pick')) return; editShow(t.dataset.id); },

  // Projets
  newProject: () => editProject(null), editProject: t => editProject(t.dataset.id),
  openProject: t => { S.projectPage=t.dataset.id; S.tab.project='overview'; render(); window.scrollTo(0,0); },
  closeProject: () => { S.projectPage=null; render(); },
  projectPhoto: t => projectPhoto(t.dataset.id),
  addLink: async t => { const p = byId('projects', t.dataset.id), f = t.dataset.field; await save('projects', p.id, {[f]: [...(p[f]||[]), {label:'', url:''}]}); },
  rmLink: async t => { const p = byId('projects', t.dataset.id), f = t.dataset.field; const list = (p[f]||[]).slice(); list.splice(Number(t.dataset.i), 1); await save('projects', p.id, {[f]: list}); },
  delProjLog: async t => { if (!confirm('Supprimer cet échange et ses fichiers ?')) return;
    const files = attachmentsOf('project_log_id', t.dataset.id); if (files.length){ await sb.storage.from('suivi').remove(files.map(f=>f.path)); await removeWhere('attachments', 'project_log_id', t.dataset.id); }
    if (await remove('project_logs', t.dataset.id)) render(); },
  addMember: async t => { await insert('project_members', {project_id:t.dataset.id, sort:999}); render(); },
  memberCard: t => { const m = byId('project_members', t.dataset.id); const keys = Object.keys(m.data||{});
    openModal({ title: [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Membre', values:{...m, ...Object.fromEntries(keys.map((k,i)=>['_d'+i, m.data[k]]))},
      fields:[{k:'first_name', label:'Prénom'}, {k:'last_name', label:'Nom'}, {k:'role', label:'Poste'}, {k:'email', label:'Mail', type:'email'}, {k:'phone', label:'Téléphone'},
        {k:'birth_date', label:'Date de naissance', type:'date'}, {k:'address', label:'Adresse', type:'fulladdr', full:true},
        ...(keys.length ? [{k:'_sep', type:'html', cls:'sep', html:'<h3>Autres informations (import Movinmotion)</h3>'}] : []),
        ...keys.map((k,i)=>({k:'_d'+i, label:k}))],
      onDelete: async () => remove('project_members', m.id),
      onSave: async v => { const data = {}; keys.forEach((k,i) => { if (v['_d'+i]) data[k] = v['_d'+i]; delete v['_d'+i]; }); delete v._sep;
        await save('project_members', m.id, {...v, data}, {rerender:false}); } }); },
  delMember: async t => { if (confirm('Supprimer ce membre ?') && await remove('project_members', t.dataset.id)) render(); },

  // Contacts & structures
  newContact: () => editContact(null), editContact: t => editContact(t.dataset.id),
  newContactFor: t => editContact(null, {_structures:[t.dataset.id]}),
  newStructure: () => editStructure(null), editStructure: t => editStructure(t.dataset.id),
  openStructure: t => { if ($('#modal').open) $('#modal').close(); S.view='structures'; S.structurePage=t.dataset.id; S.tab.structure = S.tab.structure && S.structurePage===t.dataset.id ? S.tab.structure : 'home'; S.focusProspect=null; render(); window.scrollTo(0,0); },
  closeStructure: () => { S.structurePage=null; render(); },
  clearNear: () => { S.near = null; render(); },
  newEvent: t => newEvent(t.dataset.id),
  delEvent: async t => { if (confirm('Supprimer cet événement ?') && await remove('structure_events', t.dataset.id)) render(); },
  adminFromStructure: async t => { const st = byId('structures', t.dataset.id);
    await save('structures', st.id, {admin: {...(st.admin||{}), address: st.address||'', postal_code: st.postal_code||'', city: st.city||'', country: st.country||''}}); },

  // Suivis
  newProspect: () => newSuivi(null), editProspect: t => editProspect(t.dataset.id),
  newSuiviFor: t => newSuivi(t.dataset.id),
  openSuivi: async t => { await cleanupDraft(); S.view='prospects'; S.suiviPage=t.dataset.id; S.wsTarget=undefined; S.wsFor=null; S.wsProject=null; render(); window.scrollTo(0,0); },
  closeSuivi: async () => { await cleanupDraft(); S.suiviPage=null; render(); },
  wsSetTarget: t => { S.wsTarget = t.dataset.d; render(); },
  toggleClosed: () => { S.showClosed = !S.showClosed; render(); },
  exportSuivis: t => exportSuivis(t.dataset.project),
  wsProject: t => { S.wsProject = t.dataset.id; render(); },
  wsClear: () => { S.wsTarget = null; render(); },
  wsShow: t => { const p = byId('prospects', t.dataset.id), st = byId('structures', p.structure_id);
    const fest = (st?.tags||[]).some(x=>/festival/i.test(x));
    editShow(null, S.wsProject && projIds(p).includes(S.wsProject) ? S.wsProject : projIds(p)[0], {...showPrefillFromStructure(st), date:S.wsTarget||null, status: fest?'Option Festival':'Option Salle', prospect_id: p.id}); },
  wsTask: t => { const p = byId('prospects', t.dataset.id); editTask(null, {structure_id:p.structure_id, project_ids:projIds(p)}); },
  rmProj: async (t, e) => { e.stopPropagation(); const tb = t.dataset.t || 'prospects', r = byId(tb, t.dataset.id); const ids = projIds(r).filter(x=>x!==t.dataset.p);
    await save(tb, r.id, {project_ids: ids, project_id: ids[0]||null}); },
  delProspect: async t => { if (!confirm('Supprimer ce suivi, son journal et ses fichiers ?')) return;
    const fs=filesOf(t.dataset.id).filter(f=>f.mime!=='link').map(f=>f.path); if (fs.length) await sb.storage.from('suivi').remove(fs);
    if (await remove('prospects', t.dataset.id)){ S.db.prospect_logs=S.db.prospect_logs.filter(l=>l.prospect_id!==t.dataset.id); S.db.prospect_files=S.db.prospect_files.filter(f=>f.prospect_id!==t.dataset.id); touch('prospect_logs'); touch('prospect_files'); if (S.suiviPage===t.dataset.id) S.suiviPage=null; render(); } },
  aiSummary: async t => {
    const id = t.dataset.id; t.disabled = true; t.textContent = 'Rédaction en cours…';
    const {data, error} = await sb.functions.invoke('resume-suivi', {body:{prospect_id:id}});
    let msg = error ? (await error.context?.json?.().catch(()=>null))?.error || error.message : data?.error;
    if (msg){ t.disabled=false; t.textContent="Mettre à jour avec l'IA"; return toast(msg, true); }
    byId('prospects', id).summary = data.summary; render(); toast('Résumé mis à jour');
  },
  copyForAi: async t => {
    const p = byId('prospects', t.dataset.id);
    const logs = logsOf(p.id).slice().reverse().map(l=>`[${l.date?fmtDate(l.date):'sans date'}] ${l.kind}${l.contact_name?' — '+l.contact_name:''}\n${l.body||''}`).join('\n\n');
    const today = new Date().toLocaleDateString('fr-FR');
    const txt = `Mets à jour le résumé de ce suivi de booking (L'ArtBoristerie). 6 à 8 puces max, dans cet ordre : **Contexte / interlocuteurs**, **Date(s) visée(s) / option(s)**, **Jauge + billetterie**, **Offre financière** (HT/TTC), **Accueil / VHR / technique**, **Statut actuel**, **Prochaine action + date de relance**. Une puce par ligne commençant par « - », libellés en gras. Termine par « Dernière mise à jour : ${today} ». N'invente rien. Réponds uniquement avec le résumé.

Structure : ${structName(p.structure_id)}
Artiste(s) : ${projNames(p)}
Statut : ${p.status||''}

Résumé existant :
${p.summary||'(aucun)'}

Journal des échanges :
${logs||'(vide)'}

Notes libres :
${p.content_md||'(aucune)'}`;
    try { await navigator.clipboard.writeText(txt); toast('Copié. Colle-le dans ChatGPT, puis colle la réponse avec « Modifier »'); }
    catch(e){ openModal({title:'Copier pour ChatGPT', values:{t:txt}, fields:[{k:'t', label:'Sélectionne tout et copie', type:'textarea', full:true}], onSave: async()=>{} }); }
  },
  clearLogDraft: t => { if (confirm('Effacer le brouillon de notes ?')){ setLogDraft(t.dataset.id, {}); render(); } },
  editLog: t => { const l = byId('prospect_logs', t.dataset.id);
    openModal({ title: `Échange du ${l.date ? fmtDate(l.date) : '—'}`, values: l,
      fields:[{k:'kind', label:'Type', type:'select', options:['Appel','Mail','RDV','Note'], blank:false}, {k:'contact_name', label:'Interlocuteur'},
        {k:'body', label:'Notes', type:'textarea', full:true, rows:10}],
      onSave: async v => { await save('prospect_logs', l.id, v, {rerender:false}); } }); },
  delLog: async t => { if (confirm('Supprimer cette entrée du journal ?') && await remove('prospect_logs', t.dataset.id)) render(); },
  editText: t => { const p=byId('prospects',t.dataset.id), f=t.dataset.f;
    openModal({ title: f==='summary'?'Résumé':'Autres notes', values:p, fields:[{k:f, label:f==='summary'?'Résumé (une ligne par point, « - » pour une puce, **gras**)':'Notes', type:'textarea', full:true, rows:14}],
      onSave: async v => { await save('prospects', p.id, v, {rerender:false}); } }); },
  openFile: async t => { const f=byId('prospect_files',t.dataset.id); if (!f) return;
    if (f.mime==='link') return window.open(f.path,'_blank');
    openStored(f.path); },
  delFile: async t => { const f=byId('prospect_files',t.dataset.id); if (!f || !confirm(`Supprimer « ${f.name} » ?`)) return;
    if (f.mime!=='link') await sb.storage.from('suivi').remove([f.path]);
    if (await remove('prospect_files', f.id)) render(); },

  // Réglages
  applyAcompte: () => applyAcompte(),
  addDept: async () => { const n = prompt('Nom du nouveau pôle'); if (!n) return; await saveDepartments([...departments(), {name:n.trim(), color:'#5B677D'}]); render(); },
  rmDept: async t => { const list = departments().slice(); const d = list[Number(t.dataset.i)];
    if (!confirm(`Supprimer le pôle « ${d.name} » ? Les tâches concernées n’auront plus de pôle.`)) return;
    list.splice(Number(t.dataset.i), 1); await saveDepartments(list); render(); },
  newPartner: async () => { const n = prompt('Nom du partenaire'); if (n && await insert('partners',{name:n})) render(); },
  changePw: async () => {
    S.userOpen = false;
    const pw = prompt('Nouveau mot de passe (8 caractères minimum)');
    if (!pw) return render();
    if (pw.length < 8) return toast('Le mot de passe doit faire au moins 8 caractères', true);
    const {error} = await sb.auth.updateUser({password: pw});
    toast(error ? 'Changement impossible : '+error.message : 'Mot de passe changé', !!error);
    render();
  },
};

// --- Crochets d'enregistrement direct -----------------------------------------------------
// Suivi clos : reste visible 5 s avec « Annuler »
ACTIONS['change:prospects.status'] = async (t, v) => {
  if (v === 'Closed') return saveLinger('prospects', t.dataset.id, {status:v}, 'Suivi clos');
  await save('prospects', t.dataset.id, {status:v});
};
// Date retirée du ticketing / de la communication : reste visible 5 s
for (const f of ['ticketing_enabled','communication_enabled'])
  ACTIONS['change:shows.'+f] = async (t, v) => v ? save('shows', t.dataset.id, {[f]:true}) : saveLinger('shows', t.dataset.id, {[f]:false}, f==='ticketing_enabled' ? 'Date retirée du ticketing' : 'Date retirée de la communication');
// Date annulée / sans suite : reste visible 5 s
ACTIONS['change:shows.status'] = async (t, v) => isOff(v) ? saveLinger('shows', t.dataset.id, {status:v}, `Date passée en « ${v} »`) : save('shows', t.dataset.id, {status:v});

export { go };

// Acompte modifié → le solde se recalcule (100 % − total des acomptes)
ACTIONS['change:show_payments.pct'] = async (t, v) => {
  const pay = byId('show_payments', t.dataset.id);
  await save('show_payments', pay.id, {pct: v}, {rerender:false});
  if (pay.kind === 'acompte'){
    const all = paymentsOf(pay.show_id), sum = all.filter(p => p.kind==='acompte').reduce((a,p) => a + (Number(p.pct)||0), 0);
    const solde = all.find(p => p.kind==='solde' && p.amount==null);
    if (solde) await save('show_payments', solde.id, {pct: Math.max(0, Math.round((100 - sum)*100)/100)}, {rerender:false});
  }
  render();
};
