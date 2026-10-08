/**
 * Toutes les actions déclenchées par un clic (boutons data-act="…").
 */
import { render } from './app.js';
import { paymentsOf } from './calc.js';
import { CONFIRMED_PROD, PAY_KINDS } from './constants.js';
import { insert, refreshShowSide, remove, save, sb } from './data.js';
import { editContact, editProject, editProspect, editShow, editStructure, editTask } from './forms.js';
import { byId, filesOf, logsOf, projIds, projNames, setting, showsFiltered, structName } from './selectors.js';
import { S } from './state.js';
import { MODAL, openModal } from './ui/modal.js';
import { $, fmtDate, toast } from './utils.js';

export const ACTIONS = {
  closeModal: () => $('#modal').close(),
  modalDelete: async () => { if (confirm('Supprimer définitivement ?')){ await MODAL.onDelete(); $('#modal').close(); render(); } },
  unlink: t => t.closest('.chip').remove(),
  toggleCancelled: () => { S.showCancelled=!S.showCancelled; render(); },
  pick: (t, e) => { e.stopPropagation(); const p=t.dataset.p; S.routePick[p] = S.routePick[p]===t.dataset.id ? null : t.dataset.id; render(); },
  toggleProd: t => { const id=t.dataset.id; S.openProd.has(id)?S.openProd.delete(id):S.openProd.add(id); render(); },
  expandAll: () => { const ids = showsFiltered().filter(s=>CONFIRMED_PROD.includes(s.status)).map(s=>s.id); if (ids.every(i=>S.openProd.has(i))) S.openProd.clear(); else ids.forEach(i=>S.openProd.add(i)); render(); },
  todoFilter: t => { S.todoFilter=t.dataset.f; render(); },
  openProject: t => { S.projectPage=t.dataset.id; render(); window.scrollTo(0,0); },
  closeProject: () => { S.projectPage=null; render(); },
  reloadShow: async t => { await refreshShowSide(t.dataset.id); render(); },
  retryDrive: async t => {
    const {error} = await sb.rpc('request_drive_folder', {p_show: t.dataset.id});
    if (error) return toast(error.message, true);
    toast('Création du dossier demandée'); setTimeout(async()=>{ await refreshShowSide(t.dataset.id); render(); }, 6000);
    await refreshShowSide(t.dataset.id); render();
  },
  addPay: async t => {
    const kind = t.dataset.kind, showId = t.dataset.id;
    const n = paymentsOf(showId).filter(p=>p.kind===kind).length;
    const sort = Math.max(0,...paymentsOf(showId).map(p=>p.sort||0)) + 1;
    const sh = byId('shows', showId), pn = kind==='partner' && byId('partners', sh?.partner_id)?.name;
    await insert('show_payments', {show_id:showId, kind, label: (pn ? 'Commission '+pn : PAY_KINDS[kind]) + (n?` ${n+1}`:''), pct: kind==='cnm'?Number(setting('default_cnm_pct'))||null:null, sort});
    render();
  },
  delPay: async t => { if (confirm('Supprimer cette ligne ?') && await remove('show_payments', t.dataset.id)) render(); },
  toggleTask: async t => { await save('tasks', t.dataset.id, {status: t.checked?'Done':'To Do', done_at: t.checked?new Date().toISOString():null}); },

  newShow: t => editShow(null, t.dataset.project || S.project),
  newShowFor: t => { const st = byId('structures', t.dataset.id); editShow(null, S.project, {structure_id: st.id, venue: st.name, city: st.city}); },
  newTaskFor: t => editTask(null, {structure_id: t.dataset.id}),
  bookingPane: t => { S.bookingPane = t.dataset.p; render(); },
  editShow: (t, e) => { if (e.target.closest('.pick')) return; editShow(t.dataset.id); },
  newProject: () => editProject(null), editProject: t => editProject(t.dataset.id),
  newTask: () => editTask(null), editTask: t => editTask(t.dataset.id),
  newContact: () => editContact(null), editContact: t => editContact(t.dataset.id),
  newStructure: () => editStructure(null), editStructure: t => editStructure(t.dataset.id),
  newProspect: () => { S.newSuiviStructure=null; editProspect(null); }, editProspect: t => editProspect(t.dataset.id),
  newSuiviFor: t => { S.newSuiviStructure=t.dataset.id; editProspect(null); },
  rmProj: async (t, e) => { e.stopPropagation(); const tb = t.dataset.t || 'prospects', r = byId(tb, t.dataset.id); const ids = projIds(r).filter(x=>x!==t.dataset.p);
    if (tb==='prospects') S.focusProspect = r.id;
    await save(tb, r.id, {project_ids: ids, project_id: ids[0]||null}); },
  toggleDoneTasks: () => { S.showDoneTasks = !S.showDoneTasks; render(); },
  toggleClosed: () => { S.showClosed = !S.showClosed; render(); },
  clearNear: () => { S.near = null; render(); },
  suiviStatus: t => { S.suiviStatus=t.dataset.f; render(); },
  openStructure: t => { if ($('#modal').open) $('#modal').close(); S.view='structures'; S.structurePage=t.dataset.id; S.focusProspect=null; render(); window.scrollTo(0,0); },
  closeStructure: () => { S.structurePage=null; render(); },
  openSuivi: t => { const p=byId('prospects',t.dataset.id); if (!p?.structure_id) return editProspect(t.dataset.id); S.view='structures'; S.structurePage=p.structure_id; S.focusProspect=p.id; render(); },
  delProspect: async t => { if (confirm('Supprimer ce suivi, son journal et ses fichiers ?')){ const fs=filesOf(t.dataset.id).filter(f=>f.mime!=='link').map(f=>f.path); if (fs.length) await sb.storage.from('suivi').remove(fs); if (await remove('prospects', t.dataset.id)){ S.db.prospect_logs=S.db.prospect_logs.filter(l=>l.prospect_id!==t.dataset.id); S.db.prospect_files=S.db.prospect_files.filter(f=>f.prospect_id!==t.dataset.id); render(); } } },
  aiSummary: async t => {
    const id = t.dataset.id; t.disabled = true; t.textContent = '✨ Rédaction en cours…';
    const {data, error} = await sb.functions.invoke('resume-suivi', {body:{prospect_id:id}});
    let msg = error ? (await error.context?.json?.().catch(()=>null))?.error || error.message : data?.error;
    if (msg){ t.disabled=false; t.textContent="✨ Mettre à jour avec l'IA"; return toast(msg, true); }
    byId('prospects', id).summary = data.summary; S.focusProspect = id; render(); toast('Résumé mis à jour');
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
  delLog: async t => { if (confirm('Supprimer cette entrée du journal ?') && await remove('prospect_logs', t.dataset.id)) render(); },
  editText: t => { const p=byId('prospects',t.dataset.id), f=t.dataset.f;
    openModal({ title: f==='summary'?'Résumé':'Autres notes', values:p, fields:[{k:f, label:f==='summary'?'Résumé (une ligne par point, « - » pour une puce, **gras**)':'Notes', type:'textarea', full:true}],
      onSave: async v => { await save('prospects', p.id, v, {rerender:false}); } });
    setTimeout(()=>{ const ta=$('#fld-'+f); if(ta) ta.style.minHeight='300px'; }, 0); },
  openFile: async (t) => { const f=byId('prospect_files',t.dataset.id); if (!f) return;
    if (f.mime==='link') return window.open(f.path,'_blank');
    const w = window.open('', '_blank');
    const {data, error} = await sb.storage.from('suivi').createSignedUrl(f.path, 3600);
    if (error){ if (w) w.close(); return toast('Ouverture impossible : '+error.message, true); }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl; },
  delFile: async t => { const f=byId('prospect_files',t.dataset.id); if (!f || !confirm(`Supprimer « ${f.name} » ?`)) return;
    if (f.mime!=='link') await sb.storage.from('suivi').remove([f.path]);
    if (await remove('prospect_files', f.id)) render(); },
  newPartner: async () => { const n = prompt('Nom du partenaire'); if (n && await insert('partners',{name:n})) render(); },
};

ACTIONS.changePw = async () => {
  const pw = prompt('Nouveau mot de passe (8 caractères minimum)');
  if (!pw) return;
  if (pw.length < 8) return toast('Le mot de passe doit faire au moins 8 caractères', true);
  const {error} = await sb.auth.updateUser({password: pw});
  toast(error ? 'Changement impossible : '+error.message : 'Mot de passe changé', !!error);
};
