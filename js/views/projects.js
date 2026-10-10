/**
 * Onglet Projets : cartes des artistes (photo carrée, inactifs repliés) et page projet avec ses onglets :
 * Aperçu (cachets et commissions par année), Dates, Suivis, Tâches, Échanges, Liens, Drive,
 * Administratif (structure juridique de l'artiste), Membres (import CSV Movinmotion possible), Modèles de mail.
 */
import { netArtbo } from '../calc.js';
import { templatesList } from '../mail.js';
import { CONFIRMED_PROD, LOG_ICON, stClass } from '../constants.js';
import { signedCached, signedUrl } from '../data.js';
import { attachmentsOf, byId, isDone, lastExchange, logsOfProject, membersOfProject, prospectsOfProject, showsOfProject, structName, tasksOfProject } from '../selectors.js';
import { S } from '../state.js';
import { curTab, dropZone, fileRow, fold, pstBadge, stBadge, stSelect, tabsBar, viewHead } from '../ui/bits.js';
import { cAc, cIn } from '../ui/cells.js';
import { dateInput } from '../ui/datefield.js';
import { esc, eur, fmtDate, md, today, url } from '../utils.js';
import { adminForm } from './structures.js';
import { taskSection } from './todo.js';

export const LINK_KINDS = ['YouTube','Spotify','Linktree','Instagram','Facebook','TikTok','Deezer','Apple Music','Bandcamp','SoundCloud','Site officiel','Presse / EPK'];

const initials = n => String(n||'?').replace(/•.*$/,'').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,3).toUpperCase();

/** Cadrage enregistré « x% y% zoom » → style de l'image */
export const photoStyle = pos => { const [x='50%', y='50%', z='1'] = String(pos||'50% 50%').split(' ');
  return `object-position:${x} ${y};transform:scale(${Number(z)||1});transform-origin:${x} ${y}`; };

export const photoHTML = (p, cls='') => p.photo_path
  ? `<div class="photo ${cls}" data-photo="${esc(p.photo_path)}" data-pos="${esc(p.photo_orig ? '' : (p.photo_pos||'50% 50%'))}">${signedCached(p.photo_path)?`<img src="${esc(signedCached(p.photo_path))}" alt="" style="${p.photo_orig ? '' : photoStyle(p.photo_pos)}">`:''}</div>`
  : `<div class="photo ${cls}" aria-hidden="true">${esc(initials(p.name))}</div>`;

/** Charge les photos (liens temporaires) après l'affichage */
export function hydratePhotos(root=document){
  root.querySelectorAll('.photo[data-photo]:not(:has(img))').forEach(async el => {
    const u = await signedUrl(el.dataset.photo); if (!u || !el.isConnected) return;
    el.innerHTML = `<img src="${esc(u)}" alt="" style="${el.dataset.pos ? photoStyle(el.dataset.pos) : ''}">`;
  });
}

export function viewProjects(){
  if (S.projectPage) return projectPage(byId('projects', S.projectPage));
  const card = p => {
    const shows = showsOfProject(p.id);
    const yr = shows.filter(s=>s.date && Number(s.date.slice(0,4))===S.year);
    const tasks = tasksOfProject(p.id).filter(t=>!isDone(t));
    return `<div class="panel pcard" data-act="openProject" data-id="${p.id}">
      <div><h3>${esc(p.name)}</h3><span class="badge ${p.mode==='booking'?'tag':'proj'}">${p.mode==='booking'?'Booking seul':'Production'}</span>
      <div class="stats"><span><b>${yr.filter(s=>stClass(s.status)==='conf').length}</b>confirmées ${S.year}</span><span><b>${yr.filter(s=>['int','opt'].includes(stClass(s.status))).length}</b>en cours</span><span><b>${tasks.length}</b>tâches</span></div></div>
      ${photoHTML(p)}</div>`;
  };
  const act = S.db.projects.filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name));
  const ina = S.db.projects.filter(p=>!p.active).sort((a,b)=>a.name.localeCompare(b.name));
  return viewHead('Projets', {sub:`${act.length} actifs`, actions:'<button class="btn primary" data-act="newProject">Nouveau projet</button>'})
    + `<div class="grid-cards">${act.map(card).join('') || '<div class="empty">Aucun projet actif.</div>'}</div>`
    + (ina.length ? fold('inactive-projects', 'Projets inactifs', `<div class="grid-cards">${ina.map(card).join('')}</div>`, {count:ina.length}) : '');
}

export function projectPage(p){
  if (!p) { S.projectPage=null; return viewProjects(); }
  const shows = showsOfProject(p.id).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const tasks = tasksOfProject(p.id);
  const suivis = prospectsOfProject(p.id);
  const logs = logsOfProject(p.id);
  const members = membersOfProject(p.id);
  const tab = curTab('project', 'overview');
  const tabs = tabsBar('project', [['overview','Aperçu'], ['dates','Dates', shows.length], ['suivis','Suivis', suivis.filter(x=>x.status!=='Closed').length],
    ['tasks','Tâches', tasks.filter(t=>!isDone(t)).length], ['logs','Échanges', logs.length], ['links','Liens', (p.links||[]).length],
    ['drive','Drive'], ['mails','Modèles de mail', S.db.mail_templates.filter(t=>t.project_id===p.id).length], ['admin','Administratif'], ['members','Membres', members.length]]);
  const body = {overview, dates:datesTab, suivis:suivisTab, tasks:() => `<div class="vh-actions" style="margin-bottom:12px"><button class="btn primary" data-act="newTaskProject" data-id="${p.id}">Nouvelle tâche</button></div>${taskSection(tasks)}`,
    logs:logsTab, links:linksTab, drive:driveTab, mails:mailsTab, admin:adminTab, members:membersTab}[tab](p, {shows, tasks, suivis, logs, members});
  return `<button class="btn ghost back" data-act="closeProject">← Projets</button>
  <div class="project-hero">
    <div style="display:flex;flex-direction:column;gap:6px;align-items:center">${photoHTML(p, 'lg')}<button class="btn sm ghost" data-act="projectPhoto" data-id="${p.id}">${p.photo_path?'Changer / recadrer':'Ajouter une photo'}</button></div>
    <div style="flex:1;min-width:0"><h1>${esc(p.name)}</h1>
      <div class="proj-chips" style="margin-top:8px"><span class="badge ${p.mode==='booking'?'tag':'proj'}">${p.mode==='booking'?'Booking seul':'Production'}</span><span class="badge tag">${p.active?'Actif':'Inactif'}</span>
        ${p.default_artbo_pct?`<span class="badge tag">Commission ${p.default_artbo_pct} %</span>`:''}</div></div>
    <div class="vh-actions"><button class="btn" data-act="editProject" data-id="${p.id}">Modifier</button>
      <button class="btn" data-act="newTaskProject" data-id="${p.id}">Nouvelle tâche</button>
      <button class="btn primary" data-act="newShow" data-project="${p.id}">Nouvelle date</button></div>
  </div>
  ${tabs}${body}`;
}

/** Exercice comptable : du 01/10 au 30/09 → « 2025-2026 » */
export const fiscalYear = d => { if (!d) return 'Sans date'; const y = Number(d.slice(0,4)), m = Number(d.slice(5,7)); return m >= 10 ? `${y}-${y+1}` : `${y-1}-${y}`; };

function overview(p, {shows, tasks, suivis}){
  const byYear = {};
  shows.forEach(s=>{ const y=fiscalYear(s.date); (byYear[y]=byYear[y]||[]).push(s); });
  const next = shows.filter(s => s.date >= today() && stClass(s.status)!=='off').slice(0, 6);
  return `<div class="tbl-wrap year-tbl"><table><thead><tr><th>Exercice (01/10 → 30/09)</th><th class="num">Confirmées</th><th class="num">Options</th><th class="num">Intérêts</th><th class="num">Dates</th><th class="num">Cachets confirmés</th><th class="num">Commissions L'ArtBo nettes</th></tr></thead><tbody>
    ${Object.entries(byYear).sort((a,b)=>b[0].localeCompare(a[0])).map(([y,l])=>{ const conf = l.filter(s=>stClass(s.status)==='conf');
      return `<tr><td><b>${y}</b>${y.includes('-')?`<span class="sub">01/10/${y.slice(0,4)} → 30/09/${y.slice(5)}</span>`:''}</td><td class="num">${conf.length}</td><td class="num">${l.filter(s=>stClass(s.status)==='opt').length}</td><td class="num">${l.filter(s=>stClass(s.status)==='int').length}</td><td class="num">${l.length}</td>
      <td class="num">${eur(conf.reduce((a,s)=>a+(Number(s.fee_ht)||0),0))}</td><td class="num"><b>${eur(l.filter(s=>CONFIRMED_PROD.includes(s.status)).reduce((a,s)=>a+netArtbo(s),0))}</b></td></tr>`;}).join('') || '<tr><td colspan="7" class="empty">Aucune date.</td></tr>'}
  </tbody></table></div>
  <p class="help">Commissions nettes = commission L'ArtBo moins la part reversée aux partenaires (ex. Pyrprod), sur les dates confirmées salle / festival.</p>
  <div class="struct-hero" style="margin-top:18px">
    <div class="panel pad"><h3 class="block-title">Prochaines dates</h3>${next.map(s=>`<div class="plan-row" data-act="editShow" data-id="${s.id}" style="cursor:pointer"><span class="d">${fmtDate(s.date)}</span><span><b>${esc(s.venue)}</b> <span class="muted">${esc(s.city||'')}</span></span>${stSelect(s)}</div>`).join('') || '<p class="muted" style="margin:0">Aucune date à venir.</p>'}</div>
    <div class="panel pad"><h3 class="block-title">En cours</h3>
      <p style="margin:0 0 6px"><b>${tasks.filter(t=>!isDone(t)).length}</b> tâche(s) à faire · <b>${suivis.filter(x=>x.status!=='Closed').length}</b> suivi(s) ouverts</p>
      ${p.notes?`<div class="md">${md(p.notes)}</div>`:''}</div>
  </div>`;
}

function datesTab(p, {shows}){
  const list = shows.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Lieu</th><th>Structure</th><th>Statut</th><th class="num">Cachet</th><th>Contrat</th></tr></thead><tbody>
    ${list.map(s=>`<tr class="click" data-act="editShow" data-id="${s.id}"><td class="nowrap">${fmtDate(s.date)}</td><td><b>${esc(s.venue)}</b><span class="sub">${esc(s.city||'')}</span></td><td>${esc(structName(s.structure_id))}</td><td>${stSelect(s)}</td><td class="num">${eur(s.fee_ht)}</td><td>${esc(s.contract_type||'')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucune date.</td></tr>'}
  </tbody></table></div>`;
}

function suivisTab(p, {suivis}){
  const list = suivis.filter(x => S.showClosed || x.status!=='Closed').map(x=>({x, last:lastExchange(x)})).sort((a,b)=>(b.last||'').localeCompare(a.last||''));
  const nClosed = suivis.filter(x=>x.status==='Closed').length;
  return `<div class="vh-actions" style="margin-bottom:12px"><button class="btn" data-act="exportSuivis" data-project="${p.id}">Exporter en CSV</button>${nClosed?`<button class="btn" data-act="toggleClosed" aria-pressed="${!!S.showClosed}">${S.showClosed?'Masquer':'Afficher'} les suivis clos (${nClosed})</button>`:''}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Statut</th><th>Dernier échange</th><th>Résumé</th></tr></thead><tbody>
    ${list.map(({x,last})=>`<tr class="click" data-act="openSuivi" data-id="${x.id}"><td><b>${esc(structName(x.structure_id)||x.name)}</b><span class="sub">${esc(byId('structures',x.structure_id)?.city||'')}</span></td><td>${pstBadge(x.status)}</td><td class="nowrap">${last?fmtDate(last):'—'}</td><td class="muted">${esc((x.summary||'').replace(/\*\*/g,'').replace(/\n/g,' ').slice(0,180))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Aucun suivi.</td></tr>'}
  </tbody></table></div>`;
}

function logsTab(p, {logs}){
  return `<div class="panel pad" style="margin-bottom:14px">
    <form class="log-form" data-projlog="${p.id}" style="grid-template-columns:auto auto 1fr">
      ${dateInput(today(), 'name="date"')}
      <select name="kind" class="sel" aria-label="Type">${['Note','Mail','Appel','Lien','Fichier'].map(k=>`<option>${k}</option>`).join('')}</select>
      <input name="url" class="inp" placeholder="Lien envoyé (facultatif)" aria-label="Lien">
      <textarea name="body" placeholder="Ce qui a été échangé, envoyé, transmis…" aria-label="Notes"></textarea>
      <div class="dropzone" data-drop-form="files" style="grid-column:1/-1;margin:0"><label class="btn sm file-btn">Ajouter un fichier<input type="file" name="files" multiple class="file-input" data-filelist="plog"></label><span class="drop-hint">ou glisse les fichiers ici</span><div class="muted file-list" id="fl-plog"></div></div>
      <button class="btn primary sm">Ajouter aux échanges</button>
    </form></div>
  ${logs.map(l=>`<div class="panel pad" style="margin-bottom:8px"><div class="log-head">${LOG_ICON[l.kind]||'📝'} <b>${l.date?fmtDate(l.date):'Sans date'}</b> · ${esc(l.kind||'')}
      <button class="btn icon sm ghost danger" data-act="delProjLog" data-id="${l.id}" aria-label="Supprimer l'échange">✕</button></div>
    ${l.body?`<div class="md">${md(l.body)}</div>`:''}${l.url?`<div><a href="${esc(url(l.url))}" target="_blank" rel="noopener">${esc(l.url)}</a></div>`:''}
    ${attachmentsOf('project_log_id', l.id).map(f=>fileRow(f, 'openAttachment', 'delAttachment')).join('')}</div>`).join('') || '<div class="empty panel">Aucun échange noté pour ce projet.</div>'}`;
}

function linkList(p, field, kinds, placeholder){
  const list = p[field] || [];
  return `<div class="panel pad">
    ${list.map((l,i)=>`<div class="link-row">
      <input list="dl-${field}" value="${esc(l.label||'')}" data-plink="${field}" data-i="${i}" data-k="label" data-pid="${p.id}" aria-label="Nom du lien" placeholder="Nom">
      <input value="${esc(l.url||'')}" data-plink="${field}" data-i="${i}" data-k="url" data-pid="${p.id}" aria-label="Adresse du lien" placeholder="${placeholder}">
      <span style="display:flex;gap:4px">${l.url?`<a class="btn icon sm" href="${esc(url(l.url))}" target="_blank" rel="noopener" aria-label="Ouvrir">↗</a>`:''}<button class="btn icon sm ghost danger" data-act="rmLink" data-field="${field}" data-i="${i}" data-id="${p.id}" aria-label="Supprimer le lien">✕</button></span></div>`).join('') || '<p class="muted" style="margin:0 0 8px">Aucun lien pour l’instant.</p>'}
    <datalist id="dl-${field}">${kinds.map(k=>`<option value="${esc(k)}">`).join('')}</datalist>
    <button class="btn sm" data-act="addLink" data-field="${field}" data-id="${p.id}" style="margin-top:10px">Ajouter un lien</button></div>`;
}

const linksTab = p => linkList(p, 'links', LINK_KINDS, 'https://…');

function driveTab(p){
  return `${p.drive_artist_folder_id ? `<div class="panel pad" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>Dossier de l’artiste</b>
      <a class="btn sm primary" href="https://drive.google.com/drive/folders/${esc(p.drive_artist_folder_id)}" target="_blank" rel="noopener">Ouvrir dans Drive</a></div>` : ''}
    ${linkList(p, 'drive_links', ['Production','Communication','Technique','Contrats','Photos','Presse','Vidéos'], 'Lien du dossier Drive')}
    <p class="help">Colle le lien de chaque dossier (clic droit dans Drive → Partager → Copier le lien). Les liens s’ouvrent dans le navigateur ; avec Google Drive pour ordinateur, le même dossier est aussi dans le Finder sous « Google Drive ».</p>`;
}

function adminTab(p){
  const st = byId('structures', p.admin_structure_id);
  const a = st?.admin || {};
  return `<div class="panel pad">
    <div class="field" style="max-width:520px"><label>Structure juridique de l’artiste (association, label, société…)</label>
      ${cAc('structures','projects',p.id,'admin_structure_id',p.admin_structure_id,{placeholder:'Chercher ou créer la structure…', create:true})}</div>
    ${st ? `<div style="margin-top:14px">${adminForm(st)}</div>
      <p class="help">Ces informations sont celles de la fiche structure « ${esc(st.name)} » (onglet Coordonnées administratives).</p>`
      : '<p class="help">Choisis ou crée la structure qui porte l’artiste pour renseigner ses coordonnées administratives.</p>'}
  </div>`;
}

function membersTab(p, {members}){
  return `<div class="vh-actions" style="margin-bottom:12px"><button class="btn primary" data-act="addMember" data-id="${p.id}">Ajouter un membre</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Prénom</th><th>Nom</th><th>Poste</th><th>Mail</th><th>Téléphone</th><th>Adresse</th><th>Naissance</th><th></th></tr></thead><tbody>
    ${members.map(m=>`<tr><td>${cIn('project_members',m.id,'first_name',m.first_name)}</td><td>${cIn('project_members',m.id,'last_name',m.last_name)}</td>
      <td>${cIn('project_members',m.id,'role',m.role,'text','placeholder="Chant, régie…"')}</td><td>${cIn('project_members',m.id,'email',m.email)}</td><td>${cIn('project_members',m.id,'phone',m.phone)}</td>
      <td style="min-width:240px">${cAc('fulladdr','project_members',m.id,'address',m.address,{text:m.address||'', placeholder:'Adresse'})}</td><td>${cIn('project_members',m.id,'birth_date',m.birth_date,'date')}</td>
      <td class="nowrap"><button type="button" class="btn sm" data-act="memberCard" data-id="${m.id}">Fiche complète${Object.keys(m.data||{}).length?` (${Object.keys(m.data).length})`:''}</button>
        <button type="button" class="btn icon sm ghost danger" data-act="delMember" data-id="${m.id}" aria-label="Supprimer le membre">✕</button></td></tr>`).join('') || `<tr><td colspan="8" class="empty">Aucun membre. Ajoute-les un par un ou importe l’export Movinmotion.</td></tr>`}
  </tbody></table></div>
  <div class="dropzone" data-members-drop="${p.id}" style="margin-top:12px"><label class="btn sm file-btn">Importer un export Movinmotion (CSV)<input type="file" class="file-input" accept=".csv,text/csv" data-members-import="${p.id}"></label>
    <span class="drop-hint">ou glisse le fichier ici — nom, prénom, mail, téléphone, poste, adresse et naissance sont rangés ; toutes les autres colonnes (sécurité sociale, congés spectacles, IBAN…) vont dans la fiche complète. Un membre déjà présent est mis à jour.</span></div>`;
}

function mailsTab(p){
  return `<div class="panel pad"><p class="help" style="margin:0 0 12px">Modèles utilisés pour les mails de cet artiste (confirmation, boucles). Sans modèle ici, les modèles génériques des Réglages servent.</p>
    ${templatesList(p.id)}
    <div class="vh-actions" style="margin-top:12px"><button class="btn primary" data-act="newTemplate" data-project="${p.id}">Nouveau modèle</button></div></div>`;
}
