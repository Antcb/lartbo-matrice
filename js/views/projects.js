/**
 * Onglet Projets : cartes des artistes (photo carrée, inactifs repliés) et page projet avec ses onglets :
 * Aperçu (cachets et commissions par année), Dates, Suivis, Tâches, Échanges, Liens, Drive,
 * Administratif (structure juridique de l'artiste), Membres (import CSV Movinmotion possible), Modèles de mail.
 */
import { ARTIST_DOCS, ARTIST_SECTIONS, PHOTO_CREDITS } from '../artist-fields.js';
import { templateForm } from '../budget-template.js';
import { ALL_FIELDS as AF_FIELDS, ficheText, fieldText, input as afInput, listClick, migrateInfo, read as afRead } from '../artist-form.js';
import { netArtbo } from '../calc.js';
import { templatesList, tplProjects } from '../mail.js';
import { CONFIRMED_PROD, LOG_ICON, stClass } from '../constants.js';
import { save, sb, signedCached, signedUrl } from '../data.js';
import { defaultCommission, projectCommission, publicLink, setting, suiviClosed, attachmentsOf, byId, isDone, lastExchange, logsOfProject, membersOfProject, prospectsOfProject, showsOfProject, structName, tasksOfProject } from '../selectors.js';
import { S, touch } from '../state.js';
import { curTab, dropZone, fileRow, fold, pstBadge, stBadge, stSelect, tabsBar, viewHead } from '../ui/bits.js';
import { cAc, cIn } from '../ui/cells.js';
import { dateInput } from '../ui/datefield.js';
import { esc, eur, fmtDate, md, toast, today, url } from '../utils.js';
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
  const tabs = tabsBar('project', [['overview','Aperçu'], ['dates','Dates', shows.length], ['suivis','Suivis', suivis.filter(x=>!suiviClosed(x)).length],
    ['tasks','Tâches', tasks.filter(t=>!isDone(t)).length], ['logs','Échanges', logs.length], ['links','Liens', (p.links||[]).length],
    ['fiche','Fiche artiste', p.artist_submitted_at ? '✓' : ''], ['drive','Drive'], ['mails','Modèles de mail', S.db.mail_templates.filter(t=>tplProjects(t).includes(p.id)).length], ['admin','Administratif'], ['members','Membres', members.length]]);
  const body = {overview, dates:datesTab, suivis:suivisTab, tasks:() => `<div class="vh-actions mb"><button class="btn primary" data-act="newTaskProject" data-id="${p.id}">Nouvelle tâche</button></div>${taskSection(tasks)}`,
    logs:logsTab, links:linksTab, fiche:artistTab, drive:driveTab, mails:mailsTab, admin:adminTab, members:membersTab}[tab](p, {shows, tasks, suivis, logs, members});
  return `<button class="btn ghost back" data-act="closeProject">← Projets</button>
  <div class="project-hero">
    <div style="display:flex;flex-direction:column;gap:6px;align-items:center">${photoHTML(p, 'lg')}<button class="btn sm ghost" data-act="projectPhoto" data-id="${p.id}">${p.photo_path?'Changer / recadrer':'Ajouter une photo'}</button></div>
    <div style="flex:1;min-width:0"><h1>${esc(p.name)}</h1>
      <div class="proj-chips mt-sm"><span class="badge ${p.mode==='booking'?'tag':'proj'}">${p.mode==='booking'?'Booking seul':'Production'}</span><span class="badge tag">${p.active?'Actif':'Inactif'}</span>
        <span class="badge tag" title="${p.default_artbo_pct != null && p.default_artbo_pct !== '' ? 'Propre à l’artiste' : 'Par défaut (Réglages)'}">Commission ${projectCommission(p)} %</span></div></div>
    <div class="vh-actions">${p.drive_artist_folder_id ? `<a class="btn" href="https://drive.google.com/drive/folders/${esc(p.drive_artist_folder_id)}" target="_blank" rel="noopener">Dossier Drive ↗</a>`
        : S.folderPending === p.id ? '<span class="btn" aria-busy="true">Création du dossier Drive…</span>' : `<button class="btn" data-act="createArtistFolder" data-id="${p.id}">Créer son dossier Drive</button>`}
      <button class="btn" data-act="copyArtistLink" data-id="${p.id}" title="Lien à envoyer à l’artiste : il remplit sa fiche et envoie ses fichiers">Copier le lien de la fiche artiste</button>
      <button class="btn" data-act="editProject" data-id="${p.id}">Modifier</button>
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
  <div class="panel pad mt-lg"><h3 class="block-title">Accueil <span class="muted title-note">· repris dans les contrats et les mails ({{personnes}}, {{chambres}}, {{montage}}), enregistré dès que tu quittes le champ</span></h3>
    <div class="steps kv-grid">
      <label>Personnes sur la route (= repas)</label>${cIn('projects', p.id, 'road_people', p.road_people, 'number', 'class="narrow"')}
      <label>Mise à disposition du lieu (montage, balances), en heures</label>${cIn('projects', p.id, 'setup_hours', p.setup_hours, 'number', 'class="narrow"')}
      <label>Chambres single</label>${cIn('projects', p.id, 'rooms_single', p.rooms_single, 'number', 'class="narrow"')}
      <label>Chambres twin</label>${cIn('projects', p.id, 'rooms_twin', p.rooms_twin, 'number', 'class="narrow"')}
      <label>Commission L'ArtBo (%)</label>${cIn('projects', p.id, 'default_artbo_pct', p.default_artbo_pct, 'number', `class="narrow" placeholder="${defaultCommission(p.mode)}"`)}
    </div></div>
  ${p.mode === 'booking' ? '' : `<div class="panel pad mt-lg"><h3 class="block-title">Budget type <span class="muted title-note">· budget prévisionnel posé sur chaque nouvelle date confirmée</span></h3>${templateForm(p.id)}</div>`}
  <div class="struct-hero mt-lg">
    <div class="panel pad"><h3 class="block-title">Prochaines dates</h3>${next.map(s=>`<div class="plan-row click" data-act="editShow" data-id="${s.id}"><span class="d">${fmtDate(s.date)}</span><span><b>${esc(s.venue)}</b> <span class="muted">${esc(s.city||'')}</span></span>${stSelect(s)}</div>`).join('') || '<p class="muted m0">Aucune date à venir.</p>'}</div>
    <div class="panel pad"><h3 class="block-title">En cours</h3>
      <p class="mb-sm"><b>${tasks.filter(t=>!isDone(t)).length}</b> tâche(s) à faire · <b>${suivis.filter(x=>!suiviClosed(x)).length}</b> suivi(s) ouverts</p>
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
  const list = suivis.filter(x => S.showClosed || !suiviClosed(x)).map(x=>({x, last:lastExchange(x)})).sort((a,b)=>(b.last||'').localeCompare(a.last||''));
  const nClosed = suivis.filter(x=>suiviClosed(x)).length;
  return `<div class="vh-actions mb"><button class="btn" data-act="exportSuivis" data-project="${p.id}">Exporter</button>${nClosed?`<button class="btn" data-act="toggleClosed" aria-pressed="${!!S.showClosed}">${S.showClosed?'Masquer':'Afficher'} les suivis clos (${nClosed})</button>`:''}</div>
  <div class="tbl-wrap"><table><thead><tr><th>Structure</th><th>Statut</th><th>Dernier échange</th><th>Résumé</th></tr></thead><tbody>
    ${list.map(({x,last})=>`<tr class="click" data-act="openSuivi" data-id="${x.id}"><td><b>${esc(structName(x.structure_id)||x.name)}</b><span class="sub">${esc(byId('structures',x.structure_id)?.city||'')}</span></td><td>${pstBadge(x.status)}</td><td class="nowrap">${last?fmtDate(last):'—'}</td><td class="muted">${esc((x.summary||'').replace(/\*\*/g,'').replace(/\n/g,' ').slice(0,180))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Aucun suivi.</td></tr>'}
  </tbody></table></div>`;
}

function logsTab(p, {logs}){
  return `<div class="panel pad mb">
    <form class="log-form" data-projlog="${p.id}" data-draft="projlog.${p.id}" style="grid-template-columns:auto auto 1fr">
      ${dateInput(today(), 'name="date"')}
      <select name="kind" class="sel" aria-label="Type">${['Note','Mail','Appel','Lien','Fichier'].map(k=>`<option>${k}</option>`).join('')}</select>
      <input name="url" class="inp" placeholder="Lien envoyé (facultatif)" aria-label="Lien">
      <textarea name="body" placeholder="Ce qui a été échangé, envoyé, transmis…" aria-label="Notes"></textarea>
      <div class="dropzone" data-drop-form="files" style="grid-column:1/-1;margin:0"><label class="btn sm file-btn">Ajouter un fichier<input type="file" name="files" multiple class="file-input" data-filelist="plog"></label><span class="drop-hint">ou glisse les fichiers ici</span><div class="muted file-list" id="fl-plog"></div></div>
      <button class="btn primary sm">Ajouter aux échanges</button>
    </form></div>
  ${logs.map(l=>`<div class="panel pad mb-sm"><div class="log-head">${LOG_ICON[l.kind]||'📝'} <b>${l.date?fmtDate(l.date):'Sans date'}</b> · ${esc(l.kind||'')}
      <span class="spacer"></span><button class="btn sm ghost" data-act="editProjLog" data-id="${l.id}">Modifier</button>
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
      <span style="display:flex;gap:4px">${l.url?`<a class="btn icon sm" href="${esc(url(l.url))}" target="_blank" rel="noopener" aria-label="Ouvrir">↗</a>`:''}<button class="btn icon sm ghost danger" data-act="rmLink" data-field="${field}" data-i="${i}" data-id="${p.id}" aria-label="Supprimer le lien">✕</button></span></div>`).join('') || '<p class="muted mb-sm">Aucun lien pour l’instant.</p>'}
    <datalist id="dl-${field}">${kinds.map(k=>`<option value="${esc(k)}">`).join('')}</datalist>
    <button class="btn sm mt" data-act="addLink" data-field="${field}" data-id="${p.id}">Ajouter un lien</button></div>`;
}

const linksTab = p => linkList(p, 'links', LINK_KINDS, 'https://…');

function driveTab(p){
  return `<div class="panel pad" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>Dossier de l’artiste</b>
      ${p.drive_artist_folder_id ? `<a class="btn sm primary" href="https://drive.google.com/drive/folders/${esc(p.drive_artist_folder_id)}" target="_blank" rel="noopener">Ouvrir dans Drive</a>`
        : `<span class="muted">pas encore de dossier Drive</span><button class="btn sm primary" data-act="createArtistFolder" data-id="${p.id}">Créer le dossier Drive (modèle artiste)</button>`}</div>
    ${linkList(p, 'drive_links', ['Production','Communication','Technique','Contrats','Photos','Presse','Vidéos'], 'Lien du dossier Drive')}
    <p class="help">Colle le lien de chaque dossier (clic droit dans Drive → Partager → Copier le lien). Les liens s’ouvrent dans le navigateur ; avec Google Drive pour ordinateur, le même dossier est aussi dans le Finder sous « Google Drive ».</p>`;
}

function adminTab(p){
  const st = byId('structures', p.admin_structure_id);
  const a = st?.admin || {};
  return `<div class="panel pad">
    <div class="field" style="max-width:520px"><label>Structure juridique de l’artiste (association, label, société…)</label>
      ${cAc('structures','projects',p.id,'admin_structure_id',p.admin_structure_id,{placeholder:'Chercher ou créer la structure…', create:true})}</div>
    ${st ? `<div class="mt">${adminForm(st)}</div>
      <p class="help">Ces informations sont celles de la fiche structure « ${esc(st.name)} » (onglet Coordonnées administratives).</p>`
      : '<p class="help">Choisis ou crée la structure qui porte l’artiste pour renseigner ses coordonnées administratives.</p>'}
  </div>`;
}

function membersTab(p, {members}){
  return `<div class="vh-actions mb"><button class="btn primary" data-act="addMember" data-id="${p.id}">Ajouter un membre</button></div>
  <div class="tbl-wrap"><table><thead><tr><th>Prénom</th><th>Nom</th><th>Poste</th><th>Mail</th><th>Téléphone</th><th>Adresse</th><th>Naissance</th><th></th></tr></thead><tbody>
    ${members.map(m=>`<tr><td>${cIn('project_members',m.id,'first_name',m.first_name)}</td><td>${cIn('project_members',m.id,'last_name',m.last_name)}</td>
      <td>${cIn('project_members',m.id,'role',m.role,'text','placeholder="Chant, régie…"')}</td><td>${cIn('project_members',m.id,'email',m.email)}</td><td>${cIn('project_members',m.id,'phone',m.phone)}</td>
      <td style="min-width:240px">${cAc('fulladdr','project_members',m.id,'address',m.address,{text:m.address||'', placeholder:'Adresse'})}</td><td>${cIn('project_members',m.id,'birth_date',m.birth_date,'date')}</td>
      <td class="nowrap">${m.employee_id ? `<button type="button" class="btn sm" data-act="employeeCard" data-id="${m.employee_id}">Fiche salarié</button>` : `<button type="button" class="btn sm" data-act="memberCard" data-id="${m.id}">Fiche complète${Object.keys(m.data||{}).length?` (${Object.keys(m.data).length})`:''}</button>`}
        <button type="button" class="btn icon sm ghost danger" data-act="delMember" data-id="${m.id}" aria-label="Supprimer le membre">✕</button></td></tr>`).join('') || `<tr><td colspan="8" class="empty">Aucun membre. Ajoute-les un par un ou importe l’export Movinmotion.</td></tr>`}
  </tbody></table></div>
  <div class="dropzone mt" data-members-drop="${p.id}"><label class="btn sm file-btn">Importer un export Movinmotion (CSV)<input type="file" class="file-input" accept=".csv,text/csv" data-members-import="${p.id}"></label>
    <span class="drop-hint">ou glisse le fichier ici — chaque personne est ajoutée (ou mise à jour) dans l’onglet Salariés avec toute sa fiche, et reliée à ce projet.</span></div>`;
}

function mailsTab(p){
  return `<div class="panel pad"><p class="help mb">Modèles utilisés pour les mails de cet artiste (confirmation, boucles). Sans modèle ici, les modèles génériques des Réglages servent.</p>
    ${templatesList(p.id)}
    <div class="vh-actions mt"><button class="btn primary" data-act="newTemplate" data-project="${p.id}">Nouveau modèle</button></div></div>`;
}

/** Fiche artiste : ce que l'artiste a rempli via son lien, modifiable ici, avec « Copier » sur chaque champ */
function artistTab(p){
  // une modification pas encore enregistrée (échec d'enregistrement) reste affichée pour pouvoir réessayer
  const info = AF_UNSAVED.get(p.id) || migrateInfo(p.artist_info), docs = p.artist_docs || [];
  const label = k => (ARTIST_DOCS.find(d => d[0] === k) || [k, k])[1];
  const sections = ARTIST_SECTIONS.map(sec => `<section class="af-sec"><h3 class="block-title">${esc(sec.title)}</h3>
    <div class="fiche-grid${sec.cols ? ` cols${sec.cols} even` : ''}">${sec.fields.map(f => afInput(f, info[f.k] ?? '', {copy: true, prefix: 'af-' + p.id.slice(0, 6) + '-'})).join('')}</div></section>`).join('');
  return `<div class="panel pad">
    <p class="tab-intro">Envoie ce lien à l’artiste : il remplit sa fiche et dépose ses fichiers (photos, logos, fiche technique, titres…), rangés tout seuls dans son dossier Drive. Il peut revenir sur le même lien pour corriger.
      <button class="btn sm primary" data-act="copyArtistLink" data-id="${p.id}">Copier le lien</button> <a class="btn sm ghost" href="${esc(artistLink(p))}" target="_blank" rel="noopener">Voir la fiche ↗</a></p>
    ${p.artist_submitted_at ? `<p class="ok-txt">✓ Remplie le ${fmtDate(p.artist_submitted_at.slice(0, 10))}</p>` : '<p class="muted">Pas encore remplie par l’artiste : tu peux aussi la remplir ici.</p>'}
    ${docs.length ? `<h3 class="block-title">Fichiers reçus</h3><ul class="af-list">${docs.map(d => `<li>${esc(label(d.kind))} : ${d.file_id ? `<a href="https://drive.google.com/file/d/${esc(d.file_id)}/view" target="_blank" rel="noopener">${esc(d.drive_name || d.name)}</a>` : `${esc(d.name)} <span class="muted">(rangement dans le Drive en cours)</span>`}</li>`).join('')}</ul>` : ''}
    <div class="af-bar"><button type="button" class="btn sm" data-af-copyall="${p.id}">Copier toute la fiche</button><span class="muted af-state" data-af-state="${p.id}">Modifie un champ : c’est enregistré tout seul.</span></div>
    <form class="af-edit fiche-form" data-af-form="${p.id}" autocomplete="off" onsubmit="return false">${sections}
      <section class="af-sec"><h3 class="block-title">Photos</h3><div class="fiche-grid">${afInput(PHOTO_CREDITS, info[PHOTO_CREDITS.k] ?? '', {copy: true, prefix: 'af-' + p.id.slice(0, 6) + '-'})}</div></section></form>
  </div>`;
}

// Fiche artiste dans la Matrice : enregistrement automatique (la structure administrative et l'onglet Membres suivent),
// copie d'un champ ou de toute la fiche
const afTimers = new Map(), AF_UNSAVED = new Map();
function afSave(form){
  const id = form.dataset.afForm; clearTimeout(afTimers.get(id));
  AF_UNSAVED.set(id, afRead(form));
  const state = document.querySelector(`[data-af-state="${id}"]`); if (state) state.textContent = 'Enregistrement…';
  afTimers.set(id, setTimeout(() => afWrite(id), 600));
}
async function afWrite(id){
  const info = AF_UNSAVED.get(id); if (!info) return;
  const {error} = await sb.rpc('artist_info_save', {p_project: id, p_info: info});
  const st = document.querySelector(`[data-af-state="${id}"]`);
  if (error){ if (st) st.innerHTML = `<span class="err">Pas enregistré (${esc(error.message)})</span> <button type="button" class="btn sm" data-af-retry="${id}">Réessayer</button>`; return; }
  if (AF_UNSAVED.get(id) === info) AF_UNSAVED.delete(id);
  const p = byId('projects', id); if (p) p.artist_info = info; touch('projects');
  // structure administrative et membres mis à jour par la base : on les recharge
  const [{data: pr}, {data: mem}] = await Promise.all([sb.from('projects').select('*').eq('id', id).single(), sb.from('project_members').select('*').eq('project_id', id)]);
  if (pr && p) Object.assign(p, pr);
  if (mem){ S.db.project_members = S.db.project_members.filter(m => m.project_id !== id).concat(mem); touch('project_members'); }
  if (pr?.admin_structure_id && !byId('structures', pr.admin_structure_id)){ const {data: st2} = await sb.from('structures').select('*').eq('id', pr.admin_structure_id).single(); if (st2){ S.db.structures.push(st2); touch('structures'); } }
  else if (pr?.admin_structure_id){ const {data: st2} = await sb.from('structures').select('*').eq('id', pr.admin_structure_id).single(); const cur = byId('structures', pr.admin_structure_id); if (st2 && cur){ Object.assign(cur, st2); touch('structures'); } }
  if (st) st.textContent = 'Enregistré ✓ (structure administrative et membres mis à jour)';
}
document.addEventListener('input', e => { const f = e.target.closest?.('form.af-edit'); if (f) afSave(f); });
document.addEventListener('change', e => { const f = e.target.closest?.('form.af-edit'); if (f){ e.stopPropagation(); afSave(f); } }, true);
document.addEventListener('click', async e => {
  const form = e.target.closest?.('form.af-edit');
  if (form && listClick(e, form, () => afSave(form))) return;
  const one = e.target.closest?.('[data-af-copy]');
  if (one && form){ e.preventDefault(); const f = AF_FIELDS.find(x => x.k === one.dataset.afCopy); const txt = fieldText(f, afRead(form)[f.k]);
    try { await navigator.clipboard.writeText(txt); one.textContent = 'Copié ✓'; setTimeout(() => { one.textContent = 'Copier'; }, 1200); } catch { prompt('À copier :', txt); } return; }
  const retry = e.target.closest?.('[data-af-retry]');
  if (retry){ afWrite(retry.dataset.afRetry); return; }
  const all = e.target.closest?.('[data-af-copyall]');
  if (all){ const fm = document.querySelector(`form[data-af-form="${all.dataset.afCopyall}"]`); const p = byId('projects', all.dataset.afCopyall);
    const txt = ficheText(fm ? afRead(fm) : (p?.artist_info || {}), p?.name || '');
    try { await navigator.clipboard.writeText(txt); toast('Fiche copiée : colle-la où tu veux'); } catch { prompt('Fiche :', txt); } }
});
export const artistLink = p => publicLink('artiste', p.artist_token);   // en test : « &test », le lien ouvre la base de test
