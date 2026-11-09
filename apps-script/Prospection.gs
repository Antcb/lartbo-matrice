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
var SCRIPT_VERSION = 'v1.60.7';
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
    else if (a === 'thread_by_msgid') out = ownerOnly_(body, a) || threadByMsgId_(body.message_id, body.want);   // v1.60.7 : conversation, lecture seule, titulaire seulement
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
/**
 * (v1.60.7, décision d'Anthony du 09/11/2026) CONVERSATION entière du message glissé, en LECTURE SEULE : même recherche exacte que
 * mailByMsgId_ (rfc822msgid: + identifiant validé, en-tête Message-ID identique, brouillons exclus), puis la conversation Gmail de
 * ce message (son identifiant de conversation, jamais une ressemblance d'objet) : ses messages, reçus et envoyés, brouillons exclus,
 * dans l'ordre chronologique, THREAD_MAX_ au plus (les plus récents). Sans « want » : description seulement (identifiant Gmail,
 * Message-ID, objet, expéditeur, destinataires, copies, date, nombre de pièces jointes). Avec « want » (identifiants Gmail de CETTE conversation) : contenu
 * brut (.eml) de ces messages en plus, 20 Mo au plus par appel ; ceux qui n'entrent pas sont rendus dans « rest » (passe suivante),
 * un message seul de plus de 20 Mo est signalé « too_big ». Aucune modification (ni « lu », ni libellé, ni déplacement).
 */
var THREAD_MAX_ = 100;
var GMAIL_ID_RE_ = /^[0-9a-f]{6,32}$/;
function threadByMsgId_(id, want) {
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
  var thread = found[0].getThread(), threadId = thread.getId();
  for (var i = 1; i < found.length; i++) {
    if (found[i].getThread().getId() !== threadId) return { ok: false, error: 'Plusieurs conversations de cette boîte portent cet identifiant : import impossible par ce chemin.' };
  }
  var all = thread.getMessages().filter(function (m) { return !m.isDraft(); });
  all.sort(function (a, b) { return a.getDate().getTime() - b.getDate().getTime(); });
  var truncated = all.length > THREAD_MAX_;
  if (truncated) all = all.slice(all.length - THREAD_MAX_);
  var wanted = Array.isArray(want) ? want.filter(function (w) { return typeof w === 'string' && GMAIL_ID_RE_.test(w); }).slice(0, THREAD_MAX_) : null;
  var budget = MSG_RAW_MAX_, rest = [], given = 0;
  var messages = all.map(function (m) {
    var gid = m.getId();
    var meta = { gmail_id: gid, message_id: String(m.getHeader('Message-ID') || m.getHeader('Message-Id') || '').trim(), subject: m.getSubject(),
      from: m.getFrom(), to: m.getTo(), cc: m.getCc(), date: m.getDate().toISOString(), att: m.getAttachments({ includeInlineImages: false }).length };
    if (wanted && wanted.indexOf(gid) >= 0) {
      var raw = String(m.getRawContent() || '');
      if (raw.length > MSG_RAW_MAX_) meta.too_big = Math.round(raw.length / 104857.6) / 10;
      else if (given > 0 && raw.length > budget) rest.push(gid);
      else { meta.raw = raw; budget -= raw.length; given++; }
    }
    return meta;
  });
  return { ok: true, found: true, thread_id: threadId, truncated: truncated, messages: messages, rest: rest };
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
