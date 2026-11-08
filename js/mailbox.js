/**
 * ✉️ Messagerie intégrée (v1.61) — boîte anthony@ (script de prospection). Gmail reste la référence : lu / non lu, libellés,
 * archive et corbeille sont faits dans Gmail (visibles dans Apple Mail), jamais de rangement parallèle ni de suppression définitive.
 *   - liste : table mail_threads (synchronisée toutes les 5 min par la fonction serveur mail-sync, ou « Actualiser ») ;
 *   - lecture : la conversation est relue dans Gmail à l'ouverture (corps affiché dans un cadre isolé, sans script) ;
 *   - rattachement : automatique seulement s'il est sans ambiguïté (base : mail_link_thread), sinon choix manuel (mail_link_manual) ;
 *   - réponse / réponse à tous / transfert / nouveau : brouillon ou envoi dans le fil ; journal du suivi écrit par la synchronisation,
 *     seulement une fois l'envoi confirmé par Gmail (aucun doublon : identifiant Gmail du message).
 */
import { render } from './app.js';
import { insert, sb, uploadFiles } from './data.js';
import { attOk, attSizeHTML, fill, mailVars, todoOk, tplLabel } from './mail.js';
import { callProspect, prospectVars } from './prospection.js';
import { byId, contactMails, linksOfStructure, projIds, projName, prospectTitle, prospectsOfStructure, setting, structName, suiviClosed } from './selectors.js';
import { S } from './state.js';
import { ARTIST_DOCS } from './artist-fields.js';
import { ask, askText, confirmAsk } from './ui/dialog.js';
import { openModal } from './ui/modal.js';
import { recipientsField, syncChips } from './ui/recipients.js';
import { rtStyle, rtToolbar, wrapMail } from './ui/richtext.js';
import { getDraft, setDraft, clearDraft } from './ui/drafts.js';
import { addDays, esc, fmtDate, toast, today, workDay } from './utils.js';

export const MAILBOX_ADDR = () => String(setting('prospect_from') || 'anthony@lartboristerie.com').toLowerCase();
const GMAIL_MAX_BYTES = 25 * 1024 * 1024;
export const MAIL_LINK_SECONDS = 600;   // lien temporaire d'une pièce jointe envoyée au script (CONVENTIONS §6.21)   // Gmail : 25 Mo pour le message ENCODÉ (vérifié aussi, exactement, par le script)
/** Taille du message une fois encodé : pièces jointes en base64 (4/3, lignes de 76 caractères + retour), texte HTML et texte brut
 *  en base64, en-têtes et séparateurs (marge de 16 Ko par pièce + 32 Ko). Estimation par excès : le script mesure le message réel. */
export const encodedSize = (fileBytes, htmlChars = 0) => {
  const b64 = n => Math.ceil(n / 3) * 4 * 78 / 76;
  return Math.ceil(fileBytes.reduce((a, n) => a + b64(Number(n) || 0) + 16384, 0) + 2 * b64(htmlChars * 3) + 32768);
};
const SYSTEM_LABELS = {INBOX: 'Boîte de réception', SENT: 'Envoyés', STARRED: 'Suivis', IMPORTANT: 'Important', UNREAD: 'Non lu', TRASH: 'Corbeille', SPAM: 'Spam', DRAFT: 'Brouillons'};
export const LINK_LABEL = {auto: 'Rattaché automatiquement', manuel: 'Rattaché à la main', a_rattacher: 'À rattacher', aucun: 'Aucun suivi (choisi à la main)'};
/** État affiché : un retrait manuel (« manuel » sans structure ni suivi) n'est plus « À rattacher » et n'est jamais refait automatiquement */
export const linkState = t => t.link_status === 'manuel' && !t.structure_id && !t.prospect_id ? 'aucun' : t.link_status;

/** État de l'espace Mails (mémoire de la page) */
export const M = {filter: 'inbox', label: '', labels: null, search: null, open: null, thread: null, loading: false, error: '', images: new Set()};

export const fmtSize = n => !n ? '' : n > 1e6 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko';
export const labelName = id => SYSTEM_LABELS[id] || (M.labels || []).find(l => l.id === id)?.name || id;
export const userLabels = () => (M.labels || []).filter(l => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
export const syncState = () => S.db.mail_sync_state.find(r => r.mailbox === 'anthony') || null;

/** Synchronisation par la fonction serveur (jamais de secret dans le navigateur) ; ids : conversations Gmail à relire tout de suite */
export async function mailSync(ids = null){
  const {data, error} = await sb.functions.invoke('mail-sync', {body: ids ? {mode: 'threads', ids} : {mode: 'sync'}});
  const out = data || await error?.context?.json?.().catch(() => null) || {ok: false, error: 'Synchronisation injoignable pour le moment.'};
  if (!out.ok) throw new Error(out.error || 'Synchronisation impossible');
  const {fetchAll} = await import('./data.js'), {touch} = await import('./state.js');
  for (const t of ['mail_threads', 'mail_sync_state', 'prospect_logs', 'tasks', 'notifications']){ S.db[t] = await fetchAll(t); touch(t); }
  return out;
}

let labelsLoading = null;   // une seule lecture des libellés à la fois (plusieurs réaffichages pendant l'attente)
export function loadLabels(force = false){
  if (M.labels && !force) return Promise.resolve(M.labels);
  return labelsLoading ||= callProspect('labels', {}).then(r => { M.labels = r.labels || []; }, e => { M.labels = []; M.error = e.message; })
    .then(() => { labelsLoading = null; return M.labels; });
}

/** Archivée = hors boîte de réception, ni corbeille ni spam (Gmail n'a pas de dossier « Archive » : c'est l'absence du libellé INBOX) */
export const ARCHIVED = 'ARCHIVED';
export const isArchived = t => { const l = t.labels || []; return !l.includes('INBOX') && !l.includes('TRASH') && !l.includes('SPAM'); };

/** Conversations de la liste, selon le filtre choisi et la recherche dans la page */
export function threadsShown(){
  const q = String(S.search.mails || '').trim().toLowerCase();
  let list = S.db.mail_threads.filter(t => !(t.labels || []).includes('TRASH') || M.filter === 'label' && M.label === 'TRASH');
  if (M.filter === 'search' && M.search) list = list.filter(t => M.search.includes(t.gmail_thread_id));
  else if (M.filter === 'inbox') list = list.filter(t => (t.labels || []).includes('INBOX'));
  else if (M.filter === 'unread') list = list.filter(t => t.unread);
  else if (M.filter === 'link') list = list.filter(t => t.link_status === 'a_rattacher' && !(t.labels || []).includes('SPAM'));
  else if (M.filter === 'label' && M.label === ARCHIVED) list = list.filter(isArchived);
  else if (M.filter === 'label' && M.label) list = list.filter(t => (t.labels || []).includes(M.label));
  if (q) list = list.filter(t => [t.subject, t.snippet, ...(t.participants || []), structName(t.structure_id)].some(x => String(x || '').toLowerCase().includes(q)));
  return list.sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));
}

/** Ouvre une conversation : relue dans Gmail (corps, pièces jointes), marquée lue comme dans Gmail et Apple Mail */
export async function openThread(id){
  const row = byId('mail_threads', id); if (!row) return;
  M.open = id; M.thread = null; M.loading = true; M.error = ''; render();
  try {
    M.thread = (await callProspect('thread', {thread_id: row.gmail_thread_id})).thread;
    if (row.unread){ await callProspect('modify', {thread_id: row.gmail_thread_id, read: true}); row.unread = false; }
  } catch (e) { M.error = e.message; }
  M.loading = false; render();
}

/** Rangement dans Gmail (libellé, archive, corbeille, lu / non lu), puis relecture de la conversation */
async function modify(row, payload, okMsg){
  try {
    await callProspect('modify', {thread_id: row.gmail_thread_id, ...payload});
    await mailSync([row.gmail_thread_id]);
    toast(okMsg);
  } catch (e) { toast(e.message, true); }
  render();
}

// ── Rattachement ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Structures candidates : celles des contacts dont l'adresse EXACTE participe à la conversation */
export function candidates(row){
  const mails = new Set((row.participants || []).map(a => a.toLowerCase()));
  const contacts = S.db.contacts.filter(c => [c.email, c.email_2].some(e => e && mails.has(String(e).trim().toLowerCase())));
  const sts = [...new Set(contacts.flatMap(c => S.db.contact_structures.filter(l => l.contact_id === c.id).map(l => l.structure_id)))].map(id => byId('structures', id)).filter(Boolean);
  return {contacts, structures: sts, unknown: [...mails].filter(m => !contacts.some(c => [c.email, c.email_2].some(e => e && String(e).trim().toLowerCase() === m)))};
}

export async function linkThread(id){
  const row = byId('mail_threads', id); if (!row) return;
  const cand = candidates(row);
  // plusieurs structures possibles et aucune choisie : la question est posée, jamais de premier choix d'office (règle d'Anthony)
  let picked = '';
  if (!row.structure_id && cand.structures.length > 1){
    picked = await ask({title: 'Plusieurs structures possibles', text: 'Les adresses de la conversation correspondent à plusieurs structures. Laquelle ?',
      actions: [...cand.structures.map(s => ({value: s.id, label: s.name})), {value: 'autre', label: 'Une autre structure'}]});
    if (picked == null) return;
    if (picked === 'autre') picked = '';
  }
  const values = {structure_id: row.structure_id || picked || (cand.structures.length === 1 ? cand.structures[0].id : ''), prospect_id: row.prospect_id || '', project_id: row.project_id || '', show_id: row.show_id || ''};
  // un seul suivi OUVERT pour la structure proposée : présélectionné (visible, modifiable) ; plusieurs : rien d'office
  if (values.structure_id && !values.prospect_id){ const open = prospectsOfStructure(values.structure_id).filter(p => !suiviClosed(p)); if (open.length === 1) values.prospect_id = open[0].id; }
  const suiviOpts = st => prospectsOfStructure(st).map(p => [p.id, prospectTitle(p) + (suiviClosed(p) ? ' (clos)' : '')]);
  const showOpts = st => S.db.shows.filter(s => s.structure_id === st).sort((a, b) => String(b.date).localeCompare(String(a.date))).map(s => [s.id, `${fmtDate(s.date)} · ${projName(s.project_id)}`]);
  const help = cand.structures.length ? `Structures trouvées par les adresses exactes : ${cand.structures.map(s => esc(s.name)).join(', ')}.` : 'Aucune structure trouvée par les adresses exactes des participants.';
  const done = openModal({title: 'Rattacher la conversation', fields: [
    {k: 'structure_id', label: 'Structure', type: 'ac', kind: 'structures', create: true},
    {k: 'prospect_id', label: 'Suivi', type: 'select', options: values.structure_id ? suiviOpts(values.structure_id) : [], help: 'Les échanges de la conversation entrent dans le journal de ce suivi.'},
    {k: 'project_id', label: 'Artiste / projet', type: 'project'},
    {k: 'show_id', label: 'Date', type: 'select', options: values.structure_id ? showOpts(values.structure_id) : []},
  ], values, extraTop: `<p class="help mb">${help}${cand.unknown.length ? ` Adresses inconnues : ${cand.unknown.map(esc).join(', ')} — « Créer le contact » ci-dessous.` : ''}</p>
    ${cand.unknown.length ? `<p class="mb">${cand.unknown.map(m => `<button type="button" class="btn sm" data-act="mailNewContact" data-mail="${esc(m)}">Créer le contact ${esc(m)}</button>`).join(' ')}</p>` : ''}`,
    saveLabel: 'Rattacher', onSave: async v => {
      if (v.prospect_id && !prospectsOfStructure(v.structure_id).some(p => p.id === v.prospect_id)){ toast('Ce suivi n’appartient pas à cette structure', true); return false; }
      const {error} = await sb.rpc('mail_link_manual', {p_thread: id, p_structure: v.structure_id || null, p_prospect: v.prospect_id || null, p_project: v.project_id || null, p_show: v.show_id || null});
      if (error){ toast('Rattachement impossible : ' + error.message, true); return false; }
      await mailSync([row.gmail_thread_id]).catch(e => toast(e.message, true));
      toast(v.structure_id || v.prospect_id ? 'Conversation rattachée' : 'Rattachement retiré : la conversation reste sans suivi (jamais rattachée automatiquement)');
      return true;
    }});
  // structure changée : suivis et dates proposés relus pour la structure choisie (jamais ceux d'une autre)
  const dlg = document.querySelector('#modal'), stOf = () => dlg.querySelector('[name="structure_id"]')?.value || '';
  const refill = (name, opts) => { const sel = dlg.querySelector(`select[name="${name}"]`); if (!sel) return; const cur = sel.value, list = stOf() ? opts(stOf()) : [];
    sel.innerHTML = '<option value="">—</option>' + list.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join(''); };
  for (const [name, opts] of [['prospect_id', suiviOpts], ['show_id', showOpts]]) dlg.querySelector(`select[name="${name}"]`)?.addEventListener('focus', () => refill(name, opts));
  return done;
}

// ── Rédaction ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Destinataires proposés : adresse de réponse sinon expéditeur ; « à tous » : + destinataires et copies, sans la boîte elle-même */
export function replyTargets(msg, all){
  const me = MAILBOX_ADDR(), fmt = a => a.email;
  const first = msg.direction === 'out' ? msg.to : (msg.reply_to?.length ? msg.reply_to : [msg.from]);
  const to = [...first].map(fmt);
  const cc = all ? [...(msg.direction === 'out' ? [] : msg.to), ...msg.cc].map(fmt) : [];
  const uniq = list => list.filter((e, i, a) => e && e.toLowerCase() !== me && a.findIndex(x => x.toLowerCase() === e.toLowerCase()) === i);
  const T = uniq(to); return {to: T.join(', '), cc: uniq(cc).filter(e => !T.some(x => x.toLowerCase() === e.toLowerCase())).join(', ')};
}

/** Variables des modèles : contexte choisi (structure, contact, artiste, date) ; absentes → « [x à compléter] » surligné */
async function contextVars(ctx){
  const st = byId('structures', ctx.structure_id), contact = byId('contacts', ctx.contact_id);
  const pids = ctx.project_id ? [ctx.project_id] : [];
  let vars = st ? prospectVars(st, {pids, contact, show: byId('shows', ctx.show_id)}) : {contact: contact?.first_name || '', artiste: pids.map(projName).join(', ')};
  if (ctx.show_id) vars = {...vars, ...Object.fromEntries(Object.entries(await mailVars(ctx.show_id, ctx.contact_id)).filter(([, v]) => v != null && v !== ''))};
  return vars;
}

const DOC_LABEL = k => (ARTIST_DOCS.find(d => d[0] === k) || [])[1] || '';
/**
 * Documents déjà stockés d'un artiste / projet (v1.63), sans nouveau téléversement : fiche artiste (fiche technique, dossier de presse,
 * logos…), documents du projet, fichiers du suivi rattaché. Toujours de VRAIES pièces jointes (jamais un lien), lues par le script
 * avec un lien temporaire (stockage privé, 10 min) ou avec les droits du compte Google (Drive) : aucun Drive installé sur l'ordinateur.
 * Taille lue dans le stockage ou dans le Drive ; document Drive inaccessible : signalé, jamais joint ni remplacé par un lien.
 */
export async function projectDocs(projectId, prospectId = null){
  const p = byId('projects', projectId), out = [];
  for (const d of (p?.artist_docs || []).filter(d => d.path || d.file_id))
    out.push({name: d.drive_name || d.name || 'Document', kind: DOC_LABEL(d.kind) || d.label || 'Fiche artiste', group: 'Fiche artiste',
      path: d.path || null, bucket: d.path ? 'artiste' : null, file_id: d.path ? null : d.file_id || null, size: Number(d.size) || 0, on: true});
  for (const a of S.db.attachments.filter(a => a.project_id === projectId && !a.task_id && a.path && a.mime !== 'link'))
    out.push({name: a.name, kind: 'Document du projet', group: 'Projet', path: a.path, bucket: 'suivi', file_id: null, size: Number(a.size) || 0, on: true});
  for (const f of prospectId ? S.db.prospect_files.filter(f => f.prospect_id === prospectId && f.path && f.mime !== 'link') : [])
    out.push({name: f.name, kind: 'Fichier du suivi', group: 'Suivi', path: f.path, bucket: 'suivi', file_id: null, size: Number(f.size) || 0, on: true});
  // tailles manquantes : stockage « artiste » (métadonnées) ; Drive : lues par le script de la boîte (droits de ce compte)
  await Promise.all(out.filter(d => !d.size && d.bucket === 'artiste').map(async d => { const i = d.path.lastIndexOf('/');
    const {data} = await sb.storage.from('artiste').list(d.path.slice(0, i), {search: d.path.slice(i + 1)});
    d.size = Number(data?.find(x => x.name === d.path.slice(i + 1))?.metadata?.size) || 0; }));
  const drive = out.filter(d => d.file_id);
  if (drive.length){
    try { const r = await callProspect('files_info', {ids: drive.map(d => d.file_id)});
      for (const d of drive){ const f = (r.files || []).find(x => x.id === d.file_id);
        if (f?.ok){ d.size = Number(f.size) || 0; d.name = f.name || d.name; } else d.blocked = f?.error || 'Inaccessible depuis ce compte Google'; } }
    catch (e) { for (const d of drive) d.blocked = 'Taille et accès non vérifiés (' + e.message + ')'; }
  }
  return out;
}

/**
 * Fenêtre de rédaction. mode : 'reply' | 'reply_all' | 'forward' | 'new'. row : conversation (mail_threads) ou null pour un nouveau mail.
 * Aucun texte, destinataire ni pièce jointe n'est remplacé en silence : un modèle s'INSÈRE (au curseur, sinon à la fin).
 */
export async function compose(mode, row = null, msg = null){
  // (v1.63, relecture) « Nouveau mail » est vraiment nouveau, même depuis une conversation ouverte : aucun fil, aucun « Re: »
  if (mode === 'new'){ row = null; msg = null; }
  const t = mode === 'new' ? null : M.thread, base = msg || t?.messages?.[t.messages.length - 1] || null;
  // brouillon local propre au message visé (répondre à un message précis ≠ répondre au dernier)
  const key = `mail:${mode}:${row?.gmail_thread_id || 'new'}:${msg?.id || ''}`, saved = getDraft(key) || {};
  const targets = base && mode !== 'forward' && mode !== 'new' ? replyTargets(base, mode === 'reply_all') : {to: '', cc: ''};
  const ctx = {structure_id: row?.structure_id || '', contact_id: '', project_id: row?.project_id || (row?.prospect_id ? projIds(byId('prospects', row.prospect_id))[0] : '') || '', show_id: row?.show_id || ''};
  const contacts = ctx.structure_id ? linksOfStructure(ctx.structure_id) : [];
  // contact des balises : celui dont une adresse est EXACTEMENT un destinataire, s'il est le seul (jamais le premier de la structure)
  const toSet = new Set(targets.to.toLowerCase().split(',').map(x => x.trim()).filter(Boolean));
  const hits = contacts.filter(c => contactMails(c).toLowerCase().split(', ').some(e => e && toSet.has(e)));
  ctx.contact_id = hits.length === 1 ? hits[0].id : '';
  let files = saved.files || (mode === 'forward' ? [] : []), draftId = saved.draft_id || null, wantDraft = false;
  // transfert : seules les vraies pièces jointes d'origine (les images intégrées au texte ne sont ni listées ni jointes)
  const keepFwd = mode === 'forward' ? (base?.attachments || []).filter(a => !a.inline) : [];
  const sig = setting('prospect_signature') || '';
  const subjectDefault = !base ? '' : mode === 'forward' ? (/^(tr|fwd?)\s*:/i.test(base.subject) ? base.subject : 'Tr : ' + base.subject) : (/^re\s*:/i.test(base.subject) ? base.subject : 'Re: ' + base.subject);
  const tpls = S.db.mail_templates.slice().sort((a, b) => (a.kind || '').localeCompare(b.kind || '') || (a.name || '').localeCompare(b.name || ''));
  const projs = S.db.projects.filter(p => p.active || p.id === ctx.project_id);
  const title = {reply: 'Répondre', reply_all: 'Répondre à tous', forward: 'Transférer', new: 'Nouveau mail'}[mode];
  const extra = `<div class="mail-wrap">
    ${base ? `<p class="mode-note">${mode === 'forward' ? 'Transfert' : 'Réponse dans le fil'} « ${esc(base.subject || '')} » (${esc(base.from?.email || '')}, ${fmtDate(base.date)}) : le message d’origine est cité sous le texte.</p>` : ''}
    <div class="mail-grid">
      <label for="mc-contact" class="rcpt-who">Interlocuteur</label><span class="mail-to rcpt-who"><select id="mc-contact"><option value="">— aucun —</option>${contacts.map(c => `<option value="${c.id}" ${c.id === ctx.contact_id ? 'selected' : ''}>${esc(c.display_name)}${contactMails(c) ? ` · ${esc(contactMails(c))}` : ' (pas de mail)'}</option>`).join('')}</select>
        <small class="muted">prénom et balises des modèles ; ne change pas les destinataires</small><span class="rcpt-propose"></span></span>
      <label for="mc-to-q">À</label>${recipientsField('mc-to', ctx.structure_id || null, {value: saved.to ?? targets.to, label: 'Destinataires', interlocutor: 'mc-contact'})}
      <label for="mc-cc-q">Copie</label>${recipientsField('mc-cc', ctx.structure_id || null, {value: saved.cc ?? targets.cc, label: 'Copies'})}
      <label for="mc-bcc-q">Copie cachée</label>${recipientsField('mc-bcc', ctx.structure_id || null, {value: saved.bcc || '', label: 'Copies cachées'})}
      <label for="mc-subj">Objet</label><input id="mc-subj" value="${esc(saved.subject ?? subjectDefault)}" ${mode === 'reply' || mode === 'reply_all' ? 'readonly title="Une réponse garde l’objet du fil"' : ''}>
      <label for="mc-proj">Artiste</label><select id="mc-proj"><option value="">—</option>${projs.map(p => `<option value="${p.id}" ${p.id === ctx.project_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <label for="mc-tpl">Modèle</label><span class="mail-to"><select id="mc-tpl"><option value="">— choisir —</option>${tpls.map(x => `<option value="${x.id}">${esc(x.name || 'Modèle')} · ${esc(tplLabel(x))}</option>`).join('')}</select>
        <button type="button" class="btn sm" id="mc-ins">Insérer</button></span>
    </div>
    <p class="help">Insérer un modèle ajoute son texte à l’endroit du curseur, après un texte sélectionné (sinon en haut du texte) : rien de ce qui est déjà écrit, ni les destinataires, ni les pièces jointes ne sont remplacés. Balises vides : surlignées « à compléter ».</p>
    ${rtToolbar('mc-body')}<div class="mail-preview" id="mc-body" contenteditable="true" style="${rtStyle()}" aria-label="Texte du mail">${saved.html ?? (sig ? '<br><br>' + sig : '')}</div>
    <div class="ml-att"><b class="fiche-lbl">Pièces jointes</b> <span id="mc-files"></span>
      <button type="button" class="btn sm" id="mc-docs">Ajouter depuis un projet/spectacle</button>
      <label class="btn sm file-btn">Ajouter un fichier<input type="file" class="file-input" multiple id="mc-up"></label></div>
    ${keepFwd.length ? `<label class="check"><input type="checkbox" id="mc-keep" checked> Joindre les ${keepFwd.length} pièce${keepFwd.length > 1 ? 's' : ''} jointe${keepFwd.length > 1 ? 's' : ''} d’origine (${keepFwd.map(a => esc(a.name) + ' ' + fmtSize(a.size)).join(', ')})</label>` : ''}
    <p class="help">Envoyé depuis <b>${esc(MAILBOX_ADDR())}</b>. Le journal du suivi est complété quand Gmail confirme l’envoi (jamais avant) ; la réponse apparaît dans « Envoyés » de Gmail et d’Apple Mail.</p></div>`;
  const $ = sel => document.querySelector('#modal ' + sel);
  const current = () => ({to: $('#mc-to').value.trim(), cc: $('#mc-cc').value.trim(), bcc: $('#mc-bcc').value.trim(), subject: $('#mc-subj').value.trim(), html: $('#mc-body').innerHTML});
  const keep = () => { setDraft(key, {...current(), files, draft_id: draftId}); };
  const sizes = () => [...files.filter(f => f.on).map(f => f.size), ...($('#mc-keep')?.checked ? keepFwd.map(f => f.size) : [])];
  const totalMb = () => encodedSize(sizes(), $('#mc-body').innerHTML.length + (base?.html?.length || 0)) / 1048576;
  const drawFiles = () => { $('#mc-files').innerHTML = files.length ? attSizeHTML(files) + ' ' + files.map((f, i) => `<label class="att-chip"><input type="checkbox" data-att="${i}" ${f.on ? 'checked' : ''}> 📎 ${esc(f.name)} <span class="muted">${fmtSize(f.size) || 'taille inconnue'}</span></label>`).join('') : '<span class="muted">aucune</span>'; keep(); };
  const done = openModal({title: `${title}${row?.subject ? ' · ' + row.subject : ''}`, fields: [], extra, mail: true, wide: true, saveLabel: 'Envoyer', footExtra: '<button type="button" class="btn" id="mc-draft">Enregistrer en brouillon</button>',
    onSave: async () => {
      const m = current(), send = !wantDraft; wantDraft = false;
      if (!m.to && send) { toast('Indique au moins un destinataire', true); return false; }
      if (!m.subject && mode === 'new') { toast('Indique l’objet du mail', true); return false; }
      if (!(await todoOk(m))) return false;
      if (files.some(f => f.on && !f.size)) { toast('Une pièce jointe a une taille inconnue : retire-la ou ajoute le fichier lui-même', true); return false; }
      if (totalMb() * 1048576 > GMAIL_MAX_BYTES) { toast(`Message trop lourd : environ ${totalMb().toFixed(1).replace('.', ',')} Mo une fois encodé, pièces jointes comprises (Gmail : 25 Mo au plus). Rien n’est parti.`, true); return false; }
      if (!(await attOk(files))) return false;
      if (send && !(await confirmAsk('Envoyer le mail ?', `Le mail part maintenant à ${m.to}${m.cc ? ` (copie : ${m.cc})` : ''}${m.bcc ? ` (copie cachée : ${m.bcc})` : ''}, depuis ${MAILBOX_ADDR()}.`, 'Envoyer le mail'))) return false;
      try {
        // pièces jointes : lien temporaire DÉDIÉ de 10 min (lu une seule fois par le script), stockage « artiste » ou « suivi » —
        // jamais le lien de 6 h mis en cache pour l'affichage (signedUrl)
        const attachments = await Promise.all(files.filter(f => f.on).map(async f => f.path
          ? {url: (await sb.storage.from(f.bucket || 'suivi').createSignedUrl(f.path, MAIL_LINK_SECONDS)).data?.signedUrl, name: f.name}
          : {id: f.file_id, name: f.name}));
        if (attachments.some(a => !a.url && !a.id)) throw new Error('Une pièce jointe est illisible : rien n’est parti.');
        const out = await callProspect('compose', {mode, thread_id: row?.gmail_thread_id || null, message_id: base?.id || null, to: m.to, cc: m.cc, bcc: m.bcc,
          subject: mode === 'reply' || mode === 'reply_all' ? '' : m.subject, html: wrapMail(m.html), attachments, keep_attachments: !!$('#mc-keep')?.checked, send, draft_id: draftId});
        if (send){
          if (!out.sent) throw new Error('Gmail n’a pas confirmé l’envoi : rien n’est noté au journal.');
          clearDraft(key);
          await mailSync([out.thread_id]).catch(e => toast('Envoyé, mais journal pas encore à jour : ' + e.message, true));
          toast('Mail envoyé');
        } else { draftId = out.draft_id || draftId; keep(); toast('Brouillon enregistré dans Gmail'); }
        render(); return send;   // brouillon : la fenêtre reste ouverte
      } catch (err) {
        // brouillon supprimé ou envoyé depuis Gmail / Apple Mail : rien n'est parti ; le prochain essai crée un nouveau brouillon
        if (/BROUILLON_ABSENT/.test(err.message)){ draftId = null; keep();
          toast('Le brouillon n’existe plus dans Gmail (envoyé ou supprimé depuis Gmail ou Apple Mail) : rien n’est parti. Vérifie « Envoyés », puis recommence si besoin (un nouveau brouillon sera créé).', true); }
        else toast(err.message, true);
        return false; }
    }});
  syncChips(document.querySelector('#modal')); drawFiles();
  ['#mc-to', '#mc-cc', '#mc-bcc', '#mc-subj'].forEach(s => $(s).addEventListener('input', keep));
  $('#mc-body').addEventListener('input', keep);
  let range = null;
  $('#mc-body').addEventListener('blur', () => { const sel = getSelection(); if (sel.rangeCount && $('#mc-body').contains(sel.anchorNode)) range = sel.getRangeAt(0).cloneRange(); });
  $('#mc-proj').onchange = e => { ctx.project_id = e.target.value; };
  $('#mc-contact').onchange = e => { ctx.contact_id = e.target.value; };
  $('#mc-contact').addEventListener('interlocutor', () => { ctx.contact_id = $('#mc-contact').value; });   // « Utiliser X comme interlocuteur »
  $('#mc-ins').onclick = async () => {
    const tp = byId('mail_templates', $('#mc-tpl').value); if (!tp) return toast('Choisis un modèle', true);
    const vars = await contextVars(ctx), html = fill(tp.html, vars, true);
    const node = document.createElement('div'); node.innerHTML = html;
    // jamais de remplacement : une sélection reste en place, le modèle s'insère juste après (au curseur), sinon en haut du texte
    if (range){ range.collapse(false); range.insertNode(node); range = null; } else $('#mc-body').insertBefore(node, $('#mc-body').firstChild);
    // objet vide (nouveau mail, transfert) : celui du modèle ; un objet déjà écrit n'est jamais remplacé
    if (!$('#mc-subj').readOnly && !$('#mc-subj').value.trim() && tp.subject) $('#mc-subj').value = fill(tp.subject, vars, false);
    // copie du modèle : ajoutée aux copies existantes, jamais à leur place
    if (tp.cc){ const cur = $('#mc-cc').value.trim(); if (!cur.toLowerCase().includes(tp.cc.toLowerCase())) $('#mc-cc').value = cur ? cur + ', ' + tp.cc : tp.cc; }
    for (const a of tp.attachments || []) if (!files.some(f => (f.path || f.file_id) === (a.path || a.id))) files.push({name: a.name, path: a.path || null, file_id: a.id || null, size: a.size || 0, on: true});
    drawFiles(); syncChips(document.querySelector('#modal'));
    const missing = [...new Set([...html.matchAll(/\[(\w+) à compléter\]/g)].map(x => x[1]))];
    if (missing.length) toast('À compléter avant l’envoi : ' + missing.join(', '), true);
  };
  $('#mc-docs').onclick = async () => {
    if (!ctx.project_id && !row?.prospect_id) return toast('Choisis d’abord l’artiste', true);
    const all = await projectDocs(ctx.project_id, row?.prospect_id || null);
    const same = (f, d) => d.path ? f.path === d.path : f.file_id === d.file_id;
    const docs = all.filter(d => !d.blocked && !files.some(f => same(f, d))), blocked = all.filter(d => d.blocked);
    const why = blocked.length ? ` Non joignables (${blocked.map(d => d.name).join(', ')}) : document Drive inaccessible au compte ${MAILBOX_ADDR()} — partage son dossier avec ce compte, ou dépose le fichier dans la fiche artiste.` : '';
    if (!docs.length) return toast((all.length ? 'Tous les documents sont déjà joints.' : 'Aucun document stocké pour cet artiste ni ce suivi.') + why, true);
    // plusieurs pièces : la question revient après chaque ajout, jusqu'à « Terminé » (noms et tailles visibles)
    let left = docs;
    for (;;){
      const choice = await ask({title: `Documents · ${projName(ctx.project_id) || 'suivi'}`, text: `Chaque document choisi part en vraie pièce jointe (pas de lien).${why}`,
        actions: [...left.map((d, i) => ({value: String(i), label: `${d.kind} · ${d.name} (${fmtSize(d.size) || 'taille inconnue'})`})),
          ...(left.length > 1 ? [{value: 'all', label: `Tous (${left.length})`}] : [])], cancel: files.length ? 'Terminé' : 'Annuler'});
      if (choice == null) break;
      const add = choice === 'all' ? left : [left[Number(choice)]];
      files.push(...add.map(d => ({...d}))); left = left.filter(d => !add.includes(d)); drawFiles();
      if (!left.length) break;
    }
  };
  $('#mc-files').addEventListener('change', e => { const i = e.target.dataset.att; if (i != null){ files[i].on = e.target.checked; drawFiles(); } });
  $('#mc-up').addEventListener('change', async e => {
    for (const f of e.target.files){
      const path = `mails/messagerie/${Date.now()}_${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const {error} = await sb.storage.from('suivi').upload(path, f, {contentType: f.type || 'application/octet-stream'});
      if (error){ toast('Envoi impossible : ' + error.message, true); continue; }
      files.push({path, bucket: 'suivi', name: f.name, size: f.size, on: true});
    }
    e.target.value = ''; drawFiles();
  });
  $('#mc-draft').onclick = () => { wantDraft = true; document.querySelector('#modal form').requestSubmit(); };
  return done;
}

// ── Pièce jointe reçue : aperçu / conservation explicite dans le suivi ───────────────────────────────────────────────────────
async function fetchAttachment(msgId, att){
  const out = await callProspect('attachment', {message_id: msgId, attachment_id: att.id});
  const bin = atob(String(out.data).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], att.name, {type: att.mime || 'application/octet-stream'});
}

// ── Relance programmée depuis une conversation (tâche de relance existante) ─────────────────────────────────────────────────
async function scheduleRelance(row){
  const p = byId('prospects', row.prospect_id); if (!p) return toast('Rattache d’abord la conversation à un suivi', true);
  const st = byId('structures', p.structure_id);
  if (st?.inactive_at) return toast(`« ${st.name} » est inactive : les relances restent suspendues`, true);
  if (suiviClosed(p)) return toast('Ce suivi est clos : pas de relance', true);
  const def = workDay(addDays(today(), 10));
  const v = await askText({title: 'Programmer une relance', label: 'Date de la relance (JJ/MM/AAAA)', value: fmtDate(def), check: x => /^\d{2}\/\d{2}\/\d{4}$/.test(x) ? '' : 'Format JJ/MM/AAAA'});
  if (!v) return;
  const [d, mo, y] = v.split('/'), deadline = workDay(`${y}-${mo}-${d}`);
  await insert('tasks', {title: `Relance — ${st?.name || prospectTitle(p)}`, department: 'Booking', status: 'To Do', assigned_to: S.user.email, deadline,
    structure_id: p.structure_id, prospect_id: p.id, project_ids: projIds(p), project_id: projIds(p)[0] || null, auto_kind: 'relance_mail',
    notes: `Relance de la conversation « ${row.subject || ''} » (messagerie). Suspendue automatiquement si une réponse arrive avant.`});
  toast('Relance programmée le ' + fmtDate(deadline)); render();
}

/**
 * Notification « Relances à vérifier » (correction du suivi d'une conversation, v1.63) : rien n'est rétabli d'office ;
 * l'équipe choisit « Rétablir les relances » (fonction serveur mail_restore_relances) ou « Annuler ».
 */
export async function restoreRelancesAsk(n){
  const [, msgId, prospectId] = String(n.dedupe_key || '').split(':');
  const p = byId('prospects', prospectId);
  const choice = await ask({title: 'Relances à vérifier', text: `${n.body || ''}\nRétablir les relances de « ${p ? prospectTitle(p) : 'ce suivi'} » ? Elles redeviennent « À faire » avec leurs échéances d'origine.`,
    actions: [{value: 'ok', label: 'Rétablir les relances'}]});
  if (choice !== 'ok') return false;
  const {data, error} = await sb.rpc('mail_restore_relances', {p_message: msgId, p_prospect: prospectId});
  if (error){ toast('Rétablissement impossible : ' + error.message, true); return false; }
  const {fetchAll} = await import('./data.js'), {touch} = await import('./state.js');
  S.db.tasks = await fetchAll('tasks'); touch('tasks');
  toast(data ? `${data} relance${data > 1 ? 's' : ''} rétablie${data > 1 ? 's' : ''}` : 'Aucune relance à rétablir (déjà rétablie ou terminée)');
  render(); return true;
}

export const MAIL_ACTIONS = {
  mailFilter: t => { M.filter = t.dataset.f; M.label = t.dataset.label || ''; M.open = null; render(); },
  mailLabelPick: t => { M.filter = t.value ? 'label' : 'inbox'; M.label = t.value; M.open = null; render(); },
  mailRefresh: async () => { try { const o = await mailSync(); toast(`Synchronisé : ${o.threads} conversation${o.threads > 1 ? 's' : ''}${o.remaining ? ` (${o.remaining} au prochain passage)` : ''}`); } catch (e) { toast(e.message, true); } render(); },
  mailSearchGmail: async () => {
    const q = String(S.search.mails || '').trim(); if (!q) return toast('Tape d’abord ce que tu cherches', true);
    try { const r = await callProspect('threads', {q}); M.search = (r.threads || []).map(x => x.id); M.filter = 'search';
      if (M.search.length) await mailSync(M.search); S.search.mails = ''; toast(`${M.search.length} conversation${M.search.length > 1 ? 's' : ''} trouvée${M.search.length > 1 ? 's' : ''} dans Gmail`); }
    catch (e) { toast(e.message, true); }
    render(); },
  mailOpen: t => openThread(t.dataset.id),
  mailImages: t => { M.images.add(t.dataset.msg); render(); },   // images distantes : seulement sur demande, pour ce message
  mailBack: () => { M.open = null; M.thread = null; render(); },
  mailCompose: t => t.dataset.mode === 'new' ? compose('new')
    : compose(t.dataset.mode, M.open ? byId('mail_threads', M.open) : null, t.dataset.msg ? M.thread?.messages.find(m => m.id === t.dataset.msg) : null),
  mailLink: t => linkThread(t.dataset.id || M.open),
  mailNewContact: async t => { const {editContact} = await import('./forms.js').catch(() => ({})); if (editContact) editContact(null, {email: t.dataset.mail}); else toast('Crée le contact depuis l’onglet Contacts', true); },
  mailArchive: () => { const r = byId('mail_threads', M.open); if (r) modify(r, {archive: true}, 'Archivée (retirée de la boîte de réception)'); },
  mailInbox: () => { const r = byId('mail_threads', M.open); if (r) modify(r, {add: ['INBOX']}, 'Remise dans la boîte de réception'); },
  mailTrash: async () => { const r = byId('mail_threads', M.open); if (!r) return;
    if (!(await confirmAsk('Mettre à la corbeille ?', 'La conversation part dans la corbeille de Gmail (récupérable 30 jours). Rien n’est supprimé dans L’ArtBotrice ni dans le journal du suivi.', 'Mettre à la corbeille', {danger: true}))) return;
    await modify(r, {trash: true}, 'Mise à la corbeille de Gmail'); M.open = null; render(); },
  mailUnread: () => { const r = byId('mail_threads', M.open); if (r){ modify(r, {read: false}, 'Marquée non lue'); M.open = null; } },
  mailLabel: async () => { const r = byId('mail_threads', M.open); if (!r) return; await loadLabels();
    const ls = userLabels(); if (!ls.length) return toast('Aucun libellé dans Gmail (les libellés se créent dans Gmail ou Apple Mail)', true);
    const choice = await ask({title: 'Libellés', text: 'Coche / décoche dans Gmail (un libellé = un dossier dans Apple Mail). Aucun libellé n’est créé ici.',
      actions: ls.map(l => ({value: l.id, label: `${(r.labels || []).includes(l.id) ? '✓ Retirer' : 'Ajouter'} « ${l.name} »`}))});
    if (choice == null) return;
    const on = (r.labels || []).includes(choice);
    await modify(r, on ? {remove: [choice]} : {add: [choice]}, on ? 'Libellé retiré' : 'Libellé ajouté'); },
  mailRelance: () => { const r = byId('mail_threads', M.open); if (r) scheduleRelance(r); },
  mailAttPreview: async t => { try { const f = await fetchAttachment(t.dataset.msg, M.thread.messages.find(m => m.id === t.dataset.msg).attachments[Number(t.dataset.i)]);
    // affichés seulement : PDF et images courantes ; tout le reste (HTML, SVG, XML…) est téléchargé, jamais ouvert comme une page
    const u = URL.createObjectURL(f);
    if (/^(application\/pdf|image\/(png|jpeg|gif|webp))$/i.test(f.type)) window.open(u, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(u), 60000); } catch (e) { toast(e.message, true); } },
  // conserver une pièce reçue : seulement sur action explicite, dans le suivi ou dans les documents du projet (artiste) rattachés
  mailAttKeep: async t => { const r = byId('mail_threads', M.open); if (!r) return;
    const att = M.thread.messages.find(m => m.id === t.dataset.msg).attachments[Number(t.dataset.i)];
    const pid = r.project_id || (r.prospect_id ? projIds(byId('prospects', r.prospect_id) || {})[0] : '') || '';
    const actions = [...(r.prospect_id ? [{value: 'suivi', label: `Dans le suivi « ${prospectTitle(byId('prospects', r.prospect_id))} »`}] : []),
      ...(pid ? [{value: 'projet', label: `Dans les documents de ${projName(pid)}`}] : [])];
    if (!actions.length) return toast('Rattache d’abord la conversation à un suivi ou à un artiste', true);
    const where = await ask({title: 'Conserver la pièce jointe ?', text: `« ${att.name} » (${fmtSize(att.size)}) est copiée ; l’original reste dans Gmail.`, actions});
    if (where == null) return;
    try { await uploadFiles(where === 'suivi' ? {prospect_id: r.prospect_id} : {project_id: pid}, [await fetchAttachment(t.dataset.msg, att)]); } catch (e) { toast(e.message, true); }
    render(); },
  mailUntrash: () => { const r = byId('mail_threads', M.open); if (r) modify(r, {untrash: true}, 'Retirée de la corbeille de Gmail'); },
};
