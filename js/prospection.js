/**
 * 📣 Prospection depuis une structure : mail préparé à partir d'un modèle « Prospection » (balises de la structure),
 * créé en brouillon ou envoyé depuis le Gmail de la personne qui prospecte (script « Prospection », compte anthony@).
 * Ensuite, automatiquement : suivi (statut Mailed), mail dans le journal, artistes, date en « Intérêt » si une date est proposée,
 * tâche Booking de relance à J+10 (délai réglable : Réglages › Délais et automatismes, v1.64).
 * « Relance » : réponse dans le même fil Gmail (l'historique reste), journal, nouvelle tâche de relance.
 */
import { ask, confirmAsk } from './ui/dialog.js';
import { render } from './app.js';
import { contentTypeOf, insert, legacyMailOwner, legacyUnverifiedOk, mailAttachedTo, mailParts, mailPartsMissing, purgeStored, remove, save, sb, signedUrl, typedFile, uploadFiles } from './data.js';
import { showPrefillFromStructure } from './forms.js';
import { PROSPECT_TAGS, attOk, attSizeHTML, callGoogle, callScript, fill, todoOk, tplLabel, tplProjects } from './mail.js';
import { suiviClosed, byId, byUsage, contactMails, eventsOfStructure, filesOf, linksOfStructure, logsOf, placeOfEvent, projIds, projName, prospectTitle, prospectsOfStructure, setting, structName } from './selectors.js';
import { S, touch } from './state.js';
import { geocode } from './geo.js';
import { CONFIRMED_PROD } from './constants.js';
import { MSG_RAW_MAX, msgIdOk, readEml } from './eml.js';
import { recipientsField, syncChips } from './ui/recipients.js';
import { dateInput } from './ui/datefield.js';
import { openModal } from './ui/modal.js';
import { rtStyle, rtToolbar, wrapMail } from './ui/richtext.js';
import { esc, firstName, fmtDate, toast, today, workDay, dayOf, addDays } from './utils.js';
import { taskDelay } from './reminders.js';

// délai de la relance (10 j par défaut) et nombre de relances par mail avant le téléphone (3 par défaut) : Réglages (v1.64)
const relanceDays = () => taskDelay('prospect_relance_days');
const mailRelances = () => taskDelay('prospect_relance_max');
const relanceOn = () => taskDelay('prospect_relance_on');   // tâches de relance désactivables (décision d'Anthony du 09/11) — jamais un envoi
const DRAFT_MARK = ' _(brouillon, pas encore envoyé)_';
const longDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}) : '';
const plain = html => { const d = document.createElement('div'); d.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n'); return d.textContent.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim(); };
const andList = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1];
const isFestival = st => (st.tags || []).some(t => /festival/i.test(t)) || eventsOfStructure(st.id).some(e => e.kind === 'Festival');

/** Adresse du script « Prospection » (Gmail du prospecteur) */
const scriptUrl = () => String(setting('prospect_script_url') || '').trim();
/** Boîtes d'envoi : anthony@ (script Prospection) ou production@ (script Google principal) */
export const SENDERS = {anthony: 'Anthony (anthony@)', production: 'Production (production@)'};
const PROD_MAIL = 'production@lartboristerie.com';
const signatureOf = acct => setting(acct === 'production' ? 'prospect_signature_production' : 'prospect_signature') || '';
const defaultSender = () => S.user?.email === PROD_MAIL ? 'production' : 'anthony';
export async function callProspect(action, payload, account='anthony'){
  if (account === 'production') return callScript('prospect_' + action, payload);
  if (!scriptUrl()) throw new Error('Le script de prospection n’est pas encore installé : Réglages › Prospection.');
  const out = await callGoogle('prospect', action, payload);   // relais serveur : le code secret ne passe plus par le navigateur (v1.47)
  if (!out.ok) throw new Error(out.error || 'Erreur du script de prospection');
  return out;
}

/** Balises d'un mail de prospection : infos de la structure, de son festival / sa salle, des artistes choisis */
/** Concert choisi pour une invitation : balises {{date_concert}}, {{ville_concert}}, {{lieu_concert}}… */
function concertVars(show){
  if (!show) return {};
  const proj = byId('projects', show.project_id), links = (proj?.links || []).filter(l => l?.url);
  const pro = links.find(l => /pro/i.test(l.label || '')) || links[0];
  const iso = addDays(show.date, -2);   // fonction officielle (§1.6)
  const [y, m, j] = show.date.split('-');
  return {artiste: proj ? projName(proj.id) : undefined, date_concert: longDate(show.date), date_concert_court: `${j}/${m}/${y.slice(2)}`, ville_concert: show.city || structById(show.structure_id)?.city || '', cp_concert: show.department || '',
    lieu_concert: String(show.venue || '').replace(/\*\*/g, '').trim(), date_reponse: longDate(iso), lien_projet: pro?.url || '',
    lien_evenement: show.ticketing_url || show.facebook_url || show.instagram_url || ''};
}
const structById = id => id ? byId('structures', id) : null;
/** Dates confirmées à venir des artistes choisis (pour inviter un programmateur) */
const concertsOf = pids => S.db.shows.filter(s => !s.archived_at && pids.includes(s.project_id) && CONFIRMED_PROD.includes(s.status) && s.date >= today())
  .sort((a, b) => a.date.localeCompare(b.date));
const CONCERT_TAGS = /\{\{(date_concert|date_concert_court|ville_concert|cp_concert|lieu_concert|date_reponse|lien_projet|lien_evenement)\}\}/;

export function prospectVars(st, {pids=[], contact=null, date=null, show=null}={}){
  const ev = eventsOfStructure(st.id).find(e => e.date_start && e.date_start >= today()) || eventsOfStructure(st.id)[0];
  const evDates = ev?.date_start ? (ev.date_end && ev.date_end !== ev.date_start ? `du ${fmtDate(ev.date_start)} au ${fmtDate(ev.date_end)}` : fmtDate(ev.date_start)) : (ev?.period || '');
  return {
    contact: firstName(contact),
    structure: st.name, artiste: andList(pids.map(projName)),
    ville: st.city || ev?.city || '', cp: st.department_code || (st.country && st.country !== 'France' ? st.country : ''),
    festival: ev?.name || st.name, dates_festival: evDates, jauge: ev?.capacity ? String(ev.capacity) : '',
    date_proposee: longDate(date), annee: date ? date.slice(0, 4) : String(new Date().getFullYear() + 1),
    ...Object.fromEntries(Object.entries(concertVars(show)).filter(([, v]) => v !== undefined)),   // invitation : l'artiste du concert choisi
  };
}

/**
 * Fenêtre de prospection (structureId) ou de relance ({prospectId}).
 */
export async function openProspection(structureId, {prospectId=null}={}){
  const p = prospectId ? byId('prospects', prospectId) : null;
  const relance = !!p;
  const st = byId('structures', structureId || p?.structure_id); if (!st) return;
  // structure inactive (v1.54) : plus proposée par défaut ; on demande avant d'écrire
  if (st.inactive_at && !(await confirmAsk('Structure inactive', `« ${st.name} » est marquée inactive (fermée). Préparer quand même ce mail ?`, 'Continuer'))) return;
  if (relance && !p.mail_thread_id) return toast('Ce suivi n’a pas de mail de prospection envoyé depuis la Matrice', true);
  if (relance && !p.mail_sent_at){
    await checkProspect(p, true);
    if (!byId('prospects', p.id).mail_sent_at) return toast('Le mail de prospection est encore en brouillon dans Gmail : envoie-le d’abord, puis relance.', true);
  }
  const kind = relance ? 'relance' : 'prospection';
  const contacts = linksOfStructure(st.id);
  const active = S.db.projects.filter(x => x.active).sort(byUsage);
  // artiste(s) du mail : choisis explicitement dans la fenêtre — jamais repris du filtre d'affichage (v1.53, décision d'Anthony :
  // un artiste choisi dans Production ne doit pas partir implicitement dans une prospection) ; une relance garde ceux du suivi
  let pids = relance ? projIds(p) : [];
  const filterName = !relance && S.project ? byId('projects', S.project)?.name : null;
  let contact = relance ? contacts.find(c => p.mail_to && [c.email, c.email_2].some(e => e && p.mail_to.toLowerCase().includes(e.toLowerCase()))) : contacts.find(c => contactMails(c));
  // tous les modèles du type : ceux des artistes cochés d'abord, puis les génériques, puis les autres (choisir un modèle coche ses artistes)
  const rank = t => { const ids = tplProjects(t); return ids.some(id => pids.includes(id)) ? 0 : !ids.length ? 1 : 2; };
  const tplsFor = () => S.db.mail_templates.filter(t => t.kind === kind)
    .sort((a, b) => rank(a) - rank(b) || (a.name || '').localeCompare(b.name || ''));
  let sender = relance ? (p.mail_account || 'anthony') : defaultSender();
  const fromAddr = () => sender === 'production' ? PROD_MAIL : (setting('prospect_from') || 'anthony@lartboristerie.com');

  const extra = `<div class="mail-wrap">
    ${relance ? `<p class="mode-note">Réponse dans le fil « ${esc(p.mail_subject || '')} » envoyé à ${esc(p.mail_to || '')}${p.mail_sent_at ? ` le ${fmtDate(p.mail_sent_at)}` : ''} : l’historique reste en dessous du mail.</p>` : ''}
    ${relance ? '' : `<p class="mode-note" id="pr-art-note">Coche le ou les artistes concernés par ce mail${filterName ? ` (le filtre d’affichage « ${esc(filterName)} » n’est pas repris d’office)` : ''}.</p>`}
    <div class="mail-grid">
      <label>Artiste(s)</label><div class="checks pills pr-arts">${active.map(a => `<label><input type="checkbox" data-pr-art="${a.id}" ${pids.includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>
      <label for="pr-from">Envoyé par</label><select id="pr-from" ${relance ? 'disabled title="La relance part de la boîte qui a envoyé la prospection"' : ''}>${Object.entries(SENDERS).map(([k, l]) => `<option value="${k}" ${k === sender ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label for="pr-tpl">Modèle</label><select id="pr-tpl"></select>
      <label for="pr-show" class="pr-concert" hidden>Concert</label><span class="pr-concert" hidden><select id="pr-show"></select><small class="muted">remplit la date, la ville, le lieu, la date limite de réponse et les liens</small></span>
      <label for="pr-contact" class="rcpt-who">Interlocuteur</label><span class="mail-to rcpt-who"><select id="pr-contact"><option value="">— autre adresse —</option>${contacts.map(c => `<option value="${c.id}" ${c.id === contact?.id ? 'selected' : ''}>${esc(c.display_name)}${contactMails(c) ? ` · ${esc(contactMails(c))}` : ' (pas de mail)'}</option>`).join('')}</select>
        <small class="muted">personne à qui l’on s’adresse (prénom et balises du mail) ; la choisir remplace le destinataire</small><span class="rcpt-propose"></span></span>
      <label for="pr-to-q">Destinataire</label>${recipientsField('pr-to', st.id, {value: relance ? (p.mail_to || '') : contactMails(contact), prospection: true, label: 'Destinataires', interlocutor: 'pr-contact'})}
      <label for="pr-cc-q">Copie</label>${recipientsField('pr-cc', st.id, {prospection: true, label: 'Copies'})}
      ${relance ? '' : `<label for="pr-subj">Objet</label><input id="pr-subj">
      <label>Date proposée</label><span class="pr-date">${dateInput('', 'id="pr-date"')}<small class="muted">facultatif : crée la date en « Intérêt » pour chaque artiste</small></span>`}
    </div>
    ${rtToolbar('pr-body')}<div class="mail-preview" id="pr-body" contenteditable="true" style="${rtStyle()}" aria-label="Texte du mail (modifiable)"></div>
    <div class="ml-att"><b class="fiche-lbl">Pièces jointes</b> <span id="pr-files"></span>
      <label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="pr-up"></label></div>
    <p class="help">Envoyé depuis <b id="pr-from-addr">${esc(fromAddr())}</b>. « Enregistrer en brouillon » le met dans les brouillons Gmail ; « Envoyer maintenant » l’envoie tout de suite.
      Dans les deux cas : ${relance ? `le journal du suivi est complété (avec les dates des relances précédentes) et ${!relanceOn() ? 'aucune tâche de relance n’est créée (désactivée dans Réglages › Délais et automatismes).' : (p.relances || 0) + 1 >= mailRelances() ? 'comme c’est la ' + mailRelances() + 'e relance par mail, la tâche suivante est une relance par téléphone.' : `une nouvelle tâche de relance est créée à J+${relanceDays()}.`}` : `un suivi est créé (Mailed) avec le mail dans le journal, la date proposée en « Intérêt »${relanceOn() ? `, et une tâche Booking de relance à J+${relanceDays()}` : ' ; aucune tâche de relance (désactivée dans Réglages › Délais et automatismes)'}.`}</p>
    </div>`;

  let wantDraft = false, dirty = false, files = [];
  const done = openModal({title: `${relance ? `Relance n°${(p.relances || 0) + 1}` : 'Prospection'} · ${st.name}`, fields: [], extra, mail: true, saveLabel: 'Envoyer maintenant', footExtra: '<button type="button" class="btn" id="pr-draft">Enregistrer en brouillon</button>',
    onSave: async () => {
      const m = current();
      // bouton principal « Envoyer maintenant », ou « Enregistrer en brouillon »
      const send = !wantDraft; wantDraft = false;
      if (!m.to) { toast('Indique le destinataire', true); return false; }
      if (!pids.length) { toast('Coche au moins un artiste', true); return false; }
      if (!relance && !m.subject) { toast('Indique l’objet du mail', true); return false; }
      // délivrabilité (v1.52) : zones « à compléter » restées, pièces jointes lourdes
      if (!(await todoOk(m))) return false;
      if (!(await attOk(files))) return false;
      if (send && !(await confirmAsk('Envoyer le mail ?', `Le mail part maintenant à ${m.to}${m.cc ? ` (copie : ${m.cc})` : ''}, depuis ${fromAddr()}.`, 'Envoyer le mail'))) return false;
      try {
        const attachments = await Promise.all(files.filter(f => f.on).map(async f => f.id ? {id: f.id} : {url: await signedUrl(f.path), name: f.name}));
        const out = relance
          ? await callProspect('reply', {thread_id: p.mail_thread_id, to: m.to, cc: m.cc, html: m.html, send, attachments}, sender)
          : await callProspect('mail', {to: m.to, cc: m.cc, subject: m.subject, html: m.html, send, attachments}, sender);
        if (relance) await recordRelance(p, st, {...m, send, out, contact});
        else await recordProspection(st, {...m, send, out, pids, contact, date: m.date, account: sender});
        toast(send ? 'Mail envoyé' : 'Brouillon créé dans Gmail', false, out.url && !send ? {label: 'Ouvrir', fn: () => window.open(out.url, '_blank')} : null);
        return true;
      } catch (err) { toast(err.message, true); return false; }
    }});
  const $ = sel => document.querySelector('#modal ' + sel);
  const current = () => ({to: $('#pr-to').value.trim(), cc: $('#pr-cc').value.trim(), subject: $('#pr-subj')?.value.trim() || '', html: wrapMail($('#pr-body').innerHTML), date: $('#pr-date')?.value || null});
  const drawFiles = () => { $('#pr-files').innerHTML = files.length ? attSizeHTML(files) + ' ' + files.map((f, i) => `<label class="att-chip"><input type="checkbox" data-att="${i}" ${f.on ? 'checked' : ''}> ${f.path ? '📎' : '🔗'} ${esc(f.name || 'Fichier Drive')}</label>`).join('') : '<span class="muted">aucune</span>'; };
  const drawTpls = () => {
    const list = tplsFor(), cur = $('#pr-tpl').value;
    const grp = {0: 'Artistes cochés', 1: 'Tous les artistes', 2: 'Autres artistes'};
    $('#pr-tpl').innerHTML = [0, 1, 2].map(r => { const g = list.filter(t => rank(t) === r); return g.length ? `<optgroup label="${grp[r]}">${g.map(t => `<option value="${t.id}">${esc(t.name || 'Modèle')}${tplProjects(t).length && r !== 0 ? ' · ' + esc(tplLabel(t)) : ''}</option>`).join('')}</optgroup>` : ''; }).join('')
      || '<option value="">Aucun modèle : Réglages › Modèles de mail</option>';
    if (list.some(t => t.id === cur)) $('#pr-tpl').value = cur;
  };
  // remplit l'objet et le texte depuis le modèle (sauf si le texte a déjà été retouché à la main)
  const drawConcerts = () => {
    const t = byId('mail_templates', $('#pr-tpl').value), need = t && CONCERT_TAGS.test((t.subject || '') + (t.html || ''));
    document.querySelectorAll('#modal .pr-concert').forEach(x => x.hidden = !need);
    if (!need) return;
    const list = concertsOf(pids), cur = $('#pr-show').value;
    $('#pr-show').innerHTML = list.map(s => `<option value="${s.id}">${esc(projName(s.project_id))} · ${fmtDate(s.date)} · ${esc(String(s.venue || '').replace(/\*\*/g, ''))}${s.city ? ' (' + esc(s.city) + ')' : ''}</option>`).join('')
      || '<option value="">Aucune date confirmée à venir pour ces artistes</option>';
    if (list.some(s => s.id === cur)) $('#pr-show').value = cur;
  };
  const draw = (force=false) => {
    drawConcerts();
    const t = byId('mail_templates', $('#pr-tpl').value);
    const vars = prospectVars(st, {pids, contact, date: $('#pr-date')?.value || null, show: $('#modal .pr-concert')?.hidden ? null : byId('shows', $('#pr-show').value)});   // concert : seulement pour un modèle d'invitation
    if ($('#pr-subj') && (force || !dirty)) $('#pr-subj').value = t ? fill(t.subject, vars, false) : '';
    if (force || !dirty) $('#pr-body').innerHTML = (t ? fill(t.html, vars, true) : '') + signatureOf(sender);
    // délivrabilité (v1.52) : au premier mail de prospection, les pièces jointes du modèle ne sont pas cochées d'office
    if (force){ dirty = false; const was = new Map(files.map(f => [f.path || f.id, f.on]));   // cases déjà cochées gardées (changement d'expéditeur…)
      files = [...(t?.attachments || []).map(a => ({...a, on: was.get(a.path || a.id) ?? !!relance})), ...files.filter(f => f.mine)]; drawFiles(); if (t?.cc) $('#pr-cc').value = t.cc; }
  };
  drawTpls(); $('#pr-tpl').dataset.prev = $('#pr-tpl').value; draw(true);   // aucun artiste coché d'office (v1.53)
  syncChips(document.querySelector('#modal'));
  // modèle choisi → ses artistes sont cochés (un modèle « tous les artistes » garde la sélection)
  function syncArtists(){
    const ids = tplProjects(byId('mail_templates', $('#pr-tpl').value)); if (!ids.length || relance) return;
    pids = ids.filter(id => active.some(a => a.id === id));
    document.querySelectorAll('#modal [data-pr-art]').forEach(c => { c.checked = pids.includes(c.dataset.prArt); });
  }
  $('#pr-tpl').onchange = async () => { const prev = $('#pr-tpl').dataset.prev, next = $('#pr-tpl').value;
    if (dirty){ $('#pr-tpl').value = prev;   // en attendant la réponse : le modèle d'avant reste affiché
      if (!(await confirmAsk('Remplacer le texte retouché ?', 'Le texte du mail que tu as retouché sera remplacé par ce modèle.', 'Remplacer le texte', {danger: true}))) return;
      $('#pr-tpl').value = next; }
    syncArtists(); const cur = $('#pr-tpl').value; drawTpls(); $('#pr-tpl').value = cur; $('#pr-tpl').dataset.prev = cur; draw(true); };
  $('#pr-body').addEventListener('input', () => { dirty = true; });
  // objet retouché à la main (v1.56) : comme le texte, jamais réécrit en silence (artiste coché, date, contact…)
  $('#pr-subj')?.addEventListener('input', () => { dirty = true; });
  document.querySelector('#modal .pr-arts').addEventListener('change', e => {
    const id = e.target.dataset.prArt; if (!id) return;
    pids = e.target.checked ? [...pids, id] : pids.filter(x => x !== id);
    const before = $('#pr-tpl').value; drawTpls();
    // le modèle choisi reste choisi ; s'il ne concerne plus aucun artiste coché, on passe au premier modèle adapté
    if (rank(byId('mail_templates', before)) === 2 && pids.length) $('#pr-tpl').selectedIndex = 0;
    $('#pr-tpl').dataset.prev = $('#pr-tpl').value;
    if ($('#pr-tpl').value !== before && !dirty) draw(true); else draw();
  });
  $('#pr-contact').onchange = e => { contact = byId('contacts', e.target.value) || null; if (contactMails(contact)) $('#pr-to').value = contactMails(contact); draw(); syncChips(document.querySelector('#modal')); };
  // interlocuteur proposé depuis une adresse choisie (v1.60.3) : sur clic seulement, sans toucher aux destinataires
  $('#pr-contact').addEventListener('interlocutor', () => { contact = byId('contacts', $('#pr-contact').value) || null; draw(); syncChips(document.querySelector('#modal')); });
  $('#pr-date')?.addEventListener('change', () => draw());
  $('#pr-show').onchange = async () => { if (dirty && !(await confirmAsk('Remplacer le texte retouché ?', 'Le texte du mail que tu as retouché sera réécrit avec ce concert.', 'Remplacer le texte', {danger: true}))) return; draw(true); };
  $('#pr-from').onchange = e => { const before = signatureOf(sender); sender = e.target.value; $('#pr-from-addr').textContent = fromAddr();
    // la signature suit l'expéditeur, sans toucher au texte déjà retouché
    const body = $('#pr-body'); if (before && body.innerHTML.endsWith(before)) body.innerHTML = body.innerHTML.slice(0, -before.length) + signatureOf(sender); else if (!dirty) draw(true); };
  $('#pr-files').addEventListener('change', e => { const i = e.target.dataset.att; if (i != null){ files[i].on = e.target.checked; drawFiles(); } });
  $('#pr-up').addEventListener('change', async e => {
    for (const f of e.target.files){
      const path = `mails/prospection/${st.id}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const {error} = await sb.storage.from('suivi').upload(path, typedFile(f), {contentType: contentTypeOf(f)});
      if (error){ toast('Envoi impossible : ' + error.message, true); continue; }
      files.push({path, name: f.name, size: f.size, on: true, mine: true});
    }
    e.target.value = ''; drawFiles();
  });
  document.querySelector('#modal #pr-draft').onclick = () => { wantDraft = true; document.querySelector('#modal form').requestSubmit(); };
  return done;
}

/** Après la prospection : suivi, journal, date(s) en Intérêt, tâche de relance */
async function recordProspection(st, {to, subject, html, send, out, pids, contact, date, account}){
  const now = today();
  // un suivi en cours avec cette structure et un de ces artistes : on le complète, sinon on en crée un
  let p = prospectsOfStructure(st.id).find(x => !suiviClosed(x) && projIds(x).some(id => pids.includes(id)));
  if (p){
    const ids = [...new Set([...projIds(p), ...pids])];
    await save('prospects', p.id, {project_ids: ids, project_id: ids[0]}, {rerender: false});
  } else {
    p = await insert('prospects', {name: 'Suivi', structure_id: st.id, project_ids: pids, project_id: pids[0], status: 'Mailed', last_contact: send ? now : null});
    if (!p) return;
  }
  const log = await insert('prospect_logs', {prospect_id: p.id, date: send ? now : null, kind: 'Mail', contact_name: contact?.display_name || to, contact_id: contact?.id || null,
    author: S.user.email, body: `**Prospection${send ? '' : DRAFT_MARK}** · ${andList(pids.map(projName))}${account === 'production' ? ' · depuis production@' : ''}\n**Objet :** ${subject}\n\n${plain(html)}`, body_html: html});
  await save('prospects', p.id, {mail_account: account === 'production' ? 'production' : null, mail_thread_id: out.thread_id, mail_to: to, mail_subject: subject, mail_sent_at: send ? (out.sent_at || new Date().toISOString()) : null,
    mail_log_id: log?.id || null, relances: 0, ...(send ? {last_contact: now} : {})}, {rerender: false});
  // date proposée → une date en « Intérêt » par artiste
  if (date){
    const status = isFestival(st) ? 'Intérêt Festival' : 'Intérêt Salle';
    const ev = eventsOfStructure(st.id).find(e => e.date_start && date >= e.date_start && date <= (e.date_end || e.date_start));
    // lieu réel (v1.60.2) : celui de l'événement s'il y en a un à cette date (sa ville, pas celle du siège), sinon celui de la structure
    for (const pid of pids) await insert('shows', {...showPrefillFromStructure(st), ...(ev ? placeOfEvent(ev) : {}), venue: ev?.name || st.name, project_id: pid, date, status,
      prospect_id: p.id, contract_type: 'Cession', communication_enabled: true, request_date: now});
  }
  await relanceTask(st, pids, subject, send, byId('prospects', p.id), 0);
  render();
}

/** Dates de la prospection et des relances d'un suivi (journal) */
export function relanceHistory(p){
  const logs = logsOf(p.id).filter(l => l.date && /^\*\*Relance n°\d+/.test(l.body || '')).map(l => l.date).sort();
  return {sent: dayOf(p.mail_sent_at), relances: logs};   // jour de Paris (§1.2)
}
const historyText = (p, extra=[]) => { const h = relanceHistory(p); const r = [...h.relances, ...extra];
  return [h.sent && `prospection le ${fmtDate(h.sent)}`, r.length && `relance${r.length > 1 ? 's' : ''} le ${r.map(fmtDate).join(', ')}`].filter(Boolean).join(' · '); };

/** Après une relance : journal (avec l'historique des relances), compteur, tâche suivante (mail, ou téléphone après 3 relances) */
async function recordRelance(p, st, {to, html, send, out, contact}){
  const now = today(), n = (p.relances || 0) + 1;
  const before = historyText(p);
  const log = await insert('prospect_logs', {prospect_id: p.id, date: send ? now : null, kind: 'Mail', contact_name: contact?.display_name || to, contact_id: contact?.id || null,
    author: S.user.email, body: `**Relance n°${n}${send ? '' : DRAFT_MARK}** (en réponse à « ${p.mail_subject || ''} »)${before ? `\n_Avant : ${before}_` : ''}\n\n${plain(html)}`, body_html: html});
  // une relance ne compte (et ne fait avancer la tâche) qu'une fois partie : en brouillon, on attend l'envoi depuis Gmail
  await save('prospects', p.id, {mail_log_id: log?.id || null, ...(send ? {relances: n, last_contact: now} : {})}, {rerender: false});
  if (send) await relanceTask(st, projIds(p), p.mail_subject, true, byId('prospects', p.id), n);
  else toast('Relance en brouillon dans Gmail : elle sera comptée quand elle sera envoyée');
  render();
}

/** Brouillon de relance parti depuis Gmail : on la compte et on passe à la tâche suivante */
async function relanceSent(p, sentOn){
  const st = byId('structures', p.structure_id); if (!st) return;
  const n = (p.relances || 0) + 1;
  await save('prospects', p.id, {relances: n}, {rerender: false});
  await relanceTask(st, projIds(p), p.mail_subject, true, byId('prospects', p.id), n, sentOn);
}

/**
 * Mail parti depuis Gmail mais pas encore vu par la Matrice : « Marquer envoyé » (journal, suivi, relance comptée).
 * date : jour d'envoi (aujourd'hui par défaut).
 */
export async function markLogSent(logId, date = today()){
  const log = byId('prospect_logs', logId); if (!log) return;
  const p = byId('prospects', log.prospect_id);
  await save('prospect_logs', log.id, {date, body: String(log.body || '').replace(DRAFT_MARK, '')}, {rerender: false});
  if (p){
    const patch = {last_contact: [p.last_contact, date].filter(Boolean).sort().pop()};
    if (/^\*\*Prospection/.test(log.body || '') && !p.mail_sent_at) patch.mail_sent_at = new Date(date + 'T12:00:00').toISOString();
    await save('prospects', p.id, patch, {rerender: false});
    if (/^\*\*Relance n°/.test(log.body || '')) await relanceSent(byId('prospects', p.id), date);
  }
  toast('Noté « envoyé » le ' + fmtDate(date)); render();
}
export const isDraftLog = l => String(l?.body || '').includes(DRAFT_MARK);

/** Clôt les tâches de relance encore ouvertes du suivi (ou, pour les anciennes, de la structure) */
async function closeOpenRelances(st, p){
  for (const t of S.db.tasks.filter(t => !['Done', 'Cancelled'].includes(t.status) && (p && t.prospect_id === p.id && t.auto_kind || !t.prospect_id && t.structure_id === st.id && /^Relance — /.test(t.title || ''))))
    await save('tasks', t.id, {status: 'Done', done_at: new Date().toISOString()}, {rerender: false});
}

/** Suivi confirmé ou clos : ses relances automatiques encore ouvertes sont annulées (les autres tâches restent) */
export async function cancelAutoRelances(prospectId){
  const undo = [];
  for (const t of S.db.tasks.filter(t => t.prospect_id === prospectId && ['relance_mail', 'relance_tel'].includes(t.auto_kind) && !['Done', 'Cancelled'].includes(t.status))){
    const prev = {status: t.status, done_at: t.done_at ?? null};
    if (await save('tasks', t.id, {status: 'Cancelled', done_at: new Date().toISOString()}, {rerender: false})) undo.push([t.id, prev]);
  }
  return undo;
}
/** « Annuler » : les relances retirées reviennent comme avant */
export async function restoreRelances(undo){
  for (const [id, prev] of undo || []) await save('tasks', id, prev, {rerender: false});
}

/** Tâche de relance suivante, rattachée au suivi : par mail à J+n (10 par défaut), puis par téléphone après n relances par mail (3 par défaut) */
async function relanceTask(st, pids, subject, sent, p, n, sentOn=today()){
  await closeOpenRelances(st, p);
  if (suiviClosed(p)) return;   // suivi confirmé ou clos : plus de relance
  if (!relanceOn()) return;   // tâches de relance désactivées (Réglages) : aucune tâche ni note de relance téléphone ; les anciennes sont closes comme avant
  // J+10 après l'envoi réel ; un samedi ou un dimanche : le lundi suivant (fonctions officielles §1.6)
  const deadline = workDay(addDays(sentOn, relanceDays()));
  const base = {department: 'Booking', status: 'To Do', assigned_to: S.user.email, deadline,
    structure_id: st.id, project_ids: pids, project_id: pids[0] || null, prospect_id: p?.id || null};
  if (p && n >= mailRelances()){
    const phones = linksOfStructure(st.id).filter(c => c.phone).map(c => `${c.display_name} : ${c.phone}`);
    const hist = historyText(p);
    await insert('tasks', {...base, title: `Relance téléphone — ${st.name}`, auto_kind: 'relance_tel', tags: ['Call'],
      notes: `${n} relances par mail sans réponse (${hist}).\nAppelle${phones.length ? ' : ' + phones.join(' · ') : ''}.\nPas de réponse : bouton « Pas de réponse : clore le suivi » (ou supprime la tâche), le suivi est clos et noté dans le journal.`});
    await insert('prospect_logs', {prospect_id: p.id, date: today(), kind: 'Note', author: S.user.email,
      body: `**${n} relances par mail sans réponse** (${hist}) : la prochaine relance se fait par téléphone.`});
    return;
  }
  await insert('tasks', {...base, title: `Relance — ${st.name}`, auto_kind: 'relance_mail',
    notes: `${n ? `Relance n°${n}` : 'Mail'} « ${subject || ''} » ${sent ? 'envoyé le ' + fmtDate(sentOn) : 'préparé en brouillon le ' + fmtDate(today())}. Relance n°${n + 1} sur ${mailRelances()} par mail : bouton « Relance » sur le suivi ou la fiche de la structure.`});
}

/** Question de suppression d'un suivi : nomme le suivi et ce qui part avec lui (§4.4) */
export function prospectDeleteAsk(id){
  const p = byId('prospects', id), n = logsOf(id).length, f = filesOf(id).filter(x => x.mime !== 'link').length;
  const plus = [n ? `son journal (${n} échange${n > 1 ? 's' : ''})` : '', f ? `${f} fichier${f > 1 ? 's' : ''} joint${f > 1 ? 's' : ''}` : ''].filter(Boolean).join(' et ');
  return {title: 'Supprimer le suivi ?', text: `Supprimer le suivi « ${prospectTitle(p)} »${plus ? ' avec ' + plus : ''} ? Les fichiers Google Drive ne sont pas touchés.`,
    actions: [{value: 'del', label: 'Supprimer le suivi', danger: true}]};
}
/** Suppression d'un suivi (liste ou fenêtre) : lignes d'abord, puis ses fichiers stockés — jamais de fichier orphelin silencieux (v1.46b) */
export async function deleteProspect(id){
  const paths = filesOf(id).filter(f => f.mime !== 'link').map(f => f.path);
  if (!(await remove('prospects', id))) return false;
  S.db.prospect_logs = S.db.prospect_logs.filter(l => l.prospect_id !== id); S.db.prospect_files = S.db.prospect_files.filter(f => f.prospect_id !== id);
  touch('prospect_logs'); touch('prospect_files');
  if (S.suiviPage === id) S.suiviPage = null;
  await purgeStored(paths);
  return true;
}

/** Relance téléphone sans réponse : la tâche est fermée, le suivi est clos et le journal le note */
export async function closeNoAnswer(taskId, {deleted=false}={}){
  const t = byId('tasks', taskId), p = t?.prospect_id ? byId('prospects', t.prospect_id) : null;
  if (!p) return;
  await insert('prospect_logs', {prospect_id: p.id, date: today(), kind: 'Appel', author: S.user.email,
    body: `**Appel sans réponse : suivi clos.**\nHistorique : ${historyText(p)} · appel le ${fmtDate(today())}.`});
  await save('prospects', p.id, {status: 'Closed', last_contact: today()}, {rerender: false});
  if (!deleted) await save('tasks', t.id, {status: 'Done', done_at: new Date().toISOString()}, {rerender: false});
  toast(`Suivi ${structName(p.structure_id) || ''} clos (appel sans réponse)`);
  render();
}

/**
 * Brouillon parti depuis Gmail ? On regarde le fil une fois par session (ou tout de suite si force) :
 * la date d'envoi est notée dans le journal et sur le suivi.
 */
const CHECKED = new Map();            // suivi → heure de la dernière vérification
const RECHECK_MS = 2 * 60 * 1000;     // un brouillon pas encore parti est revérifié toutes les 2 min au plus
export async function checkProspect(p, force=false){
  if (!p?.mail_thread_id || !(p.mail_account === 'production' ? setting('drive_webhook_url') : scriptUrl())) return;
  if (!force && Date.now() - (CHECKED.get(p.id) || 0) < RECHECK_MS) return;
  const log = p.mail_log_id ? byId('prospect_logs', p.mail_log_id) : null;
  if (!force && p.mail_sent_at && (!log || log.date)) return;
  CHECKED.set(p.id, Date.now());
  try {
    const out = await callProspect('status', {thread_id: p.mail_thread_id}, p.mail_account || 'anthony');
    const sent = (out.sent || []).sort();
    if (!sent.length) return;
    const patch = {};
    if (!p.mail_sent_at) patch.mail_sent_at = sent[0];
    if (log && !log.date){
      // un envoi postérieur à la préparation du brouillon (sinon il est toujours en brouillon)
      const after = log.created_at ? sent.find(d => d.slice(0, 19) >= log.created_at.slice(0, 19)) : null;
      if (after){
        await save('prospect_logs', log.id, {date: dayOf(after), body: String(log.body || '').replace(DRAFT_MARK, '')}, {rerender: false});
        if (/^\*\*Relance n°/.test(log.body || '')) await relanceSent(byId('prospects', p.id), dayOf(after));
      }
      if (after) patch.last_contact = [p.last_contact, dayOf(after)].filter(Boolean).sort().pop();
    }
    if (Object.keys(patch).length){ await save('prospects', p.id, patch, {rerender: false}); render(); }
  } catch (err) { /* script absent ou fil supprimé : on réessaiera à la prochaine session */ }
}

/** Appelé après chaque affichage : suivis visibles dont le mail est encore en brouillon */
export function checkVisibleProspects(){
  const list = S.suiviPage ? [byId('prospects', S.suiviPage)] : S.structurePage ? prospectsOfStructure(S.structurePage) : [];
  list.filter(p => p?.mail_thread_id).forEach(p => checkProspect(p));
}

/** Le suivi le plus récent de la structure qui a un mail de prospection (pour le bouton « Relance ») */
export const lastProspectMail = stId => prospectsOfStructure(stId).filter(p => p.mail_thread_id && !suiviClosed(p))
  .sort((a, b) => (b.mail_sent_at || b.updated_at || '').localeCompare(a.mail_sent_at || a.updated_at || ''))[0] || null;

export { PROSPECT_TAGS, logsOf };

/** Lieu propre d'un suivi (v1.60.2) : enregistré en entier, ou retiré (pl = null) ; la carte de l'espace de prospection en part */
export const PLACE_KEYS = ['venue', 'address', 'postal_code', 'city', 'department', 'lat', 'lng'];
export async function setSuiviPlace(pid, pl){
  const patch = Object.fromEntries(PLACE_KEYS.map(k => [k, pl?.[k] ?? null]));
  // lieu connu sans coordonnées (événement dans une autre ville…) : localisé par son adresse ou sa ville, jamais par son seul nom
  if (pl && patch.lat == null && (patch.address || patch.city)){
    const fr = !patch.department || /^(\d{2,3}|2[AB])$/i.test(patch.department);
    const g = await geocode([patch.address, patch.postal_code, patch.city, fr ? '' : patch.department].filter(Boolean).join(' '), {france: fr});
    if (g){ patch.lat = g.lat; patch.lng = g.lng; patch.department = patch.department || g.department_code || null; }
  }
  if (await save('prospects', pid, patch)) toast(pl ? 'Lieu du suivi enregistré' : 'Lieu du suivi retiré');
}

/*
 * ─── Message glissé depuis Apple Mail sans fichier (v1.60.4) ───
 * Mail (Mac) ne transmet parfois qu'un lien « message:%3C<Message-ID>%3E ». L'identifiant (validé : eml.js msgIdOk) sert à retrouver
 * CE message dans les boîtes Google, par le circuit serveur existant (relais script-google : compte de l'équipe vérifié, code secret
 * ajouté côté serveur) : action en LECTURE SEULE « mail_by_msgid » du script de prospection (anthony@) puis du script principal
 * (production@). Le script exige une correspondance exacte de l'en-tête Message-ID et ne renvoie que ce message.
 * Rattachement EXPLICITE au suivi cible après confirmation, par le chemin habituel (uploadFiles : pièce jointe + entrée « Mail » au
 * journal), clé anti-doublon « msgid:<Message-ID> » sur la pièce jointe et sur l'entrée du journal.
 */
const MAILBOXES = [
  {label: 'anthony@', call: id => callProspect('mail_by_msgid', {message_id: id}),
    outdated: 'script de prospection pas à jour (Réglages › Prospection : « Copier le code à jour », coller dans le script d’anthony@, puis nouvelle version)'},
  {label: 'production@', call: id => callScript('mail_by_msgid', {message_id: id}),
    outdated: 'script Google pas à jour (Réglages › Google : « Copier le code à jour », coller dans Code.gs de production@, puis nouvelle version)'},
];
const PENDING_MSG = new Set();   // un même message en cours de rattachement n'est pas traité deux fois (double dépôt)

/** Cherche le message dans anthony@ puis production@ : {mail} si trouvé, sinon {tried: [[boîte, résultat]]} */
export async function findMailByMsgId(id){
  const tried = [];
  for (const box of MAILBOXES){
    let r;
    try { r = await box.call(id); }
    catch (err){ tried.push([box.label, /Action inconnue|pas à jour/i.test(err.message || '') ? box.outdated : err.message || 'recherche impossible']); continue; }
    const m = r?.message;
    if (r?.found === true && m && m.message_id === id && typeof m.raw === 'string' && m.raw.length > 0 && m.raw.length <= MSG_RAW_MAX)
      return {mail: {...m, box: box.label}, tried};
    tried.push([box.label, r?.found === false ? 'absent' : 'réponse du script illisible']);
  }
  return {tried};
}

const fileTitle = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'message';

/** Message introuvable (ou boîtes inaccessibles) : message clair, rien de joint ; parcours le plus court sans Bureau = noter au journal */
async function mailNotFound(p, tried){
  const searched = tried.filter(([, r]) => r === 'absent');
  const lines = tried.map(([b, r]) => `${b} : ${r === 'absent' ? 'message absent' : r}`);
  const head = searched.length === tried.length ? 'Message introuvable dans les boîtes Google (compte de Mail non relié) : ce message n’est ni dans anthony@ ni dans production@. Rien n’a été joint.'
    : searched.length ? 'Message introuvable dans les boîtes Google consultées (compte de Mail non relié ?). Rien n’a été joint.'
    : 'Le message n’a pas pu être cherché dans les boîtes Google. Rien n’a été joint.';
  const choice = await ask({title: searched.length ? 'Message introuvable' : 'Recherche impossible',
    text: [head, ...lines, 'Pour garder une trace tout de suite, sans enregistrer de fichier : note l’échange dans le journal de ce suivi (type « Mail »).'].join('\n'),
    actions: [{value: 'journal', label: 'Noter dans le journal'}], cancel: 'Fermer'});
  if (choice !== 'journal') return;
  const form = document.querySelector(`form[data-logform="${CSS.escape(p.id)}"]`); if (!form) return;
  form.elements.kind.value = 'Mail'; form.elements.kind.dispatchEvent(new Event('change', {bubbles: true}));
  form.elements.body.focus();
}

/** Un message (Message-ID validé) : contrôle de doublon, recherche, confirmation explicite, rattachement */
async function attachOneMailLink(p, id){
  if (!msgIdOk(id)) return toast('Lien de Mail refusé : l’identifiant du message n’a pas la forme attendue. Rien n’a été joint.', true);
  const key = 'msgid:' + id;
  if (PENDING_MSG.has(key)) return;
  PENDING_MSG.add(key);
  try {
    // déjà joint à un AUTRE suivi : refusé sans consulter les boîtes Google
    toast('Recherche du message (suivis, puis boîtes Google)…');
    // (décision d'Anthony du 08/11/2026 : un message reste rattaché à un seul suivi ; le suivi concerné est nommé et accessible)
    const open = id => ({label: 'Ouvrir le suivi', act: 'openSuivi', id});
    const name = id => prospectTitle(byId('prospects', id) || {name: 'autre suivi'});
    const where = await mailAttachedTo(key);
    if (where && where !== p.id) return toast(`Ce message est déjà joint au suivi « ${name(where)} » : rien n’a été ajouté.`, true, open(where));
    // joint avant la v1.60.4 (sans clé) : reconnu par le Message-ID du .eml déjà stocké, en lecture seule, sans consulter Gmail
    const legacyCheck = where ? {owner: null, incomplete: ''} : await legacyMailOwner(id), old = legacyCheck.owner;
    if (old) return toast(old === p.id ? 'Ce message est déjà joint à ce suivi (avant la v1.60.4) : rien n’a été ajouté.'
      : `Ce message est déjà joint au suivi « ${name(old)} » (avant la v1.60.4) : rien n’a été ajouté.`, true, old === p.id ? null : open(old));
    const {mail, tried} = await findMailByMsgId(id);
    if (!mail) return mailNotFound(p, tried);
    const got = new File([mail.raw], 'message.eml', {type: 'message/rfc822'});
    let m; try { m = await readEml(got); } catch { m = null; }
    // double contrôle : le contenu reçu porte bien CE Message-ID
    if (!m || m.messageId !== id) return toast('Le message renvoyé par le script Google ne correspond pas au lien de Mail : rien n’a été joint.', true);
    const file = new File([got], fileTitle(m.subject) + '.eml', {type: 'message/rfc822'});   // nom tiré du .eml lui-même
    // ce qui est déjà joint, clé par clé : complet → rien ; partiel → seules les parties manquantes seront ajoutées
    const plan = await mailParts(p.id, key, m);
    if (plan.other) return toast(`Ce message est déjà joint au suivi « ${name(plan.other)} » : rien n’a été ajouté.`, true, open(plan.other));
    const unverified = plan.unverified || legacyCheck.incomplete;
    if (plan.legacy) return toast('Ce mail est déjà au journal de ce suivi (ajouté autrement) : rien n’a été ajouté.', true);
    if (!mailPartsMissing(plan)) return toast('Ce message est déjà joint à ce suivi : rien n’a été ajouté.', true);
    const partial = where === p.id;
    const n = m.attachments.length, sk = m.attachmentsSkipped;
    const att = (n ? `\n${n} pièce${n > 1 ? 's' : ''} jointe${n > 1 ? 's' : ''} du mail : ${m.attachments.map(a => a.name).join(', ')}` : '')
      + (sk ? `\n${sk} pièce${sk > 1 ? 's' : ''} non extraite${sk > 1 ? 's' : ''} (plus de 20, ou trop imbriquée${sk > 1 ? 's' : ''}) : l’original .eml les contient.` : '');
    const missing = [plan.original && 'le mail original (.eml)', plan.log && 'l’entrée du journal', plan.pj.length && `${plan.pj.length} pièce${plan.pj.length > 1 ? 's' : ''} du mail`].filter(Boolean).join(', ');
    // objet, expéditeur et date relus dans le .eml lui-même (pas dans la réponse du script)
    const ok = await confirmAsk(partial ? 'Compléter ce message' : 'Joindre ce message',
      `${partial ? 'Ce message est déjà joint en partie à ce suivi. Compléter' : 'Joindre ce message au'} suivi « ${prospectTitle(p)} » ?\n${m.subject || '(sans objet)'} · ${m.fromLine || 'expéditeur inconnu'} · ${m.date ? fmtDate(m.date) : 'date inconnue'}${att}\nTrouvé dans la boîte ${mail.box}. ${partial ? `Seul ce qui manque sera ajouté : ${missing}.` : 'Le mail original (.eml) et ses pièces jointes seront ajoutés au suivi, avec une entrée au journal.'}`,
      partial ? 'Compléter le suivi' : 'Joindre au suivi');
    if (!ok) return toast('Rien n’a été joint.');
    // anciens .eml pas tous vérifiables : avertissement explicite avant tout rattachement (relecture B2)
    if (unverified && !(await legacyUnverifiedOk(unverified, m.subject || 'ce message'))) return toast('Rien n’a été joint.');
    // même chemin qu'un .eml déposé : la clé est revérifiée en base juste avant l'envoi (joint entre-temps depuis un autre poste)
    await uploadFiles({prospect_id: p.id, import_key: key, legacy_ok: true}, [file]);
    render();
  } finally { PENDING_MSG.delete(key); }
}

/** Dépôt d'un ou plusieurs liens « message: » sur les pièces jointes d'un suivi (events.js) : un message après l'autre, 5 au plus */
export async function attachMailLinks(pid, ids){
  const p = byId('prospects', pid); if (!p) return;
  if (ids.length > 5) toast(`${ids.length} messages glissés : seuls les 5 premiers sont traités.`, true);
  for (const id of ids.slice(0, 5)) await attachOneMailLink(p, id);
}
