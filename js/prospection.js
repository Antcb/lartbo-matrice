/**
 * 📣 Prospection depuis une structure : mail préparé à partir d'un modèle « Prospection » (balises de la structure),
 * créé en brouillon ou envoyé depuis le Gmail de la personne qui prospecte (script « Prospection », compte anthony@).
 * Ensuite, automatiquement : suivi (statut Mailed), mail dans le journal, artistes, date en « Intérêt » si une date est proposée,
 * tâche Booking de relance à J+10.
 * « Relance » : réponse dans le même fil Gmail (l'historique reste), journal, nouvelle tâche de relance.
 */
import { render } from './app.js';
import { insert, save, sb, signedUrl } from './data.js';
import { showPrefillFromStructure } from './forms.js';
import { PROSPECT_TAGS, fill } from './mail.js';
import { byId, eventsOfStructure, linksOfStructure, logsOf, projIds, projName, prospectsOfStructure, setting, structName } from './selectors.js';
import { S } from './state.js';
import { dateInput } from './ui/datefield.js';
import { openModal } from './ui/modal.js';
import { esc, fmtDate, toast, today } from './utils.js';

const RELANCE_DAYS = 10;
const MAIL_RELANCES = 3;   // après 3 relances par mail sans réponse : relance par téléphone
const DRAFT_MARK = ' _(brouillon, pas encore envoyé)_';
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const longDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'}) : '';
const plain = html => { const d = document.createElement('div'); d.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n'); return d.textContent.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim(); };
const andList = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1];
const isFestival = st => (st.tags || []).some(t => /festival/i.test(t)) || eventsOfStructure(st.id).some(e => e.kind === 'Festival');

/** Adresse du script « Prospection » (Gmail du prospecteur) */
const scriptUrl = () => String(setting('prospect_script_url') || '').trim();
export async function callProspect(action, payload){
  if (!scriptUrl()) throw new Error('Le script de prospection n’est pas encore installé : Réglages › Prospection.');
  const res = await fetch(scriptUrl(), {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({secret: setting('drive_webhook_secret'), action, ...payload})});
  const out = await res.json().catch(() => ({ok:false, error:'Réponse illisible du script de prospection'}));
  if (!out.ok) throw new Error(out.error || 'Erreur du script de prospection');
  return out;
}

/** Balises d'un mail de prospection : infos de la structure, de son festival / sa salle, des artistes choisis */
export function prospectVars(st, {pids=[], contact=null, date=null}={}){
  const ev = eventsOfStructure(st.id).find(e => e.date_start && e.date_start >= today()) || eventsOfStructure(st.id)[0];
  const evDates = ev?.date_start ? (ev.date_end && ev.date_end !== ev.date_start ? `du ${fmtDate(ev.date_start)} au ${fmtDate(ev.date_end)}` : fmtDate(ev.date_start)) : (ev?.period || '');
  return {
    contact: contact?.first_name || (contact?.display_name || '').split(' ')[0] || '',
    structure: st.name, artiste: andList(pids.map(projName)),
    ville: st.city || ev?.city || '', cp: st.department_code || (st.country && st.country !== 'France' ? st.country : ''),
    festival: ev?.name || st.name, dates_festival: evDates, jauge: ev?.capacity ? String(ev.capacity) : '',
    date_proposee: longDate(date), annee: date ? date.slice(0, 4) : String(new Date().getFullYear() + 1),
  };
}

/**
 * Fenêtre de prospection (structureId) ou de relance ({prospectId}).
 */
export async function openProspection(structureId, {prospectId=null}={}){
  const p = prospectId ? byId('prospects', prospectId) : null;
  const relance = !!p;
  const st = byId('structures', structureId || p?.structure_id); if (!st) return;
  if (relance && !p.mail_thread_id) return toast('Ce suivi n’a pas de mail de prospection envoyé depuis la Matrice', true);
  if (relance && !p.mail_sent_at){
    await checkProspect(p, true);
    if (!byId('prospects', p.id).mail_sent_at) return toast('Le mail de prospection est encore en brouillon dans Gmail : envoie-le d’abord, puis relance.', true);
  }
  const kind = relance ? 'relance' : 'prospection';
  const contacts = linksOfStructure(st.id);
  const active = S.db.projects.filter(x => x.active).sort((a, b) => a.name.localeCompare(b.name));
  let pids = relance ? projIds(p) : (S.project && byId('projects', S.project)?.active ? [S.project] : []);
  let contact = relance ? contacts.find(c => c.email && p.mail_to && p.mail_to.toLowerCase().includes(c.email.toLowerCase())) : contacts.find(c => c.email);
  const tplsFor = () => S.db.mail_templates.filter(t => t.kind === kind && (!t.project_id || pids.includes(t.project_id)))
    .sort((a, b) => (b.project_id ? 1 : 0) - (a.project_id ? 1 : 0) || (pids.indexOf(a.project_id) - pids.indexOf(b.project_id)) || (a.name || '').localeCompare(b.name || ''));
  const from = setting('prospect_from') || 'anthony@lartboristerie.com';

  const extra = `<div class="mail-wrap">
    ${relance ? `<p class="mode-note">Réponse dans le fil « ${esc(p.mail_subject || '')} » envoyé à ${esc(p.mail_to || '')}${p.mail_sent_at ? ` le ${fmtDate(p.mail_sent_at.slice(0, 10))}` : ''} : l’historique reste en dessous du mail.</p>` : ''}
    <div class="mail-grid">
      <label>Artiste(s)</label><div class="checks pr-arts">${active.map(a => `<label><input type="checkbox" data-pr-art="${a.id}" ${pids.includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>
      <label for="pr-tpl">Modèle</label><select id="pr-tpl"></select>
      <label for="pr-contact">Destinataire</label><span class="mail-to"><select id="pr-contact"><option value="">— autre adresse —</option>${contacts.map(c => `<option value="${c.id}" ${c.id === contact?.id ? 'selected' : ''}>${esc(c.display_name)}${c.email ? ` · ${esc(c.email)}` : ' (pas de mail)'}</option>`).join('')}</select>
        <input id="pr-to" type="email" placeholder="adresse@exemple.fr" value="${esc(relance ? (p.mail_to || '') : (contact?.email || ''))}"></span>
      <label for="pr-cc">Copie</label><input id="pr-cc">
      ${relance ? '' : `<label for="pr-subj">Objet</label><input id="pr-subj">
      <label>Date proposée</label><span class="pr-date">${dateInput('', 'id="pr-date"')}<small class="muted">facultatif : crée la date en « Intérêt » pour chaque artiste</small></span>`}
    </div>
    <div class="mail-preview" id="pr-body" contenteditable="true" aria-label="Texte du mail (modifiable)"></div>
    <div class="ml-att"><b class="fiche-lbl">Pièces jointes</b> <span id="pr-files"></span>
      <label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="pr-up"></label></div>
    <p class="help">Envoyé depuis <b>${esc(from)}</b>. « Enregistrer en brouillon » le met dans les brouillons Gmail ; « Envoyer maintenant » l’envoie tout de suite.
      Dans les deux cas : ${relance ? `le journal du suivi est complété (avec les dates des relances précédentes) et ${(p.relances || 0) + 1 >= MAIL_RELANCES ? 'comme c’est la ' + MAIL_RELANCES + 'e relance par mail, la tâche suivante est une relance par téléphone.' : 'une nouvelle tâche de relance est créée à J+10.'}` : 'un suivi est créé (Mailed) avec le mail dans le journal, la date proposée en « Intérêt », et une tâche Booking de relance à J+10.'}</p>
    <div class="vh-actions"><button type="button" class="btn primary" id="pr-send">Envoyer maintenant</button></div></div>`;

  let sendNow = false, dirty = false, files = [];
  const done = openModal({title: `${relance ? `Relance n°${(p.relances || 0) + 1}` : 'Prospection'} · ${st.name}`, fields: [], extra, wide: true, saveLabel: 'Enregistrer en brouillon',
    onSave: async () => {
      const m = current();
      if (!m.to) { toast('Indique le destinataire', true); sendNow = false; return false; }
      if (!pids.length) { toast('Coche au moins un artiste', true); sendNow = false; return false; }
      if (!relance && !m.subject) { toast('Indique l’objet du mail', true); sendNow = false; return false; }
      if (sendNow && !confirm(`Envoyer le mail à ${m.to} maintenant ?`)) { sendNow = false; return false; }
      const send = sendNow; sendNow = false;
      try {
        const attachments = await Promise.all(files.filter(f => f.on).map(async f => f.id ? {id: f.id} : {url: await signedUrl(f.path), name: f.name}));
        const out = relance
          ? await callProspect('reply', {thread_id: p.mail_thread_id, to: m.to, cc: m.cc, html: m.html, send, attachments})
          : await callProspect('mail', {to: m.to, cc: m.cc, subject: m.subject, html: m.html, send, attachments});
        if (relance) await recordRelance(p, st, {...m, send, out, contact});
        else await recordProspection(st, {...m, send, out, pids, contact, date: m.date});
        toast(send ? 'Mail envoyé' : 'Brouillon créé dans Gmail', false, out.url && !send ? {label: 'Ouvrir', fn: () => window.open(out.url, '_blank')} : null);
        return true;
      } catch (err) { toast(err.message, true); return false; }
    }});
  const $ = sel => document.querySelector('#modal ' + sel);
  const current = () => ({to: $('#pr-to').value.trim(), cc: $('#pr-cc').value.trim(), subject: $('#pr-subj')?.value.trim() || '', html: $('#pr-body').innerHTML, date: $('#pr-date')?.value || null});
  const drawFiles = () => { $('#pr-files').innerHTML = files.map((f, i) => `<label class="att-chip"><input type="checkbox" data-att="${i}" ${f.on ? 'checked' : ''}> ${f.path ? '📎' : '🔗'} ${esc(f.name || 'Fichier Drive')}</label>`).join('') || '<span class="muted">aucune</span>'; };
  const drawTpls = () => {
    const list = tplsFor(), cur = $('#pr-tpl').value;
    $('#pr-tpl').innerHTML = list.map(t => `<option value="${t.id}">${esc(t.name || 'Modèle')}${t.project_id ? '' : ' · générique'}</option>`).join('') || '<option value="">Aucun modèle : Réglages › Modèles de mail</option>';
    if (list.some(t => t.id === cur)) $('#pr-tpl').value = cur;
  };
  // remplit l'objet et le texte depuis le modèle (sauf si le texte a déjà été retouché à la main)
  const draw = (force=false) => {
    const t = byId('mail_templates', $('#pr-tpl').value);
    const vars = prospectVars(st, {pids, contact, date: $('#pr-date')?.value || null});
    if ($('#pr-subj') && (force || !dirty)) $('#pr-subj').value = t ? fill(t.subject, vars, false) : '';
    if (force || !dirty) $('#pr-body').innerHTML = (t ? fill(t.html, vars, true) : '') + (setting('prospect_signature') || '');
    if (force){ dirty = false; files = [...(t?.attachments || []).map(a => ({...a, on: true})), ...files.filter(f => f.mine)]; drawFiles(); if (t?.cc) $('#pr-cc').value = t.cc; }
  };
  drawTpls(); draw(true);
  $('#pr-tpl').onchange = () => { if (dirty && !confirm('Remplacer le texte retouché par ce modèle ?')) return; draw(true); };
  $('#pr-body').addEventListener('input', () => { dirty = true; });
  document.querySelector('#modal .pr-arts').addEventListener('change', e => {
    const id = e.target.dataset.prArt; if (!id) return;
    pids = e.target.checked ? [...pids, id] : pids.filter(x => x !== id);
    const before = $('#pr-tpl').value; drawTpls();
    if ($('#pr-tpl').value !== before && !dirty) draw(true); else draw();
  });
  $('#pr-contact').onchange = e => { contact = byId('contacts', e.target.value) || null; if (contact?.email) $('#pr-to').value = contact.email; draw(); };
  $('#pr-date')?.addEventListener('change', () => draw());
  $('#pr-files').addEventListener('change', e => { const i = e.target.dataset.att; if (i != null) files[i].on = e.target.checked; });
  $('#pr-up').addEventListener('change', async e => {
    for (const f of e.target.files){
      const path = `mails/prospection/${st.id}/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const {error} = await sb.storage.from('suivi').upload(path, f, {contentType: f.type || 'application/octet-stream'});
      if (error){ toast('Envoi impossible : ' + error.message, true); continue; }
      files.push({path, name: f.name, on: true, mine: true});
    }
    e.target.value = ''; drawFiles();
  });
  $('#pr-send').onclick = () => { sendNow = true; document.querySelector('#modal form').requestSubmit(); };
  return done;
}

/** Après la prospection : suivi, journal, date(s) en Intérêt, tâche de relance */
async function recordProspection(st, {to, subject, html, send, out, pids, contact, date}){
  const now = today();
  // un suivi en cours avec cette structure et un de ces artistes : on le complète, sinon on en crée un
  let p = prospectsOfStructure(st.id).find(x => x.status !== 'Closed' && projIds(x).some(id => pids.includes(id)));
  if (p){
    const ids = [...new Set([...projIds(p), ...pids])];
    await save('prospects', p.id, {project_ids: ids, project_id: ids[0]}, {rerender: false});
  } else {
    p = await insert('prospects', {name: 'Suivi', structure_id: st.id, project_ids: pids, project_id: pids[0], status: 'Mailed', last_contact: send ? now : null});
    if (!p) return;
  }
  const log = await insert('prospect_logs', {prospect_id: p.id, date: send ? now : null, kind: 'Mail', contact_name: contact?.display_name || to, contact_id: contact?.id || null,
    author: S.user.email, body: `**Prospection${send ? '' : DRAFT_MARK}** · ${andList(pids.map(projName))}\n**Objet :** ${subject}\n\n${plain(html)}`});
  await save('prospects', p.id, {mail_thread_id: out.thread_id, mail_to: to, mail_subject: subject, mail_sent_at: send ? (out.sent_at || new Date().toISOString()) : null,
    mail_log_id: log?.id || null, relances: 0, ...(send ? {last_contact: now} : {})}, {rerender: false});
  // date proposée → une date en « Intérêt » par artiste
  if (date){
    const status = isFestival(st) ? 'Intérêt Festival' : 'Intérêt Salle';
    const ev = eventsOfStructure(st.id).find(e => e.date_start && date >= e.date_start && date <= (e.date_end || e.date_start));
    for (const pid of pids) await insert('shows', {...showPrefillFromStructure(st), venue: ev?.name || st.name, project_id: pid, date, status,
      prospect_id: p.id, contract_type: 'Cession', communication_enabled: true, request_date: now});
  }
  await relanceTask(st, pids, subject, send, byId('prospects', p.id), 0);
  render();
}

/** Dates de la prospection et des relances d'un suivi (journal) */
export function relanceHistory(p){
  const logs = logsOf(p.id).filter(l => l.date && /^\*\*Relance n°\d+/.test(l.body || '')).map(l => l.date).sort();
  return {sent: p.mail_sent_at ? p.mail_sent_at.slice(0, 10) : null, relances: logs};
}
const historyText = (p, extra=[]) => { const h = relanceHistory(p); const r = [...h.relances, ...extra];
  return [h.sent && `prospection le ${fmtDate(h.sent)}`, r.length && `relance${r.length > 1 ? 's' : ''} le ${r.map(fmtDate).join(', ')}`].filter(Boolean).join(' · '); };

/** Après une relance : journal (avec l'historique des relances), compteur, tâche suivante (mail, ou téléphone après 3 relances) */
async function recordRelance(p, st, {to, html, send, out, contact}){
  const now = today(), n = (p.relances || 0) + 1;
  const before = historyText(p);
  const log = await insert('prospect_logs', {prospect_id: p.id, date: send ? now : null, kind: 'Mail', contact_name: contact?.display_name || to, contact_id: contact?.id || null,
    author: S.user.email, body: `**Relance n°${n}${send ? '' : DRAFT_MARK}** (en réponse à « ${p.mail_subject || ''} »)${before ? `\n_Avant : ${before}_` : ''}\n\n${plain(html)}`});
  // une relance ne compte (et ne fait avancer la tâche) qu'une fois partie : en brouillon, on attend l'envoi depuis Gmail
  await save('prospects', p.id, {mail_log_id: log?.id || null, ...(send ? {relances: n, last_contact: now} : {})}, {rerender: false});
  if (send) await relanceTask(st, projIds(p), p.mail_subject, true, byId('prospects', p.id), n);
  else toast('Relance en brouillon dans Gmail : elle sera comptée quand elle sera envoyée');
  render();
}

/** Brouillon de relance parti depuis Gmail : on la compte et on passe à la tâche suivante */
async function relanceSent(p){
  const st = byId('structures', p.structure_id); if (!st) return;
  const n = (p.relances || 0) + 1;
  await save('prospects', p.id, {relances: n}, {rerender: false});
  await relanceTask(st, projIds(p), p.mail_subject, true, byId('prospects', p.id), n);
}

/** Clôt les tâches de relance encore ouvertes du suivi (ou, pour les anciennes, de la structure) */
async function closeOpenRelances(st, p){
  for (const t of S.db.tasks.filter(t => !['Done', 'Cancelled'].includes(t.status) && (p && t.prospect_id === p.id && t.auto_kind || !t.prospect_id && t.structure_id === st.id && /^Relance — /.test(t.title || ''))))
    await save('tasks', t.id, {status: 'Done', done_at: new Date().toISOString()}, {rerender: false});
}

/** Tâche de relance suivante, rattachée au suivi : par mail à J+10, puis par téléphone après 3 relances par mail */
async function relanceTask(st, pids, subject, sent, p, n){
  await closeOpenRelances(st, p);
  const base = {department: 'Booking', status: 'To Do', assigned_to: S.user.email, deadline: inDays(RELANCE_DAYS),
    structure_id: st.id, project_ids: pids, project_id: pids[0] || null, prospect_id: p?.id || null};
  if (p && n >= MAIL_RELANCES){
    const phones = linksOfStructure(st.id).filter(c => c.phone).map(c => `${c.display_name} : ${c.phone}`);
    const hist = historyText(p);
    await insert('tasks', {...base, title: `Relance téléphone — ${st.name}`, auto_kind: 'relance_tel', tags: ['Call'],
      notes: `${n} relances par mail sans réponse (${hist}).\nAppelle${phones.length ? ' : ' + phones.join(' · ') : ''}.\nPas de réponse : bouton « Pas de réponse : clore le suivi » (ou supprime la tâche), le suivi est clos et noté dans le journal.`});
    await insert('prospect_logs', {prospect_id: p.id, date: today(), kind: 'Note', author: S.user.email,
      body: `**${n} relances par mail sans réponse** (${hist}) : la prochaine relance se fait par téléphone.`});
    return;
  }
  await insert('tasks', {...base, title: `Relance — ${st.name}`, auto_kind: 'relance_mail',
    notes: `${n ? `Relance n°${n}` : 'Mail'} « ${subject || ''} » ${sent ? 'envoyé le ' + fmtDate(today()) : 'préparé en brouillon le ' + fmtDate(today())}. Relance n°${n + 1} sur ${MAIL_RELANCES} par mail : bouton « Relance » sur le suivi ou la fiche de la structure.`});
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
const CHECKED = new Set();
export async function checkProspect(p, force=false){
  if (!p?.mail_thread_id || !scriptUrl() || (!force && CHECKED.has(p.id))) return;
  const log = p.mail_log_id ? byId('prospect_logs', p.mail_log_id) : null;
  if (!force && p.mail_sent_at && (!log || log.date)) return;
  CHECKED.add(p.id);
  try {
    const out = await callProspect('status', {thread_id: p.mail_thread_id});
    const sent = (out.sent || []).sort();
    if (!sent.length) return;
    const patch = {};
    if (!p.mail_sent_at) patch.mail_sent_at = sent[0];
    if (log && !log.date){
      // un envoi postérieur à la préparation du brouillon (sinon il est toujours en brouillon)
      const after = log.created_at ? sent.find(d => d.slice(0, 19) >= log.created_at.slice(0, 19)) : null;
      if (after){
        await save('prospect_logs', log.id, {date: after.slice(0, 10), body: String(log.body || '').replace(DRAFT_MARK, '')}, {rerender: false});
        if (/^\*\*Relance n°/.test(log.body || '')) await relanceSent(byId('prospects', p.id));
      }
      if (after) patch.last_contact = [p.last_contact, after.slice(0, 10)].filter(Boolean).sort().pop();
    }
    if (Object.keys(patch).length){ await save('prospects', p.id, patch, {rerender: false}); render(); }
  } catch (err) { /* script absent ou fil supprimé : on réessaiera à la prochaine session */ }
}

/** Appelé après chaque affichage : suivis visibles dont le mail est encore en brouillon */
export function checkVisibleProspects(){
  if (!scriptUrl()) return;
  const list = S.suiviPage ? [byId('prospects', S.suiviPage)] : S.structurePage ? prospectsOfStructure(S.structurePage) : [];
  list.filter(p => p?.mail_thread_id).forEach(p => checkProspect(p));
}

/** Le suivi le plus récent de la structure qui a un mail de prospection (pour le bouton « Relance ») */
export const lastProspectMail = stId => prospectsOfStructure(stId).filter(p => p.mail_thread_id && p.status !== 'Closed')
  .sort((a, b) => (b.mail_sent_at || b.updated_at || '').localeCompare(a.mail_sent_at || a.updated_at || ''))[0] || null;

export { PROSPECT_TAGS, logsOf };
