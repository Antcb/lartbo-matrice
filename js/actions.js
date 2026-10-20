/**
 * Toutes les actions déclenchées par un clic (boutons data-act="…"),
 * et les « crochets » d'enregistrement direct (clé 'change:table.champ').
 */
import { askConfirmation, becameConfirmed, sendConfirmation, validateTerms } from './confirm-flow.js';
import { go, render } from './app.js';
import { BILL_KINDS, billPct, paymentsOf, payVat } from './calc.js';
import { CONFIRMED_PROD, PAY_KINDS, isOff } from './constants.js';
import { insert, openStored, refreshShowSide, remove, removeWhere, save, saveLinger, sb } from './data.js';
import { createArtistFolder, editContact, editProject, editProspect, editShow, editStructure, editTask, exportSuivis, linkDrive, newEvent, projectPhoto, showPrefillFromStructure } from './forms.js';
import { departments, attachmentsOf, byId, filesOf, logsOf, projIds, projNames, setting, showsFiltered, structName } from './selectors.js';
import { CFG } from './config.js';
import { propagateCommission } from './commission.js';
import { S, localSet, setProjects, touch } from './state.js';
import { MODALS, openModal } from './ui/modal.js';
import { modalSaved } from './ui/drafts.js';
import { applyAcompte, saveDepartments } from './views/settings.js';
import { hasLogDraft, setLogDraft } from './views/suivi.js';
import { $, esc, fmtDate, safeHtml, toast, today } from './utils.js';
import { rtStyle, rtToolbar } from './ui/richtext.js';
import { callScript, editTemplate, prepareMail } from './mail.js';
import { exportContractPdf, generateContract, validateFiche } from './contract.js';
import { exportShows } from './exports.js';
import { callProspect, cancelAutoRelances, closeNoAnswer, markLogSent, openProspection, restoreRelances } from './prospection.js';
import { EMP_ACTIONS, editEmployee } from './views/employees.js';
import { BUDGET_ACTIONS } from './budget-actions.js';

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
  ...EMP_ACTIONS,
  ...BUDGET_ACTIONS,
  employeeCard: t => editEmployee(t.dataset.id),
  closeModal: t => (t.dataset.level==='2' ? $('#modal2') : $('#modal')).close(),
  modalDelete: async t => { const lvl = Number(t.dataset.level||1); if (confirm('Supprimer définitivement ?')){ await MODALS[lvl].onDelete(); modalSaved(MODALS[lvl].dlg); MODALS[lvl].dlg.close(); render(); } },
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
  resetTodoFilters: () => { S.todoWho = ''; localSet('todoWho', ''); S.todoDept = ''; S.search.todo = ''; setProjects([]); render(); },
  toggleInactive: () => { S.showInactive = !S.showInactive; localSet('showInactive', S.showInactive ? '1' : ''); render(); },
  pick: (t, e) => { e.stopPropagation(); const p=t.dataset.p; S.routePick[p] = S.routePick[p]===t.dataset.id ? null : t.dataset.id; render(); },
  clearPick: () => { S.routePick = {a:null, b:null}; render(); },
  bookingPane: t => { S.bookingPane = t.dataset.p; render(); },
  toggleMapStatus: t => { const st = t.dataset.st; S.mapHidden.has(st) ? S.mapHidden.delete(st) : S.mapHidden.add(st); localSet('mapHidden', JSON.stringify([...S.mapHidden])); render(); },
  showAllMapStatus: () => { S.mapHidden.clear(); localSet('mapHidden', '[]'); render(); },
  exportShows: () => exportShows(),

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
  // Mails et fiche de renseignements
  prepareMail: (t, e) => { e?.stopPropagation(); S.notifOpen = false; t.dataset.kind === 'confirmation' ? sendConfirmation(t.dataset.id) : prepareMail(t.dataset.id, t.dataset.kind); },
  validateTerms: (t, e) => { e?.stopPropagation(); validateTerms(t.dataset.id); },
  editTemplate: t => editTemplate(t.dataset.id),
  newTemplate: t => editTemplate(null, {...(t.dataset.project ? {project_id: t.dataset.project, project_ids: [t.dataset.project]} : {}), ...(t.dataset.kind ? {kind: t.dataset.kind} : {})}),
  copyFiche: async t => { const s = byId('shows', t.dataset.id);
    const link = (setting('site_url') || location.origin + location.pathname.replace(/[^/]*$/, '')) + 'fiche.html?t=' + s.fiche_token;
    try { await navigator.clipboard.writeText(link); toast('Lien de la fiche copié'); } catch { prompt('Lien de la fiche :', link); } },
  copyArtistLink: async t => { const p = byId('projects', t.dataset.id); if (!p?.artist_token) return toast('Lien pas encore prêt : recharge la page', true);
    const {artistLink} = await import('./views/projects.js'); const link = artistLink(p);
    try { await navigator.clipboard.writeText(link); toast('Lien de la fiche artiste copié'); } catch { prompt('Lien de la fiche artiste :', link); } },
  validateFiche: t => validateFiche(t.dataset.id),
  genContract: t => generateContract(t.dataset.id),
  contractPdf: t => exportContractPdf(t.dataset.id),
  renameAudit: async t => { t.disabled = true;
    // fenêtre ouverte tout de suite (sinon le navigateur bloque l'ouverture après l'attente)
    const win = window.open('', '_blank'); if (win) win.document.write('<p style="font:16px system-ui;padding:24px">Vérification des noms dans le Drive… (1 à 3 min)</p>');
    toast('Vérification des noms dans le Drive… (1 à 3 min)');
    try { const out = await callScript('rename_audit', {});
      const st = S.db.settings.find(x => x.key === 'rename_sheet_url'); if (st) st.value = out.url; else S.db.settings.push({key:'rename_sheet_url', value: out.url}); touch('settings');
      if (win) win.location.href = out.url; else window.open(out.url, '_blank');
      toast(`${out.count} ligne(s) à vérifier dans le tableau`); render(); }
    catch (err) { if (win) win.close(); toast(err.message, true); } t.disabled = false; },
  renameApply: async t => { if (!confirm('Renommer dans le Drive tous les éléments cochés du tableau ?')) return; t.disabled = true;
    try { const out = await callScript('rename_apply', {}); toast(`${out.renamed} élément(s) renommé(s)`); } catch (err) { toast(err.message, true); } t.disabled = false; },
  prospection: t => openProspection(t.dataset.id),
  relance: t => openProspection(null, {prospectId: t.dataset.id}),
  copyProspectScript: async () => {
    try {
      const code = (await (await fetch('apps-script/Prospection.gs?v=' + Date.now())).text()).replace('__SECRET__', setting('drive_webhook_secret') || '');
      await navigator.clipboard.writeText(code); toast('Code du script copié : colle-le dans le nouveau projet Apps Script');
    } catch (err) { toast('Copie impossible : ' + err.message, true); }
  },
  copyMainScript: async () => {
    try { await navigator.clipboard.writeText(await (await fetch('apps-script/Code.gs?v=' + Date.now())).text()); toast('Code.gs copié : colle-le à la place de tout le contenu de Code.gs dans le script de production@, puis redéploie'); }
    catch (err) { toast('Copie impossible : ' + err.message, true); }
  },
  testMainScript: async () => { try { const out = await callScript('ping', {}); toast(`Script Google OK (${out.account || 'compte Google'})`); } catch (err) { toast(err.message, true); } },
  testProspectScript: async () => { try { const out = await callProspect('ping', {}); toast(`Script de prospection OK (${out.account || 'compte Google'})`); } catch (err) { toast(err.message, true); } },
  saveSignature: async t => { const key = t.dataset.key || 'prospect_signature', el = $('#' + (t.dataset.el || 'set-sig')); if (!el) return;
    const {error} = await sb.from('settings').upsert({key, value: el.innerHTML});
    if (error) return toast(error.message, true);
    const r = S.db.settings.find(x => x.key === key); if (r) r.value = el.innerHTML; else S.db.settings.push({key, value: el.innerHTML});
    toast('Signature enregistrée'); },
  brevoSyncAll: async () => {
    const n = S.db.contacts.reduce((n, c) => n + new Set([c.email, c.email_2].filter(e => /@/.test(e || '')).map(e => e.trim().toLowerCase())).size, 0);
    if (!confirm(`Envoyer dans Brevo les contacts de la Matrice (${n} avec un mail) ? Seuls ceux qui ne sont pas encore dans Brevo sont ajoutés : les autres (et les désabonnés) ne sont pas touchés.`)) return;
    toast('Envoi à Brevo…');
    try {
      const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/brevo-sync`, {method:'POST', headers:{'Content-Type':'application/json', 'x-hook-secret': setting('brevo_hook_secret') || ''}, body: JSON.stringify({all:true})});
      const out = await r.json();
      if (!out.ok) throw new Error(out.error || 'Erreur Brevo');
      toast(out.count ? `${out.count} nouveaux contacts envoyés : Brevo les importe (quelques minutes)` : 'Tous les contacts sont déjà dans Brevo');
    } catch (err) { toast(err.message, true); }
  },
  copySecret: async () => { try { await navigator.clipboard.writeText(setting('drive_webhook_secret')||''); toast('Code secret copié'); } catch { prompt('Code secret :', setting('drive_webhook_secret')||''); } },
  testScript: async () => { try { const out = await callScript('ping', {}); toast(`Script OK (${out.account||'compte Google'})`); } catch (err) { toast(err.message, true); } },
  driveScan: async t => { t.disabled = true; toast('Recherche des dossiers dans le Drive… (jusqu’à 1 min)');
    try { const out = await callScript('link_folders', {}); toast(`${out.linked} dossier${out.linked>1?'s':''} rattaché${out.linked>1?'s':''}`); const {loadAll} = await import('./data.js'); await loadAll(); render(); }
    catch (err) { toast(err.message, true); } t.disabled = false; },
  finderPath: async t => { const s = byId('shows', t.dataset.id);
    try { const out = await callScript('folder_path', {folder_id: s.drive_folder_id});
      const root = (setting('drive_mac_root') || '').replace(/\/+$/, '');
      const path = root ? root + '/' + out.path : out.path;
      await navigator.clipboard.writeText(path); toast(root ? 'Chemin Finder copié (Finder › Aller › Aller au dossier…)' : 'Chemin copié. Indique le dossier Google Drive du Mac dans les Réglages pour un chemin complet.'); }
    catch (err) { toast(err.message, true); } },
  addPay: async t => {
    const kind = t.dataset.kind, showId = t.dataset.id;
    const n = paymentsOf(showId).filter(p=>p.kind===kind).length;
    const sort = Math.max(0,...paymentsOf(showId).map(p=>p.sort||0)) + 1;
    await insert('show_payments', {show_id:showId, kind, label: PAY_KINDS[kind] + (n?` ${n+1}`:''), pct: kind==='cnm'?Number(setting('default_cnm_pct'))||null:null, sort});
    render();
  },
  delPay: async t => { const p = byId('show_payments', t.dataset.id);
    if (confirm('Supprimer cette ligne de facturation ?') && await remove('show_payments', t.dataset.id)){ if (p && p.kind !== 'solde') await rebalanceSolde(p.show_id); render(); } },

  // Tâches
  toggleTask: async t => {
    const done = t.checked;
    if (done) await saveLinger('tasks', t.dataset.id, {status:'Done', done_at:new Date().toISOString()}, 'Tâche terminée');
    else { S.linger.delete(t.dataset.id); await save('tasks', t.dataset.id, {status:'To Do', done_at:null}); }
  },
  todoFilter: t => { S.todoFilter=t.dataset.f; render(); },
  todoWho: t => { S.todoWho=t.dataset.f; localSet('todoWho', S.todoWho); render(); },
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
  rmLink: async t => { if (!confirm('Retirer ce lien ?')) return; const p = byId('projects', t.dataset.id), f = t.dataset.field; const list = (p[f]||[]).slice(); list.splice(Number(t.dataset.i), 1); await save('projects', p.id, {[f]: list}); },
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
  // filtre par étiquette : clic = ajoute / retire ; depuis une fiche ou une ligne = uniquement cette étiquette
  filterTag: (t, e) => { e?.stopPropagation(); const tg = t.dataset.tag; const cur = S.structTags || [];
    S.structTags = !tg ? [] : t.dataset.only ? [tg] : cur.includes(tg) ? cur.filter(x => x !== tg) : [...cur, tg];
    S.view = 'structures'; S.structurePage = null; render(); window.scrollTo(0, 0); },
  newStructure: () => editStructure(null), editStructure: t => editStructure(t.dataset.id),
  openStructure: t => { if ($('#modal').open) $('#modal').close(); S.view='structures'; S.structurePage=t.dataset.id; S.tab.structure = 'home'; /* toujours sur l'Accueil */ S.focusProspect=null; render(); window.scrollTo(0,0); },
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
  wsTask: t => { const p = byId('prospects', t.dataset.id); editTask(null, {structure_id:p.structure_id, project_ids:projIds(p), department:'Booking', prospect_id:p.id}); },
  noAnswerClose: async t => { if (confirm('Pas de réponse au téléphone : clore le suivi ? (noté dans le journal)')) await closeNoAnswer(t.dataset.id); },
  rmProj: async (t, e) => { e.stopPropagation(); const tb = t.dataset.t || 'prospects', r = byId(tb, t.dataset.id); const ids = projIds(r).filter(x=>x!==t.dataset.p);
    await save(tb, r.id, {project_ids: ids, project_id: ids[0]||null}); },
  delProspect: async t => { if (!confirm('Supprimer ce suivi, son journal et ses fichiers ?')) return;
    const fs=filesOf(t.dataset.id).filter(f=>f.mime!=='link').map(f=>f.path); if (fs.length) await sb.storage.from('suivi').remove(fs);
    if (await remove('prospects', t.dataset.id)){ S.db.prospect_logs=S.db.prospect_logs.filter(l=>l.prospect_id!==t.dataset.id); S.db.prospect_files=S.db.prospect_files.filter(f=>f.prospect_id!==t.dataset.id); touch('prospect_logs'); touch('prospect_files'); if (S.suiviPage===t.dataset.id) S.suiviPage=null; render(); } },
  aiSummary: async t => {
    const id = t.dataset.id; t.disabled = true; t.textContent = 'Rédaction en cours…';
    const {data, error} = await sb.functions.invoke('resume-suivi', {body:{prospect_id:id}, headers:{'x-region':'eu-west-3'}});   // toujours à Paris (règles européennes de Google)
    let msg = error ? (await error.context?.json?.().catch(()=>null))?.error || error.message : data?.error;
    if (msg && /Aucune clé/.test(msg)) msg = "Pas encore de clé IA : colle la clé Google AI Studio dans Réglages › IA.";
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
    // un mail envoyé depuis la Matrice se modifie avec sa mise en forme
    const mail = !!l.body_html, head = String(l.body || '').split('\n\n')[0];
    openModal({ title: `Échange du ${l.date ? fmtDate(l.date) : '—'}`, values: mail ? {...l, body: head} : l,
      fields:[{k:'date', label:'Date', type:'date'}, {k:'kind', label:'Type', type:'select', options:['Appel','Mail','RDV','Note'], blank:false}, {k:'contact_name', label:'Interlocuteur', full:true},
        {k:'body', label: mail ? 'En-tête (objet, artistes…)' : 'Notes', type:'textarea', full:true, rows: mail ? 3 : 10}],
      extra: mail ? `<div class="field full"><label>Mail</label>${rtToolbar('log-html')}<div class="mail-preview" id="log-html" contenteditable="true" style="${rtStyle()}">${safeHtml(l.body_html)}</div></div>` : '',
      onSave: async v => {
        if (mail){ const html = document.querySelector('#modal #log-html').innerHTML, div = document.createElement('div'); div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n');
          v.body_html = html; v.body = (v.body || '') + '\n\n' + div.textContent.replace(/\n{3,}/g, '\n\n').trim(); }
        await save('prospect_logs', l.id, v, {rerender:false}); } }); },
  // brouillon de prospection / relance envoyé depuis Gmail : noté « envoyé » à la main
  markLogSent: async t => { await markLogSent(t.dataset.id); },
  createArtistFolder: t => createArtistFolder(t.dataset.id),
  editProjLog: t => { const l = byId('project_logs', t.dataset.id);
    openModal({ title: `Échange du ${l.date ? fmtDate(l.date) : '—'}`, values: l,
      fields:[{k:'date', label:'Date', type:'date'}, {k:'kind', label:'Type', type:'select', options:['Note','Mail','Appel','Lien','Fichier'], blank:false},
        {k:'url', label:'Lien envoyé', full:true}, {k:'body', label:'Notes', type:'textarea', full:true, rows:10}],
      onSave: async v => { await save('project_logs', l.id, v, {rerender:false}); } }); },
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
  if (v === 'Closed' || v === 'Confirmed') return saveLinger('prospects', t.dataset.id, {status:v}, v === 'Confirmed' ? 'Suivi confirmé : rangé dans les suivis clos (relances automatiques retirées)' : 'Suivi clos (relances automatiques retirées)',
    {after: () => cancelAutoRelances(t.dataset.id), onUndo: restoreRelances});
  await save('prospects', t.dataset.id, {status:v});
};
// Date retirée du ticketing / de la communication : reste visible 5 s
for (const f of ['ticketing_enabled','communication_enabled'])
  ACTIONS['change:shows.'+f] = async (t, v) => v ? save('shows', t.dataset.id, {[f]:true}) : saveLinger('shows', t.dataset.id, {[f]:false}, f==='ticketing_enabled' ? 'Date retirée du ticketing' : 'Date retirée de la communication');
// Date annulée / sans suite : reste visible 5 s
ACTIONS['change:shows.status'] = async (t, v) => {
  const before = byId('shows', t.dataset.id)?.status;
  if (isOff(v)) return saveLinger('shows', t.dataset.id, {status:v}, `Date passée en « ${v} »`);
  await save('shows', t.dataset.id, {status:v});
  if (becameConfirmed(before, v)) askConfirmation(t.dataset.id);   // envoyer la confirmation maintenant ?
};

export { go };

// Facturation : % ↔ HT liés, solde = 100 % − les autres lignes, jamais plus de 100 % du cachet
const r2 = n => Math.round(n * 100) / 100;
const othersPct = (pay, withSolde) => paymentsOf(pay.show_id).filter(p => BILL_KINDS.includes(p.kind) && p.id !== pay.id && (withSolde || p.kind !== 'solde' || p.sent_at || p.paid_at))
  .reduce((t, p) => t + (billPct(p) || 0), 0);
/** Remet le solde à « ce qui reste » (s'il n'est pas encore envoyé) */
export async function rebalanceSolde(showId){
  const all = paymentsOf(showId), solde = all.find(p => p.kind === 'solde');
  if (!solde || solde.sent_at || solde.paid_at) return;
  const pct = Math.max(0, r2(100 - othersPct(solde, false)));
  if (Number(solde.pct) !== pct || solde.amount != null) await save('show_payments', solde.id, {pct, amount: null}, {rerender:false});
}
async function setBill(pay, pct){
  if (!BILL_KINDS.includes(pay.kind)) return false;
  const max = r2(100 - othersPct(pay, pay.kind === 'solde'));
  if (pct > max + 0.001){ toast(`Les factures ne peuvent pas dépasser 100 % du cachet : ${String(max).replace('.', ',')} % au plus pour cette ligne`, true); return true; }
  return false;
}
// commission de l'artiste changée : ses dates suivent (après confirmation)
ACTIONS['change:projects.default_artbo_pct'] = async (t, v) => {
  if (!await save('projects', t.dataset.id, {default_artbo_pct: v}, {rerender: false})) return;
  await propagateCommission(t.dataset.id);
  render();
};
ACTIONS['change:show_payments.pct'] = async (t, v) => {
  const pay = byId('show_payments', t.dataset.id);
  if (v != null && await setBill(pay, v)){ render(); return; }
  await save('show_payments', pay.id, {pct: v, amount: null}, {rerender:false});   // le HT suit le %
  if (pay.kind !== 'solde') await rebalanceSolde(pay.show_id);
  render();
};
ACTIONS['change:show_payments.amount'] = async (t, v) => {
  const pay = byId('show_payments', t.dataset.id), fee = Number(byId('shows', pay.show_id)?.fee_ht) || 0;
  if (!BILL_KINDS.includes(pay.kind) || !fee){ await save('show_payments', pay.id, {amount: v}); return; }
  if (v == null){ await save('show_payments', pay.id, {amount: null}, {rerender:false}); if (pay.kind !== 'solde') await rebalanceSolde(pay.show_id); render(); return; }
  const pct = v / fee * 100;                                                        // le % suit le HT
  if (await setBill(pay, r2(pct))){ render(); return; }
  await save('show_payments', pay.id, {amount: v, pct: Math.round(pct * 10000) / 10000}, {rerender:false});
  if (pay.kind !== 'solde') await rebalanceSolde(pay.show_id);
  render();
};
// TTC saisi → HT (selon la TVA de la ligne)
ACTIONS['change:show_payments.amount_ttc'] = async (t, v) => {
  const pay = byId('show_payments', t.dataset.id);
  return ACTIONS['change:show_payments.amount']({dataset: {id: pay.id}}, v == null ? null : r2(v / (1 + payVat(pay) / 100)));
};
// Cachet modifié : les factures pas encore envoyées suivent leur %
ACTIONS['change:shows.fee_ht'] = async (t, v) => {
  await save('shows', t.dataset.id, {fee_ht: v}, {rerender:false});
  for (const p of paymentsOf(t.dataset.id).filter(p => BILL_KINDS.includes(p.kind) && p.amount != null && p.pct != null && !p.sent_at && !p.paid_at))
    await save('show_payments', p.id, {amount: null}, {rerender:false});
  render();
};
