/**
 * ✉️ Modèles de mail : choix du bon modèle, remplissage des balises, aperçu, brouillon Gmail.
 *
 * Les balises ({{date}}, {{cachet_ht}}…) sont calculées par la fonction SQL mail_vars(),
 * la même que celle utilisée par Apps Script pour les brouillons automatiques.
 * Le brouillon est créé dans Gmail (compte production@) par le script Apps Script
 * (réglage drive_webhook_url) ; sans lui, on copie le mail pour le coller dans Gmail.
 */
import { insert, remove, save, sb } from './data.js';
import { byId, linksOfStructure, projectOptions, setting } from './selectors.js';
import { S } from './state.js';
import { openModal } from './ui/modal.js';
import { rtStyle, rtToolbar, wrapMail } from './ui/richtext.js';
import { esc, fmtDate, toast } from './utils.js';

export const MAIL_KINDS = { confirmation: 'Confirmation', boucle_tech: 'Boucle accueil & technique', boucle_com: 'Boucle communication', prospection: 'Prospection', relance: 'Relance de prospection', autre: 'Autre' };
/** Mails envoyés depuis une structure (pas depuis une date) : balises de la structure */
export const STRUCT_KINDS = ['prospection', 'relance'];
/** Quand un modèle est proposé en premier (la variante, elle, n'est qu'un nom libre : CC Club, CC Festival…) */
export const APPLIES = { all: 'Toutes les dates', salle: 'Dates en salle (Confirmée Salle)', festival: 'Festivals (Confirmée Festival)', cr: 'Co-réalisations', cession: 'Cessions' };
const applies = (rule, s) => ({ all: true, salle: /Salle/.test(s.status || ''), festival: /Festival/.test(s.status || ''),
  cr: s.contract_type === 'Co-Réalisation', cession: s.contract_type === 'Cession' })[rule || 'all'] ?? true;
/** Étape de suivi remplie quand le mail est noté « envoyé » */
export const SENT_FIELD = { confirmation: 'conf_kit_sent', boucle_tech: 'boucle_tech', boucle_com: 'boucle_com' };
export const TAGS = [
  ['artiste','Artiste'], ['date','Date courte (Sam 17 octobre 2026)'], ['date_longue','Date longue (Samedi 17 octobre 2026)'],
  ['ville','Ville'], ['cp','Département (2 chiffres, ou pays)'], ['code_postal','Code postal complet (infos administratives)'], ['lieu','Salle / festival'], ['adresse','Adresse du lieu'], ['jauge','Jauge'],
  ['cachet_ht','Cachet HT'], ['cachet_ttc','Cachet TTC'], ['tva','TVA'], ['type_contrat','Type de contrat'], ['acompte_pct','% d’acompte'],
  ['contact','Prénom du destinataire'], ['structure','Structure'], ['lien_fiche','Lien de la fiche de renseignements'],
  ['horaire','Heure de passage'], ['duree_set','Durée du set'],
  ['personnes','Personnes sur la route'], ['chambres','Chambres (single / twin)'], ['montage','Mise à disposition (heures)'], ['invitations','Invitations producteur'],
];
/** Balises des mails de prospection / relance (infos de la structure) */
export const PROSPECT_TAGS = [
  ['contact','Prénom du destinataire'], ['structure','Structure'], ['artiste','Artiste(s) choisi(s)'], ['ville','Ville'], ['cp','Département'],
  ['festival','Nom du festival / de la salle'], ['dates_festival','Dates du festival'], ['jauge','Jauge'],
  ['date_proposee','Date proposée'], ['annee','Année (de la date proposée, sinon l’an prochain)'],
  ['date_concert','Invitation : date du concert choisi'], ['date_concert_court','Invitation : date du concert (JJ/MM/AA)'], ['ville_concert','Invitation : ville du concert'], ['cp_concert','Invitation : département du concert'],
  ['lieu_concert','Invitation : salle / festival du concert'], ['date_reponse','Invitation : réponse attendue avant (2 jours avant le concert)'],
  ['lien_projet','Lien de la page pro de l’artiste (fiche artiste › liens)'], ['lien_evenement','Lien de l’événement (billetterie, Facebook…)'],
];

/**
 * Modèles possibles pour une date, le plus adapté en premier :
 * celui de l'artiste avant le générique, puis celui dont la règle correspond (co-réalisation, festival, salle…)
 * avant « toutes les dates ». Les autres restent proposés dans la liste.
 */
/** Artistes d'un modèle (aucun = tous les artistes) */
export const tplProjects = t => (t?.project_ids?.length ? t.project_ids : (t?.project_id ? [t.project_id] : []));
export const tplLabel = t => { const ids = tplProjects(t); return ids.length ? ids.map(id => byId('projects', id)?.name || '?').join(', ') : 'Tous les artistes (générique)'; };

export function templatesFor(s, kind){
  const all = S.db.mail_templates.filter(t => t.kind === kind && (!tplProjects(t).length || tplProjects(t).includes(s.project_id)));
  const score = t => (tplProjects(t).includes(s.project_id) ? 10 : 0) + (!applies(t.applies_to, s) ? -20 : (t.applies_to && t.applies_to !== 'all' ? 5 : 0));
  return all.sort((a,b) => score(b) - score(a) || (a.name||'').localeCompare(b.name||''));
}

/** Remplace les balises. Dans le corps, les valeurs sont échappées ; une balise vide reste visible pour être complétée. */
export function fill(text, vars, html){
  return String(text||'').replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = vars?.[k];
    if (v == null || v === '') return html ? `<span style="background:#FFE9A8">[${k} à compléter]</span>` : `[${k} à compléter]`;
    return html ? esc(v) : String(v);
  });
}

export async function mailVars(showId, contactId){
  const {data, error} = await sb.rpc('mail_vars', {p_show: showId, p_contact: contactId || null});
  if (error){ toast('Balises : ' + error.message, true); return {}; }
  return data || {};
}

const scriptUrl = () => (setting('drive_webhook_url') || '').trim();

/** Appel du script Apps Script (compte production@) */
export async function callScript(action, payload){
  const url = scriptUrl();
  if (!url) throw new Error('Le script Google (Apps Script) n’est pas encore installé.');
  const res = await fetch(url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({secret: setting('drive_webhook_secret'), action, ...payload})});
  const out = await res.json().catch(() => ({ok:false, error:'Réponse illisible du script'}));
  if (!out.ok) throw new Error(out.error || 'Erreur du script');
  return out;
}

/** Copie riche (HTML) : se colle mise en forme dans Gmail */
async function copyRich(html, text){
  try {
    await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([html], {type:'text/html'}), 'text/plain': new Blob([text], {type:'text/plain'})})]);
    return true;
  } catch {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
}

const plain = html => { const d = document.createElement('div'); d.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n'); return d.textContent.replace(/\n{3,}/g, '\n\n').trim(); };

/** Fenêtre « Préparer le mail » pour une date */
export async function prepareMail(showId, kind){
  const s = byId('shows', showId); if (!s) return;
  const tpls = templatesFor(s, kind);
  if (!tpls.length) return toast(`Aucun modèle « ${MAIL_KINDS[kind]} » pour cet artiste. Ajoute-le dans Réglages › Modèles de mail.`, true);
  const contacts = linksOfStructure(s.structure_id);
  let contactId = s.conf_contact_id && contacts.some(c=>c.id===s.conf_contact_id) ? s.conf_contact_id : (contacts.find(c=>c.email)?.id || '');
  let vars = await mailVars(showId, contactId);
  const log = s.mail_log?.[kind];
  const booking = isBookingOnly(s);
  const checks = kind === 'confirmation' ? confChecks(s, booking) : '';
  const extra = `<div class="mail-wrap">
    ${log ? `<p class="mode-note">Déjà préparé le ${fmtDate(log.at.slice(0,10))}${log.to?` pour ${esc(log.to)}`:''}${log.draft?' (brouillon Gmail)':''}.</p>` : ''}
    ${checks}
    <div class="mail-grid">
      <label for="ml-tpl">Modèle</label><select id="ml-tpl">${tpls.map(t=>`<option value="${t.id}">${esc(t.name||MAIL_KINDS[t.kind])}${tplProjects(t).length?'':' · générique'}</option>`).join('')}</select>
      <label for="ml-contact">Destinataire</label><span class="mail-to"><select id="ml-contact"><option value="">— autre adresse —</option>${contacts.map(c=>`<option value="${c.id}" ${c.id===contactId?'selected':''}>${esc(c.display_name)}${c.email?` · ${esc(c.email)}`:' (pas de mail)'}</option>`).join('')}</select>
        <input id="ml-to" type="email" placeholder="adresse@exemple.fr" value="${esc(vars.contact_email||'')}"></span>
      <label for="ml-cc">Copie</label><input id="ml-cc">
      <label for="ml-subj">Objet</label><input id="ml-subj">
    </div>
    ${rtToolbar('ml-body')}<div class="mail-preview" id="ml-body" contenteditable="true" style="${rtStyle()}" aria-label="Texte du mail (modifiable)"></div>
    <div class="ml-att"><b class="fiche-lbl">Pièces jointes</b> <span id="ml-files"></span>
      <label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="ml-up"></label>
      ${scriptUrl() ? '<button type="button" class="btn sm" id="ml-gm">Depuis un mail Gmail…</button>' : ''}</div>
    <div class="gm-pick" id="ml-gm-box" hidden>
      <div class="gm-search"><input id="ml-gm-q" type="search" placeholder="Rechercher dans Gmail (mail de l’organisateur, objet, nom du fichier…)" autocomplete="off" data-1p-ignore><button type="button" class="btn sm" id="ml-gm-go">Chercher</button></div>
      <div id="ml-gm-list" class="gm-list"></div></div>
    <p class="help">Le texte est modifiable ici avant de créer le brouillon. Les zones jaunes sont à compléter.${scriptUrl()?'':' Le script Google n’est pas encore installé : « Copier le mail » puis colle-le dans un nouveau mail Gmail.'}</p>
    <label class="check-line"><input type="checkbox" id="ml-sent"> Noter « envoyé » aujourd’hui (${esc(SENT_FIELD[kind] ? stepLabel(kind) : '')})</label>
    <div class="vh-actions" style="margin-top:10px">
      <button type="button" class="btn" id="ml-copy">Copier le mail</button>
      <a class="btn" id="ml-gmail" target="_blank" rel="noopener">Ouvrir Gmail</a>
    </div></div>`;
  const dlgP = openModal({title: `${MAIL_KINDS[kind]} · ${s.venue}`, fields: [], extra, mail: true,
    saveLabel: scriptUrl() ? 'Créer le brouillon Gmail' : 'Fermer',
    onSave: async () => {
      if (!scriptUrl()) return true;
      const m = current();
      if (!m.to) { toast('Indique le destinataire', true); return false; }
      try {
        const tpl = byId('mail_templates', $('#ml-tpl').value);
        const out = await callScript('draft', {to: m.to, cc: m.cc, subject: m.subject, html: m.html,
          attachments: files.filter(f => f.on).map(f => f.gmail ? {gmail: f.gmail, idx: f.idx, name: f.name} : f.path ? {path: f.path, name: f.name} : {id: f.id})});
        await logMail(s, kind, m.to, true);
        toast('Brouillon créé dans Gmail', false, out.url ? {label:'Ouvrir', fn: () => window.open(out.url, '_blank')} : null);
        return true;
      } catch (err) { toast(err.message, true); return false; }
    }});
  const $ = sel => document.querySelector('#modal ' + sel);
  const current = () => ({to: $('#ml-to').value.trim(), cc: $('#ml-cc').value.trim(), subject: $('#ml-subj').value.trim(), html: wrapMail($('#ml-body').innerHTML)});
  // Pièces jointes : celles du modèle (cochées) + celles ajoutées pour ce mail
  let files = [];
  const drawFiles = () => { $('#ml-files').innerHTML = files.map((f, i) => `<label class="att-chip"><input type="checkbox" data-att="${i}" ${f.on ? 'checked' : ''}> ${f.gmail ? '✉️' : f.path ? '📎' : '🔗'} ${esc(f.name || 'Fichier Drive')}</label>`).join('') || '<span class="muted">aucune</span>'; };
  const draw = () => {
    const t = byId('mail_templates', $('#ml-tpl').value);
    files = [...(t.attachments || []).map(a => ({...a, on: true})), ...files.filter(f => f.mine)]; drawFiles();
    $('#ml-cc').value = t.cc || '';
    $('#ml-subj').value = fill(t.subject, vars, false);
    // date en booking uniquement : pas de fiche de renseignements (les parties s'arrangent entre elles après le mail)
    $('#ml-body').innerHTML = fill(booking ? withoutFiche(t.html) : t.html, vars, true);
    gmailLink();
  };
  const gmailLink = () => { const m = current();
    $('#ml-gmail').href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.to)}&cc=${encodeURIComponent(m.cc)}&su=${encodeURIComponent(m.subject)}`; };
  draw();
  $('#ml-tpl').onchange = draw;
  $('#ml-contact').onchange = async e => {
    contactId = e.target.value; vars = await mailVars(showId, contactId);
    $('#ml-to').value = vars.contact_email || ''; draw();
    if (contactId && contactId !== s.conf_contact_id) save('shows', s.id, {conf_contact_id: contactId}, {rerender:false});
  };
  ['#ml-to','#ml-cc','#ml-subj'].forEach(k => $(k).oninput = gmailLink);
  $('#ml-files').addEventListener('change', e => { const i = e.target.dataset.att; if (i != null) files[i].on = e.target.checked; });
  $('#ml-up').addEventListener('change', async e => {
    for (const f of e.target.files){
      const path = `mails/${s.id}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const {error} = await sb.storage.from('suivi').upload(path, f, {contentType: f.type || 'application/octet-stream'});
      if (error){ toast('Envoi impossible : ' + error.message, true); continue; }
      files.push({path, name: f.name, on: true, mine: true});
    }
    e.target.value = ''; drawFiles();
  });
  // Pièces jointes d'un mail reçu dans Gmail : jointes au brouillon directement, sans les enregistrer sur l'ordinateur
  const gmBtn = $('#ml-gm');
  if (gmBtn){
    const box = $('#ml-gm-box'), list = $('#ml-gm-list'), q = $('#ml-gm-q');
    const search = async () => {
      list.innerHTML = '<p class="muted">Recherche dans Gmail…</p>';
      try {
        const out = await callScript('gmail_attachments', {query: q.value.trim()});
        list.innerHTML = (out.attachments || []).map((a, i) => `<label class="gm-row"><input type="checkbox" data-gm="${i}" ${files.some(f => f.gmail === a.msg && f.idx === a.idx) ? 'checked' : ''}>
          <span><b>📎 ${esc(a.name)}</b> <span class="muted">${a.size > 1e6 ? (a.size/1e6).toFixed(1)+' Mo' : Math.max(1, Math.round(a.size/1024))+' Ko'}</span><br>
          <span class="muted">${esc(a.subject || '(sans objet)')} · ${esc((a.from || '').replace(/<.*>/, '').trim())} · ${fmtDate(a.date.slice(0, 10))}</span></span></label>`).join('')
          || '<p class="muted">Aucune pièce jointe trouvée. Essaie un autre mot (nom de la salle, de l’organisateur…).</p>';
        list.onchange = e => { const i = e.target.dataset.gm; if (i == null) return; const a = out.attachments[i];
          files = files.filter(f => !(f.gmail === a.msg && f.idx === a.idx));
          if (e.target.checked) files.push({gmail: a.msg, idx: a.idx, name: a.name, on: true, mine: true});
          drawFiles(); };
      } catch (err) { list.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
    };
    gmBtn.onclick = () => { box.hidden = !box.hidden; if (!box.hidden){ q.value = q.value || $('#ml-to').value.trim(); search(); q.focus(); } };
    $('#ml-gm-go').onclick = search;
    q.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); search(); } };
  }
  $('#ml-copy').onclick = async () => {
    const m = current();
    if (await copyRich(m.html, plain(m.html))) toast(files.some(f => f.on) ? 'Mail copié. Pense à joindre les pièces jointes à la main dans Gmail' : 'Mail copié : colle-le dans Gmail (objet et destinataires sont dans « Ouvrir Gmail »)');
    else toast('Copie impossible avec ce navigateur', true);
    await logMail(s, kind, m.to, false);
  };
  $('#ml-gmail').addEventListener('click', async () => { const m = current(); await copyRich(m.html, plain(m.html)); toast('Mail copié : colle-le dans le nouveau message'); await logMail(s, kind, m.to, false); });
  dlgP.then(() => {});
}

function stepLabel(kind){ return {confirmation:'Conf + FT + kit envoyés', boucle_tech:'Boucle accueil & technique', boucle_com:'Boucle communication'}[kind] || ''; }

async function logMail(s, kind, to, draft){
  const patch = {mail_log: {...(s.mail_log||{}), [kind]: {at: new Date().toISOString(), to, draft}}};
  const sent = document.querySelector('#modal #ml-sent')?.checked;
  if (sent && SENT_FIELD[kind] && !s[SENT_FIELD[kind]]) patch[SENT_FIELD[kind]] = new Date().toISOString().slice(0,10);
  await save('shows', s.id, patch, {rerender:false});
}

/** À vérifier avant la confirmation : cachet, TVA, contrat, acomptes */
/** Date en booking uniquement (date cochée, ou artiste « booking seul ») */
export const isBookingOnly = s => s?.prod_mode === 'booking' || byId('projects', s?.project_id)?.mode === 'booking';
/** Retire du mail les paragraphes qui renvoient à la fiche de renseignements ({{lien_fiche}}) */
export function withoutFiche(html){
  const TAG = /\{\{lien_fiche\}\}/, div = document.createElement('div'); div.innerHTML = String(html || '');
  const has = n => TAG.test(n.innerHTML) || TAG.test(n.getAttribute?.('href') || '');
  // le plus petit bloc (paragraphe, ligne de texte) qui contient la balise part en entier
  const blocks = [...div.querySelectorAll('div,p,li,tr,h1,h2,h3,h4,blockquote')].filter(has);
  blocks.filter(b => !blocks.some(o => o !== b && b.contains(o))).forEach(b => b.remove());
  return div.innerHTML.replace(/<a[^>]*\{\{lien_fiche\}\}[^>]*>.*?<\/a>/gi, '').replace(/\{\{lien_fiche\}\}/g, '');
}

function confChecks(s, booking=false){
  const pays = S.db.show_payments.filter(p => p.show_id === s.id && ['acompte','solde'].includes(p.kind)).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const miss = [];
  if (s.fee_ht == null) miss.push('le cachet HT');
  if (!s.contract_type || s.contract_type === 'N.C') miss.push('le type de contrat');
  if (!s.structure_id) miss.push('la structure');
  if (!pays.length) miss.push('les acomptes');
  const vat = s.vat_rate ?? 5.5;
  return `<div class="conf-check ${miss.length?'warn':''}">
    <b>À vérifier avant d’envoyer</b>
    <div>${esc(s.contract_type||'Contrat ?')} · ${s.fee_ht!=null?`${Number(s.fee_ht).toLocaleString('fr-FR')} € HT · TVA ${String(vat).replace('.',',')} %`:'cachet ?'}
      · ${pays.map(p=>`${esc(p.label||p.kind)} ${p.pct!=null?esc(String(p.pct).replace('.',','))+' %':''}`).join(' · ') || 'aucun acompte'}</div>
    ${miss.length ? `<div class="err">Manque : ${miss.join(', ')}. Complète la date avant d’envoyer (le mail reprend ces infos).</div>` : ''}
    <div class="muted">${booking ? 'Booking uniquement : le lien de la fiche de renseignements est retiré du mail, l’organisateur et l’artiste s’arrangent entre eux pour le contrat.' : 'La fiche de renseignements affiche toujours les conditions à jour : tu peux encore les corriger après l’envoi, tant que le contrat n’est pas parti.'}</div>
  </div>`;
}

// ─────────────── Éditeur de modèles ───────────────

/** Groupes de la liste des modèles (Réglages, onglet Mails d'un artiste) restés ouverts pendant la session */
const openGroups = new Set();
document.addEventListener('toggle', e => {
  const g = e.target; if (!g.matches?.('.tpl-group')) return;
  g.open ? openGroups.add(g.dataset.kind) : openGroups.delete(g.dataset.kind);
}, true);

/** Modèles rangés par type de mail, dans des groupes dépliables (repliés par défaut) */
export function templatesList(projectId){
  const rows = S.db.mail_templates.filter(t => projectId === undefined || tplProjects(t).includes(projectId));
  if (!rows.length) return '<div class="empty">Aucun modèle pour l’instant.</div>';
  const kinds = [...Object.keys(MAIL_KINDS), ...new Set(rows.map(t => t.kind).filter(k => !MAIL_KINDS[k]))];
  const row = t => `<button type="button" class="tpl-row" data-act="editTemplate" data-id="${t.id}">
    <span class="tpl-kind">${esc(tplLabel(t))}${t.variant?` · ${esc(t.variant)}`:''}</span>
    <b>${esc(t.name||'Sans nom')}</b><span class="muted">${t.applies_to && t.applies_to !== 'all' ? esc(APPLIES[t.applies_to]) : ''}${(t.attachments||[]).length ? ` · 📎 ${(t.attachments||[]).length}` : ''}</span></button>`;
  return `<div class="tpl-groups">${kinds.map(k => {
    const list = rows.filter(t => (t.kind || 'autre') === k)
      .sort((a,b) => (tplProjects(a).length ? 1 : 0) - (tplProjects(b).length ? 1 : 0) || tplLabel(a).localeCompare(tplLabel(b)) || (a.name||'').localeCompare(b.name||''));
    if (!list.length) return '';
    return `<details class="tpl-group" data-kind="${esc(k)}" ${openGroups.has(k) ? 'open' : ''}>
      <summary><span>${esc(MAIL_KINDS[k] || k)}</span><span class="badge">${list.length}</span></summary>
      <div class="tpl-list">${list.map(row).join('')}
        <button type="button" class="btn sm ghost tpl-add" data-act="newTemplate" data-kind="${esc(k)}" ${projectId ? `data-project="${projectId}"` : ''}>+ Modèle « ${esc(MAIL_KINDS[k] || k)} »</button></div>
    </details>`;
  }).join('')}</div>`;
}

export async function editTemplate(id, defaults={}){
  const t = id ? byId('mail_templates', id) : {kind:'confirmation', applies_to:'all', subject:'', html:'', attachments:[], ...defaults};
  // balises des dates (confirmation, boucles…) ou de la structure (prospection, relance), selon le type de mail
  const tagBar = `<div class="tag-bar" role="toolbar" aria-label="Insérer une balise" data-tagset="show" ${STRUCT_KINDS.includes(t.kind)?'hidden':''}>${TAGS.map(([k,l])=>`<button type="button" class="chip-btn" data-tag="${k}" title="${esc(l)}">{{${k}}}</button>`).join('')}</div>
    <div class="tag-bar" role="toolbar" aria-label="Insérer une balise" data-tagset="struct" ${STRUCT_KINDS.includes(t.kind)?'':'hidden'}>${PROSPECT_TAGS.map(([k,l])=>`<button type="button" class="chip-btn" data-tag="${k}" title="${esc(l)}">{{${k}}}</button>`).join('')}</div>`;
  const fmtBar = rtToolbar('tpl-body');
  let files = (t.attachments || []).slice();   // [{path, name}] fichier déposé · [{id, url, name}] fichier Drive
  const variants = [...new Set(['CC', 'CC Club', 'CC Festival', 'CCR Club', ...S.db.mail_templates.map(x => x.variant).filter(Boolean)])];
  const extra = `<div class="field full"><label>Pièces jointes</label><div id="tpl-files"></div>
      <div class="vh-actions" style="margin-top:6px"><label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="tpl-up"></label>
        <input id="tpl-drive" placeholder="ou coller un lien Drive puis Entrée" style="min-width:260px"></div>
      <div class="help">Jointes au brouillon Gmail (ex. fiche technique, rider, kit promo). Tu pourras en ajouter d’autres au moment d’envoyer.</div></div>
    <div class="field full"><label>Texte du mail</label>${fmtBar}${tagBar}<div class="mail-preview" id="tpl-body" contenteditable="true" style="${rtStyle()}">${t.html||''}</div>
    <div class="help">Clique sur une balise pour l’insérer à l’endroit du curseur. Elle sera remplacée par l’info de la date. Police, taille et couleur : sélectionne le texte puis choisis dans la barre. Raccourcis : ⌘B gras, ⌘I italique, ⌘U souligné, ⌘K lien.</div></div>
    <datalist id="tpl-variants">${variants.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
    ${id ? `<div class="field full"><button type="button" class="btn sm" id="tpl-dup">Dupliquer ce modèle (pour créer une autre variante)</button></div>` : ''}`;
  const drawFiles = () => { const box = document.querySelector('#tpl-files'); if (!box) return;
    box.innerHTML = files.length ? `<ul class="doc-list">${files.map((f, i) => `<li><span>${f.path ? '📎' : '🔗'} ${esc(f.name || f.url || f.id)}</span><button type="button" class="btn icon sm ghost danger" data-rmf="${i}" aria-label="Retirer">✕</button></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Aucune pièce jointe.</p>'; };  let lastRange = null;
  const pids = tplProjects(t);
  const p = openModal({title: id ? 'Modèle de mail' : 'Nouveau modèle de mail', wide: true, values: {...t, project_ids: pids, applies_to: t.applies_to || 'all'},
    fields: [
      {k:'name', label:'Nom du modèle'},
      {k:'project_ids', label:'Artiste(s) — aucun coché = tous les artistes', type:'checks', full:true,
        options: projectOptions(true, pids).map(x => [x.id, x.name])},
      {k:'kind', label:'Type de mail', type:'select', blank:false, options:Object.entries(MAIL_KINDS)},
      {k:'variant', label:'Variante (nom libre)', placeholder:'ex. CC Club, CC Festival, CCR Club…', help:'Juste un nom pour t’y retrouver, affiché dans la liste des modèles.'},
      {k:'applies_to', label:'Proposé en premier pour', type:'select', blank:false, options:Object.entries(APPLIES), full:true,
        help:'Au moment de préparer le mail, ce modèle est choisi automatiquement pour ces dates. Les autres modèles restent disponibles dans la liste.'},
      {k:'subject', label:'Objet', full:true},
      {k:'cc', label:'En copie', full:true, placeholder:'Nom <adresse@…>, …'},
    ], extra,
    onSave: async v => {
      const ids = v.project_ids || [];
      const row = {name:v.name, project_ids: ids, project_id: ids[0] || null, kind:v.kind, variant:v.variant||null, applies_to:v.applies_to||'all', subject:v.subject||'', cc:v.cc||null,
        html: document.querySelector('#tpl-body').innerHTML, updated_at: new Date().toISOString(), attachments: files};
      if (id) return !!(await save('mail_templates', id, row));
      return !!(await insert('mail_templates', row));
    },
    onDelete: id ? () => remove('mail_templates', id) : null});
  const body = document.querySelector('#tpl-body');
  document.querySelector('#modal [name=variant]')?.setAttribute('list', 'tpl-variants');
  document.querySelector('#modal [name=kind]')?.addEventListener('change', e => { const st = STRUCT_KINDS.includes(e.target.value);
    document.querySelectorAll('#modal [data-tagset]').forEach(b => b.hidden = (b.dataset.tagset === 'struct') !== st); });
  drawFiles();
  document.querySelector('#tpl-files').addEventListener('click', e => { const b = e.target.closest('[data-rmf]'); if (b){ files.splice(Number(b.dataset.rmf), 1); drawFiles(); } });
  document.querySelector('#tpl-up').addEventListener('change', async e => {
    for (const f of e.target.files){
      const path = `modeles/${id || 'nouveau'}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const {error} = await sb.storage.from('suivi').upload(path, f, {contentType: f.type || 'application/octet-stream'});
      if (error){ toast('Envoi impossible : ' + error.message, true); continue; }
      files.push({path, name: f.name, size: f.size});
    }
    e.target.value = ''; drawFiles();
  });
  document.querySelector('#tpl-drive').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const u = e.target.value.trim(), fid = (u.match(/[-\w]{25,}/) || [''])[0];
    if (!fid) return toast('Lien Drive non reconnu', true);
    files.push({id: fid, url: u, name: 'Fichier Drive ' + fid.slice(0, 6) + '…'}); e.target.value = ''; drawFiles();
  });
  document.querySelector('#tpl-dup')?.addEventListener('click', async () => {
    const {id: _i, created_at, updated_at, ...rest} = t;
    const copy = await insert('mail_templates', {...rest, html: body.innerHTML, name: (t.name || 'Modèle') + ' (copie)'});
    if (copy){ document.querySelector('#modal').close(); toast('Copie créée : change son nom, sa variante et son texte'); editTemplate(copy.id); }
  });
  const keep = () => { const sel = getSelection(); if (sel.rangeCount && body.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange(); };
  body.addEventListener('keyup', keep); body.addEventListener('mouseup', keep); body.addEventListener('input', keep);
  document.querySelectorAll('#modal [data-tag]').forEach(b => b.onmousedown = e => {
    e.preventDefault(); body.focus();
    if (lastRange){ const sel = getSelection(); sel.removeAllRanges(); sel.addRange(lastRange); }
    document.execCommand('insertText', false, `{{${b.dataset.tag}}}`); keep();
  });
  return p;
}
