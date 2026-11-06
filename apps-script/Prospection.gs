/**
 * Matrice L'ArtBoristerie : PROSPECTION (script à installer sur le compte Gmail qui prospecte, ex. anthony@)
 *
 * Le site prépare le mail ; ce script le crée en brouillon (ou l'envoie) depuis CE compte Gmail,
 * et fait les relances en réponse dans le même fil, pour garder l'historique.
 *
 * Installation (une seule fois) : voir Réglages › Prospection dans la Matrice.
 *  1. script.google.com (connecté avec le compte qui prospecte) › Nouveau projet › coller ce code.
 *  2. À gauche « Services » › + › « Gmail API » › Ajouter (sert aux relances dans le même fil).
 *  3. Déployer › Nouveau déploiement › Application Web · Exécuter en tant que : moi · Accès : Tout le monde.
 *  4. Coller l'adresse du déploiement (…/exec) dans Réglages › Prospection.
 *  5. Paramètres du projet (roue dentée) › Propriétés du script › ajouter WEBHOOK_SECRET = le code secret des scripts
 *     (même valeur que le script principal ; il n'est plus affiché dans la Matrice : Supabase › table settings › drive_webhook_secret).
 *  6. (v1.60.4) Même endroit : ajouter CLE_BOITE = la clé de la boîte (Supabase › Table Editor › schéma private ›
 *     import_secrets › ligne mailbox_sign_key › valeur). Sans elle, la recherche d'un message par son identifiant est refusée.
 *
 * Le code secret n'est jamais écrit dans ce code (v1.47) : il est lu dans les propriétés du script. Un script déjà installé
 * avec le code écrit en dur continue de fonctionner tel quel (la Matrice envoie toujours le même code, depuis son serveur).
 */
/** Version du code (renvoyée par « ping », pour vérifier le redéploiement) */
var SCRIPT_VERSION = 'v1.60.4';
var SECRET = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (!SECRET) return json_({ ok: false, error: 'Script de prospection : ajoute la propriété WEBHOOK_SECRET (Paramètres du projet › Propriétés du script)' });
    if (!body.secret || body.secret !== SECRET) return json_({ ok: false, error: 'Code secret du script de prospection incorrect' });
    var a = body.action;
    if (a === 'ping') out = { ok: true, account: Session.getEffectiveUser().getEmail(), version: SCRIPT_VERSION };
    else if (a === 'mail') out = mail_(body);
    else if (a === 'reply') out = reply_(body);
    else if (a === 'status') out = status_(body.thread_id);
    else if (a === 'mail_by_msgid') out = ownerOnly_(body, a) || mailByMsgId_(body.message_id);   // v1.60.4 : lecture seule, titulaire de la boîte seulement
    // messagerie intégrée (v1.61) : Gmail reste la référence ; aucune suppression définitive
    else if (a === 'threads') out = threads_(body);
    else if (a === 'thread') out = thread_(body);
    else if (a === 'labels') out = labels_();
    else if (a === 'modify') out = modify_(body);
    else if (a === 'compose') out = compose_(body);
    else if (a === 'attachment') out = attachment_(body);
    else if (a === 'history') out = history_(body);
    else out = { ok: false, error: 'Action inconnue : ' + a };
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json_(out);
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Pièces jointes : fichiers Drive {id} ou fichiers de la Matrice {url (lien temporaire), name} */
function blobs_(list) {
  return (list || []).map(function (f) {
    try {
      if (f.id) return DriveApp.getFileById(f.id).getBlob();
      if (f.url) return UrlFetchApp.fetch(f.url).getBlob().setName(f.name || 'piece-jointe');
    } catch (err) { Logger.log('Pièce jointe : ' + err); }
    return null;
  }).filter(Boolean);
}

// ─────────────── Boîte réservée à son titulaire (v1.60.4) ───────────────
/**
 * Décision d'Anthony du 08/11/2026 : la recherche par Message-ID dans CETTE boîte (anthony@) est réservée à son titulaire ;
 * connaître l'identifiant d'un message (ou le code secret des scripts) n'autorise pas à consulter la boîte.
 * Le relais serveur script-google transmet l'adresse du compte connecté (session vérifiée par Supabase Auth) avec une signature
 * HMAC-SHA256 calculée avec une CLÉ DÉDIÉE, jamais transmise : propriété CLE_BOITE de ce script (copie de la clé
 * « mailbox_sign_key » de la base, supabase/functions/script-google/identite.ts). La signature couvre la cible (« prospect »)
 * et la boîte (« anthony ») de CE script (CIBLE_, BOITE_NOM_), l'adresse, l'action, le Message-ID et l'horodatage ; accepté seulement si : clé présente, signature juste, horodatage à moins de 5 minutes, signature
 * jamais vue (usage unique, sous verrou), et adresse = compte Google qui exécute ce script (titulaire de la boîte). Chaque refus
 * dit sa vraie cause. Aucune adresse écrite ici.
 */
/** (relecture de f95da56) constantes propres à CE script : la signature doit les nommer (cible et boîte) */
var CIBLE_ = 'prospect', BOITE_NOM_ = 'anthony';
var CLE_BOITE_ = PropertiesService.getScriptProperties().getProperty('CLE_BOITE') || '';
var CALLER_WINDOW_MS_ = 5 * 60 * 1000;
var REFUS_ = {
  cle: 'Script de prospection : ajoute la propriété CLE_BOITE (Paramètres du projet › Propriétés du script) : rien n’a été consulté.',
  signature: 'Demande non signée ou signature invalide (relais serveur ou clé CLE_BOITE pas à jour ?) : rien n’a été consulté.',
  expiree: 'Demande expirée (horodatage à plus de 5 minutes) : réessaie. Rien n’a été consulté.',
  rejeu: 'Demande déjà utilisée : réessaie. Rien n’a été consulté.',
  occupe: 'Script de prospection occupé : réessaie dans un instant. Rien n’a été consulté.'
};
/** Identité signée : {who} si tout est juste, sinon {why} = motif réel du refus (REFUS_) */
function callerOk_(b, action) {
  if (!CLE_BOITE_) return { why: REFUS_.cle };
  var who = typeof b.caller === 'string' ? b.caller.trim().toLowerCase() : '';
  var ts = Number(b.caller_ts), sig = typeof b.caller_sig === 'string' ? b.caller_sig : '';
  var msgid = typeof b.message_id === 'string' ? b.message_id : '';
  if (!who || !sig || !isFinite(ts)) return { why: REFUS_.signature };
  var text = ['matrice-boite-v2', CIBLE_, BOITE_NOM_, who, action, msgid, String(ts)].join('|');
  var bytes = Utilities.computeHmacSha256Signature(text, CLE_BOITE_, Utilities.Charset.UTF_8);
  var hex = bytes.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
  if (hex !== sig) return { why: REFUS_.signature };
  if (Math.abs(Date.now() - ts) > CALLER_WINDOW_MS_) return { why: REFUS_.expiree };
  // usage unique, ATOMIQUE : lecture puis écriture dans le cache sous verrou du script (court) ; verrou indisponible → refus
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return { why: REFUS_.occupe };
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('sig:' + sig)) return { why: REFUS_.rejeu };
    cache.put('sig:' + sig, '1', 600);   // 10 minutes > fenêtre de 5 minutes
  } finally { lock.releaseLock(); }
  return { who: who };
}
function ownerOnly_(b, action) {
  var r = callerOk_(b, action);
  if (r.why) return { ok: false, refused: true, error: r.why };
  var me = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  if (me && r.who === me) return null;
  return { ok: false, refused: true, error: 'Recherche dans la boîte ' + (me || 'de ce script') + ' réservée à son titulaire : rien n’a été consulté.' };
}

// ─────────────── Message retrouvé par son Message-ID (v1.60.4) ───────────────
/**
 * Message glissé depuis Apple Mail (lien « message:%3C<Message-ID>%3E ») : retrouve CE message dans cette boîte, en LECTURE SEULE.
 * Identifiant refusé s'il n'a pas la forme stricte « <local@domaine> » (même expression que js/eml.js MSGID_RE) ; une seule
 * recherche, « rfc822msgid: » suivi de l'identifiant validé (jamais de recherche libre) ; exactement UN message dont l'en-tête
 * Message-ID est identique, brouillons exclus ; renvoie seulement son objet, son expéditeur, sa date et son contenu brut (.eml,
 * 20 Mo au plus). Aucune modification : ni « lu », ni libellé, ni déplacement (méthodes de lecture seulement, contrôlé par
 * tests/static/message-id.mjs). Même fonction, au caractère près, dans apps-script/Code.gs et apps-script/Prospection.gs.
 */
var MSGID_RE_ = /^<[\w!#$%&'*+\/=?^`~.-]{1,200}@[\w.-]{1,200}>$/;
var MSGID_MAX_ = 250;
var MSG_RAW_MAX_ = 20 * 1024 * 1024;
function mailByMsgId_(id) {
  id = typeof id === 'string' ? id : '';
  if (!id || id.length > MSGID_MAX_ || !MSGID_RE_.test(id)) return { ok: false, error: 'Identifiant de message refusé : forme attendue <identifiant@domaine>.' };
  var found = [];
  GmailApp.search('rfc822msgid:' + id.slice(1, -1), 0, 10).forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var h = String(m.getHeader('Message-ID') || m.getHeader('Message-Id') || '').trim();
      if (!m.isDraft() && h === id) found.push(m);
    });
  });
  if (!found.length) return { ok: true, found: false };
  if (found.length > 1) return { ok: false, error: 'Plusieurs messages de cette boîte portent cet identifiant : rattachement impossible par ce chemin.' };
  var m = found[0], raw = String(m.getRawContent() || '');
  if (raw.length > MSG_RAW_MAX_) return { ok: false, error: 'Message trop lourd pour être joint (' + Math.round(raw.length / 104857.6) / 10 + ' Mo, 20 Mo au plus).' };
  return { ok: true, found: true, message: { message_id: id, subject: m.getSubject(), from: m.getFrom(), date: m.getDate().toISOString(), size: raw.length, raw: raw } };
}
// ─────────────── fin : Message-ID ───────────────

/** Version texte du mail (délivrabilité, lot V1.52) : mêmes liens que le HTML (« texte (adresse) »), listes, paragraphes, entités */
function plain_(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(title|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, function (m, q, href, txt) {
      var t = txt.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(), h = href.replace(/&amp;/g, '&').replace(/^mailto:/i, '');
      return !h ? t : !t || t === h ? h : t + ' (' + h + ')';   // lien sans adresse : le texte seul
    })
    .replace(/<\/li>/gi, '').replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|tr|h[1-6]|blockquote|table|ul|ol)>/gi, '\n').replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (m, n) { return cp_(Number(n), m); })
    .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return cp_(parseInt(n, 16), m); })
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&ccedil;/g, 'ç').replace(/&rsquo;/g, '’').replace(/&euro;/g, '€').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Caractère d'une entité numérique ; code invalide : l'entité reste telle quelle (jamais d'erreur qui bloquerait l'envoi) */
function cp_(n, raw) { return n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : raw; }

/** Encodage MIME (Gmail API) : tout le texte en UTF-8, pour garder les accents et les émojis */
function b64_(bytes) { return Utilities.base64Encode(bytes).replace(/(.{76})/g, '$1\r\n'); }
function enc_(s) { return '=?UTF-8?B?' + Utilities.base64Encode(String(s || ''), Utilities.Charset.UTF_8) + '?='; }
function utf8_(s) { return Utilities.newBlob('').setDataFromString(String(s || ''), 'UTF-8').getBytes(); }

/**
 * Brouillon Gmail construit à la main (MIME UTF-8) puis envoyé si demandé.
 * GmailApp.createDraft abîme les émojis : on passe par l'API Gmail (service « Gmail API » du script).
 * o : { to, cc, subject, html, attachments: [blobs], threadId, inReplyTo, references, fromName, send }
 */
var MAX_MESSAGE_BYTES_ = 25 * 1024 * 1024;
function mimeDraft_(o) {
  if (typeof Gmail === 'undefined') throw new Error('Active « Gmail API » dans le script Google (Services › + › Gmail API), puis redéploie');
  var me = Session.getEffectiveUser().getEmail();
  var mixed = 'mix' + Date.now(), alt = 'alt' + Date.now();
  var L = [];
  if (o.fromName) L.push('From: ' + enc_(o.fromName) + ' <' + me + '>');
  L.push('To: ' + (o.to || ''));
  if (o.cc) L.push('Cc: ' + o.cc);
  if (o.bcc) L.push('Bcc: ' + o.bcc);
  L.push('Subject: ' + enc_(o.subject || ''));
  if (o.inReplyTo) L.push('In-Reply-To: ' + o.inReplyTo, 'References: ' + (o.references || o.inReplyTo));
  L.push('MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + mixed + '"', '',
    '--' + mixed, 'Content-Type: multipart/alternative; boundary="' + alt + '"', '',
    '--' + alt, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64_(utf8_(plain_(o.html))),
    '--' + alt, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64_(utf8_(o.html || '')),
    '--' + alt + '--');
  (o.attachments || []).forEach(function (f) {
    L.push('--' + mixed, 'Content-Type: ' + (f.getContentType() || 'application/octet-stream') + '; name="' + enc_(f.getName()) + '"',
      'Content-Disposition: attachment; filename="' + enc_(f.getName()) + '"', 'Content-Transfer-Encoding: base64', '', b64_(f.getBytes()));
  });
  L.push('--' + mixed + '--');
  var mime = Utilities.newBlob(L.join('\r\n')).getBytes();
  // limite de Gmail : 25 Mo pour le message ENCODÉ (pièces jointes en base64, textes, en-têtes) — mesurée ici, au-delà rien n'est créé ni envoyé
  if (mime.length > MAX_MESSAGE_BYTES_) throw new Error('Message trop lourd pour Gmail : ' + (mime.length / 1048576).toFixed(1).replace('.', ',') + ' Mo une fois encodé (25 Mo au plus). Rien n’est parti.');
  var message = { raw: Utilities.base64EncodeWebSafe(mime) };
  if (o.threadId) message.threadId = o.threadId;
  // brouillon déjà enregistré (messagerie) : mis à jour, jamais dupliqué
  var draft = o.draftId ? Gmail.Users.Drafts.update({ message: message }, 'me', o.draftId) : Gmail.Users.Drafts.create({ message: message }, 'me');
  if (o.send) {
    var sent = Gmail.Users.Drafts.send({ id: draft.id }, 'me');
    return { sent: true, thread_id: sent.threadId, message_id: sent.id, sent_at: new Date().toISOString() };
  }
  return { sent: false, draft_id: draft.id, thread_id: draft.message.threadId, message_id: draft.message.id,
    url: 'https://mail.google.com/mail/u/0/#drafts?compose=' + draft.message.id };
}

/** Nouveau mail de prospection : brouillon, ou envoi direct (send: true) */
function mail_(b) {
  var out = mimeDraft_({ to: b.to, cc: b.cc, subject: b.subject, html: b.html, attachments: blobs_(b.attachments),
    fromName: b.from_name || "L'ArtBoristerie Productions", send: !!b.send });
  out.ok = true;
  return out;
}

/** Relance : réponse dans le fil du mail de prospection (l'historique reste en dessous), brouillon ou envoi direct */
function reply_(b) {
  var thread = GmailApp.getThreadById(b.thread_id);
  if (!thread) throw new Error('Mail de prospection introuvable dans Gmail (supprimé ?)');
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var msgs = thread.getMessages().filter(function (m) { return !m.isDraft(); });
  if (!msgs.length) throw new Error('Le mail de prospection n’a pas encore été envoyé (il est toujours en brouillon)');
  var last = msgs[msgs.length - 1];
  var fromMe = last.getFrom().toLowerCase().indexOf(me) >= 0;
  var to = b.to || (fromMe ? last.getTo() : last.getFrom());
  var subject = thread.getFirstMessageSubject();
  if (!/^re\s*:/i.test(subject)) subject = 'Re: ' + subject;
  var msgId = last.getHeader('Message-ID'), refs = ((last.getHeader('References') || '') + ' ' + msgId).trim();
  // le texte de la relance, puis l'historique cité (comme Gmail)
  var quoted = '<br><div class="gmail_quote"><div>Le ' + Utilities.formatDate(last.getDate(), 'Europe/Paris', "dd/MM/yyyy 'à' HH:mm") + ', '
    + last.getFrom().replace(/</g, '&lt;').replace(/>/g, '&gt;') + ' a écrit :</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">'
    + last.getBody() + '</blockquote></div>';
  var out = mimeDraft_({ to: to, cc: b.cc, subject: subject, html: (b.html || '') + quoted, attachments: blobs_(b.attachments),
    threadId: b.thread_id, inReplyTo: msgId, references: refs, fromName: b.from_name || "L'ArtBoristerie Productions", send: !!b.send });
  out.ok = true; out.to = to; out.thread_id = out.thread_id || b.thread_id;
  if (!out.sent) out.url = 'https://mail.google.com/mail/u/0/#drafts';
  return out;
}

/** Le brouillon est-il parti ? L'organisateur a-t-il répondu ? */
function status_(threadId) {
  var thread = GmailApp.getThreadById(threadId);
  if (!thread) return { ok: true, missing: true };
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var sent = [], reply = null;
  thread.getMessages().forEach(function (m) {
    if (m.isDraft()) return;
    var mine = m.getFrom().toLowerCase().indexOf(me) >= 0;
    if (mine) sent.push(m.getDate().toISOString());
    else reply = m.getDate().toISOString();
  });
  return { ok: true, sent: sent, reply_at: reply };
}


/* ════════════════════════ Messagerie intégrée (v1.61) — boîte de ce compte ════════════════════════
 * Lecture des conversations, libellés, rangement, réponses dans le fil, pièces jointes, historique pour la synchronisation.
 * Gmail reste la référence : ce que fait L'ArtBotrice se voit dans Gmail et Apple Mail, et inversement. Jamais de suppression
 * définitive (« Corbeille » seulement). */
function hdr_(headers, name) {
  var n = name.toLowerCase();
  for (var i = 0; i < (headers || []).length; i++) if (String(headers[i].name).toLowerCase() === n) return headers[i].value;
  return '';
}
/** « Nom <a@b.fr>, c@d.fr » → [{name, email}] (adresses en minuscules) */
function addrs_(v) {
  var out = [];
  String(v || '').replace(/(?:"?([^"<,]*)"?\s*)?<?([A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/g, function (m, name, email) {
    out.push({ name: String(name || '').trim(), email: email.toLowerCase() });
    return m;
  });
  return out;
}
function me_() { return Session.getEffectiveUser().getEmail().toLowerCase(); }
function b64dec_(data) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8'); }

/** Parcours des parties d'un message : corps HTML / texte et pièces jointes (nom, taille, type, identifiant) */
function parts_(payload, acc) {
  if (!payload) return acc;
  var mime = payload.mimeType || '', fn = payload.filename || '', body = payload.body || {};
  if (fn && (body.attachmentId || body.data)) acc.attachments.push({ name: fn, size: body.size || 0, mime: mime, id: body.attachmentId || '' });
  else if (mime === 'text/html' && body.data && !acc.html) acc.html = b64dec_(body.data);
  else if (mime === 'text/plain' && body.data && !acc.text) acc.text = b64dec_(body.data);
  (payload.parts || []).forEach(function (p) { parts_(p, acc); });
  return acc;
}

/** Résumé d'un message (sans corps) — sert à la liste, à la synchronisation et au journal */
function msgMeta_(m, me) {
  var h = (m.payload || {}).headers || [], from = addrs_(hdr_(h, 'From'))[0] || { name: '', email: '' };
  var acc = parts_(m.payload, { html: '', text: '', attachments: [] });
  return { id: m.id, thread_id: m.threadId, rfc_id: hdr_(h, 'Message-ID'), labels: m.labelIds || [],
    from: from, reply_to: addrs_(hdr_(h, 'Reply-To')), to: addrs_(hdr_(h, 'To')), cc: addrs_(hdr_(h, 'Cc')),
    subject: hdr_(h, 'Subject'), date: new Date(Number(m.internalDate)).toISOString(), snippet: m.snippet || '',
    direction: from.email === me || (m.labelIds || []).indexOf('SENT') >= 0 ? 'out' : 'in',
    attachments: acc.attachments.map(function (a) { return { name: a.name, size: a.size, mime: a.mime, id: a.id }; }),
    draft: (m.labelIds || []).indexOf('DRAFT') >= 0 };
}

/** Liste de conversations : boîte de réception (défaut), libellé, recherche Gmail, non lus ; par pages de 25 au plus */
function threads_(b) {
  var me = me_(), q = String(b.q || ''), opt = { maxResults: Math.min(Number(b.max) || 25, 25) };
  if (b.unread) q = (q + ' is:unread').trim();
  if (q) opt.q = q;
  opt.labelIds = b.label ? [String(b.label)] : (q ? [] : ['INBOX']);
  if (!opt.labelIds.length) delete opt.labelIds;
  if (b.page_token) opt.pageToken = String(b.page_token);
  var res = Gmail.Users.Threads.list('me', opt), list = [];
  (res.threads || []).forEach(function (t) {
    var full = Gmail.Users.Threads.get('me', t.id, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Reply-To', 'Message-ID'] });
    list.push(threadMeta_(full, me));
  });
  return { ok: true, threads: list, next_page_token: res.nextPageToken || null, account: me };
}
function threadMeta_(full, me) {
  var msgs = (full.messages || []).map(function (m) { return msgMeta_(m, me); }).filter(function (m) { return !m.draft; });
  var last = msgs[msgs.length - 1] || {}, people = {}, labels = {};
  msgs.forEach(function (m) {
    [m.from].concat(m.to, m.cc, m.reply_to).forEach(function (a) { if (a && a.email && a.email !== me) people[a.email] = a.name || people[a.email] || ''; });
  });
  (full.messages || []).forEach(function (m) { (m.labelIds || []).forEach(function (l) { labels[l] = 1; }); });
  return { id: full.id, subject: (msgs[0] || {}).subject || '', snippet: last.snippet || '', last_at: last.date || null, count: msgs.length,
    unread: !!labels.UNREAD, labels: Object.keys(labels), participants: Object.keys(people).map(function (e) { return { email: e, name: people[e] }; }),
    messages: msgs };
}

/** Conversation complète (corps compris), brouillons exclus */
function thread_(b) {
  var me = me_(), full = Gmail.Users.Threads.get('me', String(b.thread_id), { format: 'full' });
  var meta = threadMeta_(full, me);
  meta.messages = (full.messages || []).filter(function (m) { return (m.labelIds || []).indexOf('DRAFT') < 0; }).map(function (m) {
    var x = msgMeta_(m, me), acc = parts_(m.payload, { html: '', text: '', attachments: [] });
    x.html = acc.html || ('<pre>' + String(acc.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>');
    return x;
  });
  return { ok: true, thread: meta, account: me };
}

/** Libellés existants (= dossiers d'Apple Mail sous le compte) ; rien n'est créé ni renommé */
function labels_() {
  var res = Gmail.Users.Labels.list('me');
  return { ok: true, labels: (res.labels || []).map(function (l) { return { id: l.id, name: l.name, type: l.type }; }) };
}

/** Rangement : ajouter / retirer des libellés, archiver (retirer de la boîte de réception), lu / non lu, corbeille (jamais de suppression définitive) */
function modify_(b) {
  var id = String(b.thread_id);
  if (b.trash) { Gmail.Users.Threads.trash('me', id); return { ok: true, trashed: true }; }
  if (b.untrash) { Gmail.Users.Threads.untrash('me', id); return { ok: true, untrashed: true }; }
  var add = (b.add || []).map(String), rm = (b.remove || []).map(String);
  if (b.archive) rm.push('INBOX');
  if (b.read === true) rm.push('UNREAD');
  if (b.read === false) add.push('UNREAD');
  var res = Gmail.Users.Threads.modify({ addLabelIds: add, removeLabelIds: rm }, 'me', id);
  var labels = {};
  (res.messages || []).forEach(function (m) { (m.labelIds || []).forEach(function (l) { labels[l] = 1; }); });
  return { ok: true, labels: Object.keys(labels) };
}

/**
 * Rédaction : 'reply' (adresse de réponse du message, sinon son expéditeur), 'reply_all' (+ destinataires et copies, sans soi-même),
 * 'forward' (pièces jointes d'origine jointes), 'new'. Destinataires fournis par L'ArtBotrice (affichés et modifiables avant l'envoi).
 * Brouillon (enregistré / mis à jour) ou envoi ; une réponse reste dans le fil (threadId, In-Reply-To, References).
 * Résultat d'envoi seulement si Gmail confirme : sent: true + identifiants.
 */
function compose_(b) {
  var mode = String(b.mode || 'new'), me = me_(), base = null, subject = String(b.subject || ''), quoted = '', extra = [];
  if (mode !== 'new') {
    var full = Gmail.Users.Threads.get('me', String(b.thread_id), { format: 'full' });
    var list = (full.messages || []).filter(function (m) { return (m.labelIds || []).indexOf('DRAFT') < 0; });
    base = b.message_id ? list.filter(function (m) { return m.id === b.message_id; })[0] : list[list.length - 1];
    if (!base) throw new Error('Message d’origine introuvable dans Gmail');
    var h = base.payload.headers, acc = parts_(base.payload, { html: '', text: '', attachments: [] });
    var orig = hdr_(h, 'Subject') || '';
    if (!subject) subject = mode === 'forward' ? (/^(tr|fwd?)\s*:/i.test(orig) ? orig : 'Tr : ' + orig) : (/^re\s*:/i.test(orig) ? orig : 'Re: ' + orig);
    var when = Utilities.formatDate(new Date(Number(base.internalDate)), 'Europe/Paris', "dd/MM/yyyy 'à' HH:mm");
    var from = hdr_(h, 'From').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    quoted = mode === 'forward'
      ? '<br><div class="gmail_quote">---------- Message transféré ---------<br>De : ' + from + '<br>Date : ' + when + '<br>Objet : ' + orig.replace(/</g, '&lt;') + '<br><br>' + (acc.html || acc.text || '') + '</div>'
      : '<br><div class="gmail_quote"><div>Le ' + when + ', ' + from + ' a écrit :</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' + (acc.html || acc.text || '') + '</blockquote></div>';
    if (mode === 'forward' && b.keep_attachments !== false) extra = GmailApp.getMessageById(base.id).getAttachments({ includeInlineImages: false });
  }
  var rfc = base ? hdr_(base.payload.headers, 'Message-ID') : '', refs = base ? ((hdr_(base.payload.headers, 'References') || '') + ' ' + rfc).trim() : '';
  var reply = mode === 'reply' || mode === 'reply_all';
  var out = mimeDraft_({ to: b.to, cc: b.cc, bcc: b.bcc, subject: subject, html: (b.html || '') + quoted,
    attachments: strictBlobs_(b.attachments).concat(extra), threadId: reply ? String(b.thread_id) : (b.thread_id && mode === 'forward' ? String(b.thread_id) : null),
    inReplyTo: reply ? rfc : null, references: reply ? refs : null, fromName: b.from_name || "L'ArtBoristerie Productions",
    send: !!b.send, draftId: b.draft_id || null });
  out.ok = true; out.subject = subject;
  return out;
}

/** Pièces jointes de la messagerie : vraies pièces jointes, jamais de lien ; une pièce illisible arrête l'envoi (rien ne part sans elle) */
function strictBlobs_(list) {
  var total = 0, out = (list || []).map(function (f) {   // taille brute ; la limite réelle est vérifiée sur le message encodé (mimeDraft_)
    var blob;
    try {
      if (f.url) blob = UrlFetchApp.fetch(f.url).getBlob().setName(f.name || 'piece-jointe');
      else if (f.id) blob = DriveApp.getFileById(f.id).getBlob();
    } catch (err) { throw new Error('Pièce jointe illisible : ' + (f.name || f.id || '?') + ' (' + err.message + '). Rien n’est parti.'); }
    if (!blob) throw new Error('Pièce jointe introuvable : ' + (f.name || '?') + '. Rien n’est parti.');
    total += blob.getBytes().length;
    return blob;
  });
  if (total * 4 / 3 > MAX_MESSAGE_BYTES_) throw new Error('Pièces jointes trop lourdes pour Gmail (plus de 25 Mo une fois encodées). Rien n’est parti.');
  return out;
}

/** Pièce jointe reçue (aperçu ou « Conserver dans le projet », toujours sur action explicite) */
function attachment_(b) {
  var a = Gmail.Users.Messages.Attachments.get('me', String(b.message_id), String(b.attachment_id));
  if ((a.size || 0) > 20 * 1024 * 1024) throw new Error('Pièce jointe trop lourde pour être reprise ici (plus de 20 Mo)');
  return { ok: true, size: a.size, data: a.data };   // base64 « web safe »
}

/**
 * Synchronisation : conversations changées depuis le point de reprise (messages ajoutés, y compris envoyés depuis Apple Mail,
 * libellés ajoutés / retirés). Sans point de reprise, ou point trop ancien : les conversations des 14 derniers jours.
 */
function history_(b) {
  var me = me_(), profile = Gmail.Users.getProfile('me'), ids = {}, full = false;
  if (b.start_history_id) {
    try {
      var token = null;
      do {
        var res = Gmail.Users.History.list('me', { startHistoryId: String(b.start_history_id), pageToken: token, maxResults: 500,
          historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'] });
        (res.history || []).forEach(function (h) {
          (h.messages || []).concat((h.messagesAdded || []).map(function (x) { return x.message; }),
            (h.labelsAdded || []).map(function (x) { return x.message; }), (h.labelsRemoved || []).map(function (x) { return x.message; }))
            .forEach(function (m) { if (m && m.threadId) ids[m.threadId] = 1; });
        });
        token = res.nextPageToken;
      } while (token);
    } catch (err) { full = true; }   // point de reprise expiré (Gmail ne garde qu'une semaine environ) : reprise sur 14 jours
  } else full = true;
  if (full) {
    var token2 = null, n = 0;
    do {
      var r = Gmail.Users.Threads.list('me', { q: 'newer_than:14d -in:drafts', maxResults: 100, pageToken: token2 });
      (r.threads || []).forEach(function (t) { ids[t.id] = 1; });
      token2 = r.nextPageToken; n++;
    } while (token2 && n < 5);
  }
  var list = Object.keys(ids), limit = Math.min(Number(b.max) || 30, 50), out = [];
  list.slice(0, limit).forEach(function (id) {
    try { out.push(threadMeta_(Gmail.Users.Threads.get('me', id, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Reply-To', 'Message-ID'] }), me)); }
    catch (err) { out.push({ id: id, missing: true }); }   // conversation supprimée définitivement depuis Gmail
  });
  return { ok: true, account: me, history_id: String(profile.historyId), threads: out, remaining: list.slice(limit), full: full };
}
