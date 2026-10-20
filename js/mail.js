/**
 * ✉️ Modèles de mail : choix du bon modèle, remplissage des balises, aperçu, brouillon Gmail.
 *
 * Les balises ({{date}}, {{cachet_ht}}…) sont calculées par la fonction SQL mail_vars(),
 * la même que celle utilisée par Apps Script pour les brouillons automatiques.
 * Le brouillon est créé dans Gmail (compte production@) par le script Apps Script
 * (réglage drive_webhook_url) ; sans lui, on copie le mail pour le coller dans Gmail.
 */
import { billPct } from './calc.js';
import { insert, remove, save, sb } from './data.js';
import { byId, contactMails, linksOfStructure, projectOptions, setting } from './selectors.js';
import { S } from './state.js';
import { openModal } from './ui/modal.js';
import { rtStyle, rtToolbar, wrapMail } from './ui/richtext.js';
import { esc, fmtDate, toast, today } from './utils.js';

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
  // script pas encore mis à jour sur production@ : on dit quoi faire
  if (!out.ok && /Action inconnue/i.test(out.error || '')) throw new Error('Le script Google de production@ n’est pas à jour. Réglages › Google : « Copier le code à jour », colle-le dans Code.gs puis redéploie (nouvelle version).');
  if (!out.ok) throw new Error(out.error || 'Erreur du script');
  return out;
}

/** Mails des dates : envoyés depuis production@, avec la signature production@ (Réglages › Prospection, signature de Chloé) */
const PROD_MAIL = 'production@lartboristerie.com';
export const prodSignature = () => setting('prospect_signature_production') || '';

/** Fenêtre « Préparer le mail » pour une date */
export async function prepareMail(showId, kind){
  const s = byId('shows', showId); if (!s) return;
  const tpls = templatesFor(s, kind);
  if (!tpls.length) return toast(`Aucun modèle « ${MAIL_KINDS[kind]} » pour cet artiste. Ajoute-le dans Réglages › Modèles de mail.`, true);
  const contacts = linksOfStructure(s.structure_id);
  let contactId = s.conf_contact_id && contacts.some(c=>c.id===s.conf_contact_id) ? s.conf_contact_id : (contacts.find(c=>contactMails(c))?.id || '');
  let vars = await mailVars(showId, contactId);
  const log = s.mail_log?.[kind];
  const booking = isBookingOnly(s);
  const checks = kind === 'confirmation' ? confChecks(s, booking) : '';
  const sig = prodSignature();
  const extra = `<div class="mail-wrap">
    ${log ? `<p class="mode-note">${log.sent ? 'Envoyé' : 'Déjà préparé'} le ${fmtDate(log.at.slice(0,10))}${log.to?` à ${esc(log.to)}`:''}${log.draft?' (brouillon Gmail)':''}.</p>` : ''}
    ${checks}
    <div class="mail-grid">
      <label for="ml-tpl">Modèle</label><select id="ml-tpl">${tpls.map(t=>`<option value="${t.id}">${esc(t.name||MAIL_KINDS[t.kind])}${tplProjects(t).length?'':' · générique'}</option>`).join('')}</select>
      <label>Envoyé par</label><span class="ml-from">${esc(PROD_MAIL)}${sig ? ' <span class="muted">· avec la signature production@</span>' : ' <span class="muted">· pas de signature (Réglages › Prospection, signature de Chloé)</span>'}</span>
      <label for="ml-contact">Destinataire</label><span class="mail-to"><select id="ml-contact"><option value="">— autre adresse —</option>${contacts.map(c=>`<option value="${c.id}" ${c.id===contactId?'selected':''}>${esc(c.display_name)}${contactMails(c)?` · ${esc(contactMails(c))}`:' (pas de mail)'}</option>`).join('')}</select>
        <input id="ml-to" type="text" inputmode="email" placeholder="adresse@exemple.fr (plusieurs : séparées par des virgules)" value="${esc(vars.contact_email||'')}"></span>
      <label for="ml-cc">Copie</label><input id="ml-cc" type="text" placeholder="Nom <adresse@…>, …">
      <label for="ml-subj">Objet</label><input id="ml-subj">
    </div>
    ${rtToolbar('ml-body')}<div class="mail-preview" id="ml-body" contenteditable="true" style="${rtStyle()}" aria-label="Texte du mail (modifiable)"></div>
    <div class="ml-att dropzone-soft"><b class="fiche-lbl">Pièces jointes</b> <span id="ml-files"></span>
      <label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="ml-up"></label>
      <span class="drop-hint">ou glisse les fichiers ici</span></div>
    <p class="help">Le texte est modifiable ici. Les zones jaunes sont à compléter. « Envoyer maintenant » l’envoie tout de suite depuis production@ et note la date d’envoi dans le suivi de la date${SENT_FIELD[kind] ? ` (${esc(stepLabel(kind))})` : ''} ; « Enregistrer en brouillon » le met dans les brouillons Gmail.</p>
    </div>`;
  let wantDraft = false;
  const dlgP = openModal({title: `${MAIL_KINDS[kind]} · ${s.venue}`, fields: [], extra, mail: true,
    saveLabel: 'Envoyer maintenant', footExtra: '<button type="button" class="btn" id="ml-draft">Enregistrer en brouillon</button>',
    onSave: async () => {
      const send = !wantDraft; wantDraft = false;
      if (!scriptUrl()){ toast('Le script Google (Apps Script) n’est pas encore installé (Réglages).', true); return false; }
      const m = current();
      if (!m.to) { toast('Indique le destinataire', true); return false; }
      if (/\[\w+ à compléter\]/.test(m.html + m.subject) && !confirm('Il reste des zones à compléter (en jaune). Continuer quand même ?')) return false;
      if (send && !confirm(`Envoyer le mail à ${m.to} maintenant ?`)) return false;
      try {
        const out = await callScript('draft', {to: m.to, cc: m.cc, subject: m.subject, html: m.html, send,
          attachments: files.filter(f => f.on).map(f => f.path ? {path: f.path, name: f.name} : {id: f.id})});
        // ancien script (pas encore redéployé) : il ne sait faire que le brouillon
        if (send && !out.sent){ await logMail(s, kind, m.to, true); toast('Le mail est dans les brouillons Gmail mais n’est pas parti : redéploie le script Google (Code.gs du jour) pour l’envoi direct.', true); return true; }
        await logMail(s, kind, m.to, !send, m);
        toast(send ? 'Mail envoyé · date d’envoi notée' : 'Brouillon créé dans Gmail', false, !send && out.url ? {label:'Ouvrir', fn: () => window.open(out.url, '_blank')} : null);
        return true;
      } catch (err) { toast(err.message, true); return false; }
    }});
  const $ = sel => document.querySelector('#modal ' + sel);
  $('#ml-draft').onclick = () => { wantDraft = true; $('form').requestSubmit(); };
  const current = () => ({to: $('#ml-to').value.trim(), cc: $('#ml-cc').value.trim(), subject: $('#ml-subj').value.trim(), html: wrapMail($('#ml-body').innerHTML)});
  // Pièces jointes : celles du modèle (cochées) + celles ajoutées pour ce mail (bouton ou glisser-déposer)
  let files = [];
  const drawFiles = () => { $('#ml-files').innerHTML = files.map((f, i) => `<label class="att-chip"><input type="checkbox" data-att="${i}" ${f.on ? 'checked' : ''}> ${f.path ? '📎' : '🔗'} ${esc(f.name || 'Fichier Drive')}</label>`).join('') || '<span class="muted">aucune</span>'; };
  const draw = () => {
    const t = byId('mail_templates', $('#ml-tpl').value);
    files = [...(t.attachments || []).map(a => ({...a, on: true})), ...files.filter(f => f.mine)]; drawFiles();
    $('#ml-cc').value = t.cc || '';
    $('#ml-subj').value = fill(t.subject, vars, false);
    // date en booking uniquement : pas de fiche de renseignements (les parties s'arrangent entre elles après le mail)
    $('#ml-body').innerHTML = fill(expandAcomptes(booking ? withoutFiche(t.html) : t.html, s), vars, true) + sig;
  };
  draw();
  $('#ml-tpl').onchange = draw;
  $('#ml-contact').onchange = async e => {
    contactId = e.target.value; vars = await mailVars(showId, contactId);
    // brouillon en cours de restauration (événement non déclenché par un clic) : on garde l'adresse, l'objet et le texte restaurés
    if (!e.isTrusted) return;
    $('#ml-to').value = vars.contact_email || ''; draw();
    if (contactId && contactId !== s.conf_contact_id) save('shows', s.id, {conf_contact_id: contactId}, {rerender:false});
  };
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
  dlgP.then(() => {});
}

function stepLabel(kind){ return {confirmation:'Conf + FT + kit envoyés', boucle_tech:'Boucle accueil & technique', boucle_com:'Boucle communication'}[kind] || ''; }

/** Mail préparé ou envoyé : noté sur la date ; envoyé = l'étape du suivi admin prend la date du jour */
async function logMail(s, kind, to, draft, mail=null){
  const fresh = byId('shows', s.id) || s;
  const patch = {mail_log: {...(fresh.mail_log||{}), [kind]: {at: new Date().toISOString(), to, draft, sent: !draft}}};
  if (!draft && SENT_FIELD[kind]) patch[SENT_FIELD[kind]] = today();
  await save('shows', s.id, patch, {rerender:false});
  // envoyé : l'échange s'ajoute aussi au journal du suivi de la date (s'il y en a un)
  if (!draft && mail && fresh.prospect_id && byId('prospects', fresh.prospect_id)){
    const d = document.createElement('div'); d.innerHTML = mail.html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n');
    await insert('prospect_logs', {prospect_id: fresh.prospect_id, date: today(), kind: 'Mail', contact_name: to, author: S.user?.email,
      body: `**${MAIL_KINDS[kind] || 'Mail'} envoyée** · ${fresh.venue || ''}\n**Objet :** ${mail.subject}\n\n${d.textContent.replace(/\n{3,}/g, '\n\n').trim()}`, body_html: mail.html});
  }
}

/** À vérifier avant la confirmation : cachet, TVA, contrat, acomptes */
/** Date en booking uniquement (date cochée, ou artiste « booking seul ») */
export const isBookingOnly = s => (s?.prod_mode || byId('projects', s?.project_id)?.mode) === 'booking';   // le mode de la date prime sur celui de l'artiste
/**
 * Plusieurs acomptes : la ligne du modèle qui contient {{acompte_pct}} est répétée, une par acompte,
 * avec son % et son échéance (« à la signature du contrat » pour le 1er, « le 15 janvier 2027 »… pour les suivants).
 */
export function expandAcomptes(html, s){
  const acs = S.db.show_payments.filter(p => p.show_id === s.id && p.kind === 'acompte').sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const TAG = '{{acompte_pct}}', FIRST = 'à la signature du contrat';
  if (!acs.length || !String(html || '').includes(TAG)) return html;
  if (acs.length === 1 && (!acs[0].due_label || acs[0].due_label === FIRST)) return html;   // cas simple : le modèle tel quel
  const pctTxt = p => { const v = billPct(p); return v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ',') + '%'; };
  const div = document.createElement('div'); div.innerHTML = String(html);
  const blocks = [...div.querySelectorAll('div,p,li')].filter(b => b.innerHTML.includes(TAG));
  const block = blocks.find(b => !blocks.some(o => o !== b && b.contains(o)));
  const line = (p, i) => {
    const due = p.due_label || (i === 0 ? FIRST : '');
    let h = block.outerHTML.replace(TAG, esc(pctTxt(p)));
    if (h.includes(FIRST)) h = h.replace(FIRST, esc(due));
    else if (due && due !== FIRST) h = h.replace(esc(pctTxt(p)), esc(pctTxt(p)) + ' ' + esc(due));
    return h;
  };
  if (!block) return html.replace(TAG, acs.map((p, i) => `${pctTxt(p)} ${p.due_label || (i === 0 ? FIRST : '')}`.trim()).join(', '));
  block.insertAdjacentHTML('afterend', acs.map(line).join(''));
  block.remove();
  return div.innerHTML;
}

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
  if (!booking && !pays.length) miss.push('les acomptes');
  const vat = s.vat_rate ?? 5.5, pc = p => { const v = billPct(p); return v == null ? '' : (Math.round(v * 100) / 100).toLocaleString('fr-FR') + ' %'; };
  return `<div class="conf-check ${miss.length?'warn':''}">
    <b>${s.terms_validated_at ? `Conditions validées le ${fmtDate(s.terms_validated_at.slice(0,10))}` : 'Conditions reprises dans le mail'}</b>
    <div>${esc(s.contract_type||'Contrat ?')} · ${s.fee_ht!=null?`${Number(s.fee_ht).toLocaleString('fr-FR')} € HT · TVA ${String(vat).replace('.',',')} %`:'cachet ?'}
      ${booking ? '' : '· ' + (pays.map(p=>`${esc(p.label||p.kind)} ${pc(p)}`).join(' · ') || 'aucun acompte')}</div>
    ${miss.length ? `<div class="err">Manque : ${miss.join(', ')}. Ferme ce mail et valide les conditions de la date (le mail reprend ces infos).</div>` : ''}
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
      <div class="vh-actions mt-sm"><label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="tpl-up"></label>
        <input id="tpl-drive" placeholder="ou coller un lien Drive puis Entrée" style="min-width:260px"></div>
      <div class="help">Jointes au brouillon Gmail (ex. fiche technique, rider, kit promo). Tu pourras en ajouter d’autres au moment d’envoyer.</div></div>
    <div class="field full"><label>Texte du mail</label>${fmtBar}${tagBar}<div class="mail-preview" id="tpl-body" contenteditable="true" style="${rtStyle()}">${t.html||''}</div>
    <div class="help">Clique sur une balise pour l’insérer à l’endroit du curseur. Elle sera remplacée par l’info de la date. Police, taille et couleur : sélectionne le texte puis choisis dans la barre. Raccourcis : ⌘B gras, ⌘I italique, ⌘U souligné, ⌘K lien.</div></div>
    <datalist id="tpl-variants">${variants.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
    ${id ? `<div class="field full"><button type="button" class="btn sm" id="tpl-dup">Dupliquer ce modèle (pour créer une autre variante)</button></div>` : ''}`;
  const drawFiles = () => { const box = document.querySelector('#tpl-files'); if (!box) return;
    box.innerHTML = files.length ? `<ul class="doc-list">${files.map((f, i) => `<li><span>${f.path ? '📎' : '🔗'} ${esc(f.name || f.url || f.id)}</span><button type="button" class="btn icon sm ghost danger" data-rmf="${i}" aria-label="Retirer">✕</button></li>`).join('')}</ul>` : '<p class="muted m0">Aucune pièce jointe.</p>'; };  let lastRange = null;
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
