/**
 * ✉️ Modèles de mail : choix du bon modèle, remplissage des balises, aperçu, brouillon Gmail.
 *
 * Les balises ({{date}}, {{cachet_ht}}…) sont calculées par la fonction SQL mail_vars(),
 * la même que celle utilisée par Apps Script pour les brouillons automatiques.
 * Le brouillon est créé dans Gmail (compte production@) par le script Apps Script
 * (réglage drive_webhook_url) ; sans lui, on copie le mail pour le coller dans Gmail.
 */
import { insert, remove, save, sb } from './data.js';
import { byId, linksOfStructure, setting } from './selectors.js';
import { S } from './state.js';
import { openModal } from './ui/modal.js';
import { esc, fmtDate, toast } from './utils.js';

export const MAIL_KINDS = { confirmation: 'Confirmation', boucle_tech: 'Boucle accueil & technique', boucle_com: 'Boucle communication', autre: 'Autre' };
/** Quand un modèle est proposé en premier (la variante, elle, n'est qu'un nom libre : CC Club, CC Festival…) */
export const APPLIES = { all: 'Toutes les dates', salle: 'Dates en salle (Confirmée Salle)', festival: 'Festivals (Confirmée Festival)', cr: 'Co-réalisations', cession: 'Cessions' };
const applies = (rule, s) => ({ all: true, salle: /Salle/.test(s.status || ''), festival: /Festival/.test(s.status || ''),
  cr: s.contract_type === 'Co-Réalisation', cession: s.contract_type === 'Cession' })[rule || 'all'] ?? true;
/** Étape de suivi remplie quand le mail est noté « envoyé » */
export const SENT_FIELD = { confirmation: 'conf_kit_sent', boucle_tech: 'boucle_tech', boucle_com: 'boucle_com' };
export const TAGS = [
  ['artiste','Artiste'], ['date','Date courte (Sam 17 octobre 2026)'], ['date_longue','Date longue (Samedi 17 octobre 2026)'],
  ['ville','Ville'], ['cp','Code postal'], ['lieu','Salle / festival'], ['adresse','Adresse du lieu'], ['jauge','Jauge'],
  ['cachet_ht','Cachet HT'], ['cachet_ttc','Cachet TTC'], ['tva','TVA'], ['type_contrat','Type de contrat'], ['acompte_pct','% d’acompte'],
  ['contact','Prénom du destinataire'], ['structure','Structure'], ['lien_fiche','Lien de la fiche de renseignements'],
  ['personnes','Personnes sur la route'], ['chambres','Chambres (single / twin)'], ['montage','Mise à disposition (heures)'], ['invitations','Invitations producteur'],
];

/**
 * Modèles possibles pour une date, le plus adapté en premier :
 * celui de l'artiste avant le générique, puis celui dont la règle correspond (co-réalisation, festival, salle…)
 * avant « toutes les dates ». Les autres restent proposés dans la liste.
 */
export function templatesFor(s, kind){
  const all = S.db.mail_templates.filter(t => t.kind === kind && (t.project_id === s.project_id || !t.project_id));
  const score = t => (t.project_id === s.project_id ? 10 : 0) + (!applies(t.applies_to, s) ? -20 : (t.applies_to && t.applies_to !== 'all' ? 5 : 0));
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
  const checks = kind === 'confirmation' ? confChecks(s) : '';
  const extra = `<div class="mail-wrap">
    ${log ? `<p class="mode-note">Déjà préparé le ${fmtDate(log.at.slice(0,10))}${log.to?` pour ${esc(log.to)}`:''}${log.draft?' (brouillon Gmail)':''}.</p>` : ''}
    ${checks}
    <div class="mail-grid">
      <label for="ml-tpl">Modèle</label><select id="ml-tpl">${tpls.map(t=>`<option value="${t.id}">${esc(t.name||MAIL_KINDS[t.kind])}${t.project_id?'':' · générique'}</option>`).join('')}</select>
      <label for="ml-contact">Destinataire</label><span class="mail-to"><select id="ml-contact"><option value="">— autre adresse —</option>${contacts.map(c=>`<option value="${c.id}" ${c.id===contactId?'selected':''}>${esc(c.display_name)}${c.email?` · ${esc(c.email)}`:' (pas de mail)'}</option>`).join('')}</select>
        <input id="ml-to" type="email" placeholder="adresse@exemple.fr" value="${esc(vars.contact_email||'')}"></span>
      <label for="ml-cc">Copie</label><input id="ml-cc">
      <label for="ml-subj">Objet</label><input id="ml-subj">
    </div>
    <div class="mail-preview" id="ml-body" contenteditable="true" aria-label="Texte du mail (modifiable)"></div>
    <div class="ml-att"><b class="fiche-lbl">Pièces jointes</b> <span id="ml-files"></span>
      <label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="ml-up"></label></div>
    <p class="help">Le texte est modifiable ici avant de créer le brouillon. Les zones jaunes sont à compléter.${scriptUrl()?'':' Le script Google n’est pas encore installé : « Copier le mail » puis colle-le dans un nouveau mail Gmail.'}</p>
    <label class="check-line"><input type="checkbox" id="ml-sent"> Noter « envoyé » aujourd’hui (${esc(SENT_FIELD[kind] ? stepLabel(kind) : '')})</label>
    <div class="vh-actions" style="margin-top:10px">
      <button type="button" class="btn" id="ml-copy">Copier le mail</button>
      <a class="btn" id="ml-gmail" target="_blank" rel="noopener">Ouvrir Gmail</a>
    </div></div>`;
  const dlgP = openModal({title: `${MAIL_KINDS[kind]} · ${s.venue}`, fields: [], extra, wide: true,
    saveLabel: scriptUrl() ? 'Créer le brouillon Gmail' : 'Fermer',
    onSave: async () => {
      if (!scriptUrl()) return true;
      const m = current();
      if (!m.to) { toast('Indique le destinataire', true); return false; }
      try {
        const tpl = byId('mail_templates', $('#ml-tpl').value);
        const out = await callScript('draft', {to: m.to, cc: m.cc, subject: m.subject, html: m.html,
          attachments: files.filter(f => f.on).map(f => f.path ? {path: f.path, name: f.name} : {id: f.id})});
        await logMail(s, kind, m.to, true);
        toast('Brouillon créé dans Gmail', false, out.url ? {label:'Ouvrir', fn: () => window.open(out.url, '_blank')} : null);
        return true;
      } catch (err) { toast(err.message, true); return false; }
    }});
  const $ = sel => document.querySelector('#modal ' + sel);
  const current = () => ({to: $('#ml-to').value.trim(), cc: $('#ml-cc').value.trim(), subject: $('#ml-subj').value.trim(), html: $('#ml-body').innerHTML});
  // Pièces jointes : celles du modèle (cochées) + celles ajoutées pour ce mail
  let files = [];
  const drawFiles = () => { $('#ml-files').innerHTML = files.map((f, i) => `<label class="att-chip"><input type="checkbox" data-att="${i}" ${f.on ? 'checked' : ''}> ${f.path ? '📎' : '🔗'} ${esc(f.name || 'Fichier Drive')}</label>`).join('') || '<span class="muted">aucune</span>'; };
  const draw = () => {
    const t = byId('mail_templates', $('#ml-tpl').value);
    files = [...(t.attachments || []).map(a => ({...a, on: true})), ...files.filter(f => f.mine)]; drawFiles();
    $('#ml-cc').value = t.cc || '';
    $('#ml-subj').value = fill(t.subject, vars, false);
    $('#ml-body').innerHTML = fill(t.html, vars, true);
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
function confChecks(s){
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
    <div class="muted">La fiche de renseignements affiche toujours les conditions à jour : tu peux encore les corriger après l’envoi, tant que le contrat n’est pas parti.</div>
  </div>`;
}

// ─────────────── Éditeur de modèles ───────────────

export function templatesList(projectId){
  const rows = S.db.mail_templates.filter(t => projectId === undefined || t.project_id === projectId)
    .sort((a,b)=>(projLabel(a.project_id)).localeCompare(projLabel(b.project_id)) || (a.kind||'').localeCompare(b.kind||'') || (a.name||'').localeCompare(b.name||''));
  if (!rows.length) return '<div class="empty">Aucun modèle pour l’instant.</div>';
  return `<div class="tpl-list">${rows.map(t=>`<button type="button" class="tpl-row" data-act="editTemplate" data-id="${t.id}">
    <span class="tpl-kind">${esc(MAIL_KINDS[t.kind]||t.kind)}${t.variant?` · ${esc(t.variant)}`:''}</span>
    <b>${esc(t.name||'Sans nom')}</b><span class="muted">${esc(projLabel(t.project_id))}${t.applies_to && t.applies_to !== 'all' ? ` · ${esc(APPLIES[t.applies_to])}` : ''}${(t.attachments||[]).length ? ` · 📎 ${(t.attachments||[]).length}` : ''}</span></button>`).join('')}</div>`;
}
const projLabel = id => id ? (byId('projects', id)?.name || '?') : 'Tous les artistes (générique)';

export async function editTemplate(id, defaults={}){
  const t = id ? byId('mail_templates', id) : {kind:'confirmation', applies_to:'all', subject:'', html:'', attachments:[], ...defaults};
  const tagBar = `<div class="tag-bar" role="toolbar" aria-label="Insérer une balise">${TAGS.map(([k,l])=>`<button type="button" class="chip-btn" data-tag="${k}" title="${esc(l)}">{{${k}}}</button>`).join('')}</div>`;
  const fmtBar = `<div class="tag-bar"><button type="button" class="chip-btn" data-cmd="bold"><b>G</b></button><button type="button" class="chip-btn" data-cmd="italic"><i>I</i></button><button type="button" class="chip-btn" data-cmd="underline"><u>S</u></button><button type="button" class="chip-btn" data-cmd="createLink">Lien</button><button type="button" class="chip-btn" data-cmd="removeFormat">Sans mise en forme</button></div>`;
  let files = (t.attachments || []).slice();   // [{path, name}] fichier déposé · [{id, url, name}] fichier Drive
  const variants = [...new Set(['CC', 'CC Club', 'CC Festival', 'CCR Club', ...S.db.mail_templates.map(x => x.variant).filter(Boolean)])];
  const extra = `<div class="field full"><label>Pièces jointes</label><div id="tpl-files"></div>
      <div class="vh-actions" style="margin-top:6px"><label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="tpl-up"></label>
        <input id="tpl-drive" placeholder="ou coller un lien Drive puis Entrée" style="min-width:260px"></div>
      <div class="help">Jointes au brouillon Gmail (ex. fiche technique, rider, kit promo). Tu pourras en ajouter d’autres au moment d’envoyer.</div></div>
    <div class="field full"><label>Texte du mail</label>${fmtBar}${tagBar}<div class="mail-preview" id="tpl-body" contenteditable="true">${t.html||''}</div>
    <div class="help">Clique sur une balise pour l’insérer à l’endroit du curseur. Elle sera remplacée par l’info de la date.</div></div>
    <datalist id="tpl-variants">${variants.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
    ${id ? `<div class="field full"><button type="button" class="btn sm" id="tpl-dup">Dupliquer ce modèle (pour créer une autre variante)</button></div>` : ''}`;
  const drawFiles = () => { const box = document.querySelector('#tpl-files'); if (!box) return;
    box.innerHTML = files.length ? `<ul class="doc-list">${files.map((f, i) => `<li><span>${f.path ? '📎' : '🔗'} ${esc(f.name || f.url || f.id)}</span><button type="button" class="btn icon sm ghost danger" data-rmf="${i}" aria-label="Retirer">✕</button></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Aucune pièce jointe.</p>'; };  let lastRange = null;
  const p = openModal({title: id ? 'Modèle de mail' : 'Nouveau modèle de mail', wide: true, values: {...t, applies_to: t.applies_to || 'all'},
    fields: [
      {k:'name', label:'Nom du modèle'},
      {k:'project_id', label:'Artiste', type:'project', allLabel:'Tous les artistes (générique)'},
      {k:'kind', label:'Type de mail', type:'select', blank:false, options:Object.entries(MAIL_KINDS)},
      {k:'variant', label:'Variante (nom libre)', placeholder:'ex. CC Club, CC Festival, CCR Club…', help:'Juste un nom pour t’y retrouver, affiché dans la liste des modèles.'},
      {k:'applies_to', label:'Proposé en premier pour', type:'select', blank:false, options:Object.entries(APPLIES), full:true,
        help:'Au moment de préparer le mail, ce modèle est choisi automatiquement pour ces dates. Les autres modèles restent disponibles dans la liste.'},
      {k:'subject', label:'Objet', full:true},
      {k:'cc', label:'En copie', full:true, placeholder:'Nom <adresse@…>, …'},
    ], extra,
    onSave: async v => {
      const row = {name:v.name, project_id:v.project_id||null, kind:v.kind, variant:v.variant||null, applies_to:v.applies_to||'all', subject:v.subject||'', cc:v.cc||null,
        html: document.querySelector('#tpl-body').innerHTML, updated_at: new Date().toISOString(), attachments: files};
      if (id) return !!(await save('mail_templates', id, row));
      return !!(await insert('mail_templates', row));
    },
    onDelete: id ? () => remove('mail_templates', id) : null});
  const body = document.querySelector('#tpl-body');
  document.querySelector('#modal [name=variant]')?.setAttribute('list', 'tpl-variants');
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
  document.querySelectorAll('#modal [data-cmd]').forEach(b => b.onmousedown = e => {
    e.preventDefault(); body.focus();
    if (lastRange){ const sel = getSelection(); sel.removeAllRanges(); sel.addRange(lastRange); }
    const c = b.dataset.cmd; document.execCommand(c, false, c === 'createLink' ? prompt('Adresse du lien (https://…)') || '' : null); keep();
  });
  return p;
}
