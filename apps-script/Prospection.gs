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
 *
 * Le code secret n'est jamais écrit dans ce code (v1.47) : il est lu dans les propriétés du script. Un script déjà installé
 * avec le code écrit en dur continue de fonctionner tel quel (la Matrice envoie toujours le même code, depuis son serveur).
 */
var SECRET = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (!SECRET) return json_({ ok: false, error: 'Script de prospection : ajoute la propriété WEBHOOK_SECRET (Paramètres du projet › Propriétés du script)' });
    if (!body.secret || body.secret !== SECRET) return json_({ ok: false, error: 'Code secret du script de prospection incorrect' });
    var a = body.action;
    if (a === 'ping') out = { ok: true, account: Session.getEffectiveUser().getEmail() };
    else if (a === 'mail') out = mail_(body);
    else if (a === 'reply') out = reply_(body);
    else if (a === 'status') out = status_(body.thread_id);
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

function plain_(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}

/** Encodage MIME (Gmail API) : tout le texte en UTF-8, pour garder les accents et les émojis */
function b64_(bytes) { return Utilities.base64Encode(bytes).replace(/(.{76})/g, '$1\r\n'); }
function enc_(s) { return '=?UTF-8?B?' + Utilities.base64Encode(String(s || ''), Utilities.Charset.UTF_8) + '?='; }
function utf8_(s) { return Utilities.newBlob('').setDataFromString(String(s || ''), 'UTF-8').getBytes(); }

/**
 * Brouillon Gmail construit à la main (MIME UTF-8) puis envoyé si demandé.
 * GmailApp.createDraft abîme les émojis : on passe par l'API Gmail (service « Gmail API » du script).
 * o : { to, cc, subject, html, attachments: [blobs], threadId, inReplyTo, references, fromName, send }
 */
function mimeDraft_(o) {
  if (typeof Gmail === 'undefined') throw new Error('Active « Gmail API » dans le script Google (Services › + › Gmail API), puis redéploie');
  var me = Session.getEffectiveUser().getEmail();
  var mixed = 'mix' + Date.now(), alt = 'alt' + Date.now();
  var L = [];
  if (o.fromName) L.push('From: ' + enc_(o.fromName) + ' <' + me + '>');
  L.push('To: ' + (o.to || ''));
  if (o.cc) L.push('Cc: ' + o.cc);
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
  var message = { raw: Utilities.base64EncodeWebSafe(Utilities.newBlob(L.join('\r\n')).getBytes()) };
  if (o.threadId) message.threadId = o.threadId;
  var draft = Gmail.Users.Drafts.create({ message: message }, 'me');
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
