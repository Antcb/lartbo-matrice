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
 *
 * Le code secret ci-dessous est rempli automatiquement quand on copie le script depuis les Réglages.
 */
var SECRET = '__SECRET__';

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
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

/** Nouveau mail de prospection : brouillon, ou envoi direct (send: true) */
function mail_(b) {
  var opts = { htmlBody: b.html || '', name: b.from_name || "L'ArtBoristerie Productions" };
  if (b.cc) opts.cc = b.cc;
  var att = blobs_(b.attachments); if (att.length) opts.attachments = att;
  var draft = GmailApp.createDraft(b.to || '', b.subject || '', plain_(b.html), opts);
  if (b.send) {
    var msg = draft.send();
    return { ok: true, sent: true, thread_id: msg.getThread().getId(), sent_at: msg.getDate().toISOString() };
  }
  var m = draft.getMessage();
  return { ok: true, sent: false, thread_id: m.getThread().getId(), url: 'https://mail.google.com/mail/u/0/#drafts?compose=' + m.getId() };
}

/** Encodage MIME (Gmail API) */
function b64_(bytes) { return Utilities.base64Encode(bytes).replace(/(.{76})/g, '$1\r\n'); }
function enc_(s) { return '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?='; }

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
  var msgId = last.getHeader('Message-ID'), refs = (last.getHeader('References') || '') + ' ' + msgId;
  // le texte de la relance, puis l'historique cité (comme Gmail)
  var quoted = '<br><div class="gmail_quote"><div>Le ' + Utilities.formatDate(last.getDate(), 'Europe/Paris', "dd/MM/yyyy 'à' HH:mm") + ', '
    + last.getFrom().replace(/</g, '&lt;').replace(/>/g, '&gt;') + ' a écrit :</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">'
    + last.getBody() + '</blockquote></div>';
  var html = (b.html || '') + quoted;
  var boundary = 'artbo' + Date.now();
  var lines = [
    'To: ' + to, b.cc ? 'Cc: ' + b.cc : null, 'Subject: ' + enc_(subject),
    'In-Reply-To: ' + msgId, 'References: ' + refs.trim(), 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + boundary + '"', '',
    '--' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    b64_(Utilities.newBlob(html).getBytes())
  ].filter(function (x) { return x !== null; });
  blobs_(b.attachments).forEach(function (f) {
    lines.push('--' + boundary, 'Content-Type: ' + (f.getContentType() || 'application/octet-stream') + '; name="' + enc_(f.getName()) + '"',
      'Content-Disposition: attachment; filename="' + enc_(f.getName()) + '"', 'Content-Transfer-Encoding: base64', '', b64_(f.getBytes()));
  });
  lines.push('--' + boundary + '--');
  var raw = Utilities.base64EncodeWebSafe(Utilities.newBlob(lines.join('\r\n')).getBytes());
  if (typeof Gmail === 'undefined') throw new Error('Active « Gmail API » dans le script de prospection (Services › + › Gmail API)');
  var draft = Gmail.Users.Drafts.create({ message: { raw: raw, threadId: b.thread_id } }, 'me');
  if (b.send) {
    var sent = Gmail.Users.Drafts.send({ id: draft.id }, 'me');
    return { ok: true, sent: true, thread_id: sent.threadId, sent_at: new Date().toISOString(), to: to };
  }
  return { ok: true, sent: false, thread_id: b.thread_id, to: to, url: 'https://mail.google.com/mail/u/0/#drafts' };
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
