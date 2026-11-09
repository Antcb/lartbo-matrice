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
 *     import_secrets › ligne mailbox_sign_key › valeur). Sans elle, toutes les actions de la boîte (messagerie v1.63, recherche
 *     d'un message par son identifiant) sont refusées ; la prospection (mail, relance, statut) n'en dépend pas.
 *
 * Le code secret n'est jamais écrit dans ce code (v1.47) : il est lu dans les propriétés du script. Un script déjà installé
 * avec le code écrit en dur continue de fonctionner tel quel (la Matrice envoie toujours le même code, depuis son serveur).
 */
/** Version du code (renvoyée par « ping », pour vérifier le redéploiement) */
var SCRIPT_VERSION = 'v1.61.0';
var SECRET = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (!SECRET) return json_({ ok: false, error: 'Script de prospection : ajoute la propriété WEBHOOK_SECRET (Paramètres du projet › Propriétés du script)' });
    if (!body.secret || body.secret !== SECRET) return json_({ ok: false, error: 'Code secret du script de prospection incorrect' });
    var a = body.action;
    // (v1.63) toutes les actions de BOÎTE (lecture, envoi, rangement, documents, recherche par Message-ID) : titulaire seulement,
    // identité signée par le relais (même clé, même règle) — contrôlé avant toute lecture de Gmail ou de Drive
    var refus = BOITE_[a] ? ownerOnly_(body, a) : null;
    // (v1.63) MODE ESSAI (propriété MODE_ESSAI du script d'essai) : seules les conversations TEST portant le libellé dédié, seuls les
    // destinataires d'essai ; mal configuré → tout est bloqué. Appliqué ICI, quel que soit le relais ou le serveur qui appelle.
    if (!refus && ESSAI_ && a !== 'ping') refus = essaiGarde_(a, body);
    if (refus) out = refus;
    else if (a === 'ping') out = { ok: true, account: Session.getEffectiveUser().getEmail(), version: SCRIPT_VERSION, mode_essai: ESSAI_ ? (essaiConfig_() || 'actif') : '' };
    else if (a === 'mail') out = mail_(body);
    else if (a === 'reply') out = reply_(body);
    else if (a === 'status') out = status_(body.thread_id);
    else if (a === 'mail_by_msgid') out = mailByMsgId_(body.message_id);   // v1.60.4 : lecture seule, titulaire de la boîte seulement (BOITE_)
    // messagerie intégrée (v1.61) : Gmail reste la référence ; aucune suppression définitive
    else if (a === 'threads') out = threads_(body);
    else if (a === 'thread') out = thread_(body);
    else if (a === 'labels') out = labels_();
    else if (a === 'modify') out = modify_(body);
    else if (a === 'compose') out = compose_(body);
    else if (a === 'attachment') out = attachment_(body);
    else if (a === 'history') out = history_(body);
    else if (a === 'files_info') out = filesInfo_(body);   // v1.63 : taille et accès des documents Drive (lecture seule)
    else out = { ok: false, error: 'Action inconnue : ' + a };
    if (ESSAI_ && out && out.ok && !refus) {
      out.essai = { libelle: ESSAI_.libelle, id: essaiLabel_() };
      // conversation créée ou continuée en essai (prospection, nouveau mail, réponse) : marquée TEST pour rester dans le périmètre
      // (relecture de 1c79901, point 3) envoi déjà fait : un échec du libellé n'est JAMAIS une erreur (sinon l'utilisateur renverrait)
      if ((a === 'mail' || a === 'reply' || a === 'compose') && out.thread_id) {
        try { Gmail.Users.Threads.modify({ addLabelIds: [essaiLabel_()] }, 'me', String(out.thread_id)); }
        catch (err) { out.avertissement = 'Envoyé, mais le libellé « ' + ESSAI_.libelle + ' » n’a pas pu être posé : pose-le à la main dans Gmail (sinon la conversation reste hors essai).'; }
      }
    }
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
 * et la boîte (« anthony ») de CE script (CIBLE_, BOITE_NOM_), l'adresse, l'action, l'identifiant (Message-ID, ou empreinte de la
 * demande entière pour les actions de messagerie) et l'horodatage ; accepté seulement si : clé présente, signature juste, horodatage à moins de 5 minutes, signature
 * jamais vue (usage unique, sous verrou), et adresse = compte Google qui exécute ce script (titulaire de la boîte). Chaque refus
 * dit sa vraie cause. Aucune adresse écrite ici.
 */
/** Actions de boîte (v1.63) : réservées au titulaire, chacune vérifiée par ownerOnly_ avant d'être exécutée */
var BOITE_ = { mail_by_msgid: 1, threads: 1, thread: 1, labels: 1, modify: 1, compose: 1, attachment: 1, history: 1, files_info: 1 };
var RESERVES_ = ['action', 'secret', 'caller', 'caller_ts', 'caller_sig'];
/** Forme canonique d'une valeur JSON (clés triées) : même calcul que canon() du relais (identite.ts) */
function canon_(v) {
  if (Array.isArray(v)) return '[' + v.map(canon_).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
    .map(function (k) { return JSON.stringify(k) + ':' + canon_(v[k]); }).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
/** Identifiant signé : Message-ID pour mail_by_msgid ; sinon « sha256: » + empreinte de la demande entière (champs réservés exclus) */
function identOf_(b, action) {
  if (action === 'mail_by_msgid') return typeof b.message_id === 'string' ? b.message_id : '';
  var rest = {};
  Object.keys(b).forEach(function (k) { if (RESERVES_.indexOf(k) < 0) rest[k] = b[k]; });
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canon_(rest), Utilities.Charset.UTF_8);
  return 'sha256:' + d.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
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
  if (!who || !sig || !isFinite(ts)) return { why: REFUS_.signature };
  var text = ['matrice-boite-v2', CIBLE_, BOITE_NOM_, who, action, identOf_(b, action), String(ts)].join('|');
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
  return { ok: false, refused: true, error: 'Boîte ' + (me || 'de ce script') + ' réservée à son titulaire : rien n’a été consulté.' };
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
function oneLine_(v) { return String(v || '').replace(/[\r\n]+/g, ' ').trim(); }   // en-têtes : jamais de retour à la ligne glissé
function mimeDraft_(o) {
  o.to = oneLine_(o.to); o.cc = oneLine_(o.cc); o.bcc = oneLine_(o.bcc); o.subject = oneLine_(o.subject);
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
  // (v1.63) brouillon disparu de Gmail (envoyé ou supprimé depuis Gmail / Apple Mail) : on s'arrête, jamais de second envoi ni de copie
  var draft;
  if (o.draftId) {
    try { draft = Gmail.Users.Drafts.update({ message: message }, 'me', o.draftId); }
    catch (err) { throw new Error('BROUILLON_ABSENT : le brouillon n’existe plus dans Gmail (envoyé ou supprimé depuis Gmail ou Apple Mail). Rien n’est parti.'); }
  } else draft = Gmail.Users.Drafts.create({ message: message }, 'me');
  if (o.send) {
    var sent = Gmail.Users.Drafts.send({ id: draft.id }, 'me');
    // confirmation de Gmail = identifiant du message envoyé ; sans lui, « non envoyé » (rien n'est noté au journal)
    if (!sent || !sent.id) return { sent: false, error: 'Gmail n’a pas confirmé l’envoi' };
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
/** « Nom <a@b.fr>, c@d.fr, "Nom, Prénom" <e@f.fr> » → [{name, email}] (adresses en minuscules).
 *  (v1.63) une adresse seule n'est plus tronquée (« prog@x.fr » était lu « g@x.fr ») ; virgule entre guillemets gardée dans le nom. */
function addrs_(v) {
  var out = [];
  (String(v || '').match(/(?:"[^"]*"|[^,"])+/g) || []).forEach(function (p) {
    var m = p.match(/<\s*([^<>\s@]+@[^<>\s@]+)\s*>/) || p.match(/([A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    if (!m) return;
    var lt = p.indexOf('<');
    out.push({ name: lt >= 0 ? p.slice(0, lt).replace(/"/g, '').trim() : '', email: m[1].toLowerCase() });
  });
  return out;
}
/** Conversation sans corps de message, mais avec la structure des parties (noms et tailles des pièces jointes) */
var META_FIELDS_ = 'id,messages(id,threadId,labelIds,internalDate,snippet,payload(mimeType,filename,headers,body(size,attachmentId),'
  + 'parts(mimeType,filename,headers,body(size,attachmentId),parts(mimeType,filename,headers,body(size,attachmentId),parts(mimeType,filename,headers,body(size,attachmentId))))))';
function threadLight_(id) { return Gmail.Users.Threads.get('me', id, { format: 'full', fields: META_FIELDS_ }); }
function me_() { return Session.getEffectiveUser().getEmail().toLowerCase(); }
function b64dec_(data) { return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8'); }

/** Parcours des parties d'un message : corps HTML / texte et pièces jointes (nom, taille, type, identifiant) */
function parts_(payload, acc) {
  if (!payload) return acc;
  var mime = payload.mimeType || '', fn = payload.filename || '', body = payload.body || {};
  // (v1.63) image intégrée au texte (Content-ID / inline) : marquée, jamais proposée comme pièce à transférer
  var disp = String(hdr_(payload.headers, 'Content-Disposition') || ''), inline = !!hdr_(payload.headers, 'Content-ID') && !/^\s*attachment/i.test(disp) || /^\s*inline/i.test(disp);
  if (fn && (body.attachmentId || body.data)) acc.attachments.push({ name: fn, size: body.size || 0, mime: mime, id: body.attachmentId || '', inline: inline });
  else if (mime === 'text/html' && body.data && !acc.html) acc.html = b64dec_(body.data);
  else if (mime === 'text/plain' && body.data && !acc.text) acc.text = b64dec_(body.data);
  (payload.parts || []).forEach(function (p) { parts_(p, acc); });
  return acc;
}

/** Identifiants des messages auxquels celui-ci répond (In-Reply-To, References) : sert à reconnaître une conversation connue (v1.63) */
function refs_(h) {
  var out = [];
  (hdr_(h, 'In-Reply-To') + ' ' + hdr_(h, 'References')).replace(/<[^<>\s]{1,250}>/g, function (id) { if (out.indexOf(id) < 0) out.push(id); return id; });
  return out.slice(0, 50);
}

/** Résumé d'un message (sans corps) — sert à la liste, à la synchronisation et au journal */
function msgMeta_(m, me) {
  var h = (m.payload || {}).headers || [], from = addrs_(hdr_(h, 'From'))[0] || { name: '', email: '' };
  var acc = parts_(m.payload, { html: '', text: '', attachments: [] });
  return { id: m.id, thread_id: m.threadId, rfc_id: hdr_(h, 'Message-ID'), labels: m.labelIds || [], refs: refs_(h),
    from: from, reply_to: addrs_(hdr_(h, 'Reply-To')), to: addrs_(hdr_(h, 'To')), cc: addrs_(hdr_(h, 'Cc')),
    subject: hdr_(h, 'Subject'), date: new Date(Number(m.internalDate)).toISOString(), snippet: m.snippet || '',
    direction: from.email === me || (m.labelIds || []).indexOf('SENT') >= 0 ? 'out' : 'in',
    attachments: acc.attachments.map(function (a) { return { name: a.name, size: a.size, mime: a.mime, id: a.id, inline: a.inline }; }),
    auto: autoKind_(m.payload, from.email, hdr_(h, 'Subject')),
    draft: (m.labelIds || []).indexOf('DRAFT') >= 0 };
}

/**
 * (v1.63, relecture) Message automatique, reconnu par ses EN-TÊTES (jamais par l'expéditeur seul) :
 *  'ndr'  : avis de non-remise — rapport de remise (multipart/report), X-Failed-Recipients, expéditeur système (mailer-daemon,
 *           postmaster, microsoftexchange… d'Exchange) ;
 *  'auto' : réponse automatique (absence…) — Auto-Submitted autre que « no », X-Autoreply / X-Autorespond, Precedence auto_reply,
 *           X-MS-Exchange-Inbox-Rules-Loop / Out of office d'Exchange ; '' : message ordinaire.
 * Ni l'un ni l'autre ne suspend les relances (le serveur ne compte que les vraies réponses).
 */
function autoKind_(payload, from, subject) {
  var h = (payload || {}).headers || [], mime = String((payload || {}).mimeType || '').toLowerCase();
  var ct = String(hdr_(h, 'Content-Type') || '').toLowerCase(), local = String(from || '').split('@')[0].toLowerCase();
  if (mime === 'multipart/report' || /multipart\/report/.test(ct) || hdr_(h, 'X-Failed-Recipients')
    || /^(mailer-daemon|mail-daemon|postmaster|microsoftexchange[0-9a-f]*)$/.test(local)) return 'ndr';
  var as = String(hdr_(h, 'Auto-Submitted') || '').trim().toLowerCase();
  if ((as && as !== 'no') || hdr_(h, 'X-Autoreply') || hdr_(h, 'X-Autorespond') || /auto_reply/i.test(hdr_(h, 'Precedence') || '')
    || /^oof$/i.test(String(hdr_(h, 'X-Auto-Response-Suppress') || '').trim()) && /^(automatic reply|réponse automatique|absence)/i.test(subject || '')) return 'auto';
  return '';
}

/** Liste de conversations : boîte de réception (défaut), libellé, recherche Gmail, non lus ; par pages de 25 au plus */
function threads_(b) {
  var me = me_(), q = String(b.q || ''), opt = { maxResults: Math.min(Number(b.max) || 25, 25) };
  if (b.unread) q = (q + ' is:unread').trim();
  if (q) opt.q = q;
  opt.labelIds = b.label ? [String(b.label)] : (q ? [] : ['INBOX']);
  if (ESSAI_) opt.labelIds = [essaiLabel_()];   // mode essai : la liste ne contient QUE les conversations TEST (recherche comprise)
  if (!opt.labelIds.length) delete opt.labelIds;
  if (b.page_token) opt.pageToken = String(b.page_token);
  var res = Gmail.Users.Threads.list('me', opt), list = [];
  (res.threads || []).forEach(function (t) {
    list.push(threadMeta_(threadLight_(t.id), me));
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
  if (ESSAI_) return { ok: true, labels: [{ id: essaiLabel_(), name: ESSAI_.libelle, type: 'user' }] };   // mode essai : son seul libellé
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
      // (v1.63, relecture) seulement un lien temporaire SIGNÉ du stockage Supabase : aucune autre adresse n'est lue par ce script
      if (f.url && !/^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/sign\/[^\s]+$/.test(String(f.url))) throw new Error('adresse refusée (lien temporaire du stockage attendu)');
      if (f.id && !/^[\w-]{10,200}$/.test(String(f.id))) throw new Error('identifiant Drive refusé');
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
  if (ESSAI_) return historyEssai_(b);
  var me = me_(), profile = Gmail.Users.getProfile('me'), ids = {}, full = false;
  if (b.ids && b.ids.length) {   // conversations restées en attente au passage précédent : lues telles quelles, sans historique
    var out0 = [];
    b.ids.slice(0, 50).forEach(function (id) { try { out0.push(threadMeta_(threadLight_(String(id)), me)); } catch (err) { out0.push({ id: String(id), missing: true }); } });
    return { ok: true, account: me, threads: out0, remaining: [] };
  }
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
    try { out.push(threadMeta_(threadLight_(id), me)); }
    catch (err) { out.push({ id: id, missing: true }); }   // conversation supprimée définitivement depuis Gmail
  });
  return { ok: true, account: me, history_id: String(profile.historyId), threads: out, remaining: list.slice(limit), full: full };
}

/**
 * Documents Drive proposés en pièces jointes (v1.63) : nom, taille et type, lus avec les droits de CE compte (rien n'est partagé,
 * copié ni modifié). Fichier inaccessible : signalé (le partager avec ce compte, ou le déposer dans la fiche artiste).
 * Document Google (Docs, Sheets…) : taille de sa version PDF, celle qui part en pièce jointe.
 */
function filesInfo_(b) {
  var out = (b.ids || []).slice(0, 50).map(function (id) {
    id = String(id || '');
    if (!/^[\w-]{10,200}$/.test(id)) return { id: id, ok: false, error: 'Identifiant Drive refusé' };
    try {
      var f = DriveApp.getFileById(id), size = f.getSize();
      if (!size) { var blob = f.getBlob(); size = blob.getBytes().length; return { id: id, ok: true, name: blob.getName(), size: size, mime: blob.getContentType() }; }
      return { id: id, ok: true, name: f.getName(), size: size, mime: f.getMimeType() };
    } catch (err) { return { id: id, ok: false, error: 'Inaccessible depuis ce compte Google' }; }
  });
  return { ok: true, files: out };
}

/* ════════════════════════ Mode essai (v1.63, décision d'Anthony du 09/11/2026) ════════════════════════
 * Script d'ESSAI séparé sur la vraie boîte anthony@, branché sur le projet Supabase de TEST. Propriétés du script :
 *   MODE_ESSAI = oui (TOUTE valeur non vide active le mode, « non » compris : pour le quitter, supprimer la propriété) · LIBELLE_ESSAI = Matrice-essai (libellé Gmail posé à la main sur les conversations TEST) ·
 *   DESTINATAIRES_ESSAI = adresses autorisées, séparées par des virgules (alias « +… » compris).
 * Règles : une conversation est autorisée si AU MOINS UN de ses messages porte le libellé (une réponse arrivée ensuite, sans libellé,
 * reste lisible ; une conversation dont on retire le libellé ne l'est plus) ; la synchronisation part de la seule liste des
 * conversations portant le libellé, jamais de l'historique de toute la boîte ; tout envoi ne vise que les destinataires d'essai ;
 * mode demandé sans libellé existant ni destinataires valides → toutes les actions de boîte et d'envoi refusées.
 */
var ESSAI_ = (function () {
  var p = PropertiesService.getScriptProperties();
  if (!String(p.getProperty('MODE_ESSAI') || '').trim()) return null;
  return { libelle: String(p.getProperty('LIBELLE_ESSAI') || '').trim(),
    dest: String(p.getProperty('DESTINATAIRES_ESSAI') || '').split(/[,;\s]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean) };
})();
var SYSTEME_ = /^(INBOX|SENT|DRAFT|TRASH|SPAM|STARRED|IMPORTANT|UNREAD|CHAT|CATEGORY_\w+)$/i;
var ESSAI_LABEL_ = null;
/** Identifiant du libellé d'essai (libellé utilisateur existant, nom exact) ; '' s'il manque */
function essaiLabel_() {
  if (ESSAI_LABEL_ !== null) return ESSAI_LABEL_;
  var l = (Gmail.Users.Labels.list('me').labels || []).filter(function (x) { return x.type === 'user' && x.name === ESSAI_.libelle; })[0];
  ESSAI_LABEL_ = l ? l.id : '';
  return ESSAI_LABEL_;
}
/** Motif de blocage si le mode essai est mal configuré, sinon '' */
function essaiConfig_() {
  if (!ESSAI_.libelle || ESSAI_.libelle.length > 60 || SYSTEME_.test(ESSAI_.libelle)) return 'Mode essai : propriété LIBELLE_ESSAI absente ou invalide.';
  if (!ESSAI_.dest.length || ESSAI_.dest.some(function (x) { return !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(x); })) return 'Mode essai : propriété DESTINATAIRES_ESSAI absente ou invalide.';
  if (!essaiLabel_()) return 'Mode essai : le libellé Gmail « ' + ESSAI_.libelle + ' » n’existe pas.';
  return '';
}
/** Adresse sans « +alias », en minuscules */
function sansAlias_(e) { var m = String(e || '').toLowerCase().match(/^([^@+]+)(\+[^@]*)?@(.+)$/); return m ? m[1] + '@' + m[3] : ''; }
/**
 * (relecture de 1c79901, B1) TOUTES les adresses d'un champ, ou null au moindre doute : virgule seule comme séparateur (« ; » refusé),
 * chaque morceau = une adresse seule ou « Nom <adresse> » (nom sans @ ni chevron), exactement autant de « @ » que d'adresses.
 */
function adressesStrictes_(v) {
  var s = String(v == null ? '' : v).trim(), out = [];
  if (!s) return out;
  if (/[;\r\n]/.test(s)) return null;
  var parts = s.split(','), simple = /^[^\s<>"@,;()\[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim(), m;
    if (!p) return null;
    if (simple.test(p)) out.push(p.toLowerCase());
    else if ((m = p.match(/^(?:"[^"@<>\\]*"|[^"<>@,;]*)\s*<([^\s<>"@,;()\[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>$/))) out.push(m[1].toLowerCase());
    else return null;
  }
  return (s.match(/@/g) || []).length === out.length ? out : null;
}
/** Envoi d'essai : chaque adresse de chaque champ (À, Copie, Copie cachée) parmi les destinataires d'essai, sinon refus */
function destOk_(list) {
  var ok = ESSAI_.dest.map(sansAlias_);
  for (var i = 0; i < list.length; i++) {
    var a = adressesStrictes_(list[i]);
    if (a === null) return false;
    for (var j = 0; j < a.length; j++) if (!sansAlias_(a[j]) || ok.indexOf(sansAlias_(a[j])) < 0) return false;
  }
  return true;
}
/** Conversation TEST : au moins un message porte le libellé (lecture des seuls libellés de la conversation) */
function threadEssai_(id) {
  if (!/^[0-9a-f]{6,32}$/i.test(String(id || ''))) return false;
  try {
    var t = Gmail.Users.Threads.get('me', String(id), { format: 'minimal', fields: 'messages(labelIds)' }), L = essaiLabel_();
    return (t.messages || []).some(function (m) { return (m.labelIds || []).indexOf(L) >= 0; });
  } catch (err) { return false; }
}
/** Refus du mode essai, avec un CODE distinct : « hors_essai » (cette conversation n'est pas TEST : la synchronisation l'écarte et
 *  continue) ; « essai » (configuration, destinataire, brouillon, libellé… : toujours visible) — jamais déduit du texte */
/** Forme comparable d'un libellé : NFKC, caractères invisibles retirés (espaces insécables, largeur nulle, BOM…), sans casse */
// caractères de format et ignorables (propriétés Unicode Cf et Default_Ignorable_Code_Point) ; classe explicite équivalente si le
// moteur refusait les propriétés Unicode (V8 d'Apps Script les accepte : même moteur que Chrome / Node)
var INVISIBLES_SECOURS_ = /[\u00AD\u034F\u061C\u0600-\u0605\u06DD\u070F\u0890\u0891\u08E2\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;
var INVISIBLES_ = (function () { try { return new RegExp('[\\p{Cf}\\p{Default_Ignorable_Code_Point}]', 'gu'); } catch (err) { return INVISIBLES_SECOURS_; } })();
function normLib_(x) { return String(x == null ? '' : x).normalize('NFKC').replace(INVISIBLES_, '').replace(/\u00A0/g, ' ').trim().toLowerCase(); }
function refusEssai_(why, code) { return { ok: false, refused: true, code: code || 'essai', error: why + ' Rien n’est lu ni envoyé (mode essai).' }; }
/** Garde du mode essai, action par action, AVANT toute lecture ou écriture du contenu */
function essaiGarde_(a, b) {
  var cfg = essaiConfig_(); if (cfg) return refusEssai_(cfg);
  var L = essaiLabel_();
  if (a === 'thread' || a === 'modify' || a === 'status' || a === 'reply' || (a === 'compose' && b.thread_id))
    if (!threadEssai_(b.thread_id)) return refusEssai_('Conversation hors essai (sans le libellé « ' + ESSAI_.libelle + ' »).', 'hors_essai');
  if (a === 'modify' && [].concat(b.remove || []).some(function (x) { var v = normLib_(x); return v === normLib_(L) || v === normLib_(ESSAI_.libelle); }))
    return refusEssai_('Le libellé d’essai ne se retire pas depuis l’application.');
  // (relecture de 1c79901, B2) brouillon désigné : seulement un brouillon d'une conversation TEST (jamais écraser un brouillon réel)
  if (a === 'compose' && b.draft_id) {
    var d; try { d = Gmail.Users.Drafts.get('me', String(b.draft_id), { format: 'minimal' }); } catch (err) { d = null; }
    if (!d || !d.message || !threadEssai_(d.message.threadId)) return refusEssai_('Brouillon hors essai.');
  }
  if ((a === 'compose' || a === 'mail' || a === 'reply') && !destOk_([b.to, b.cc, b.bcc])) return refusEssai_('Destinataire hors des adresses d’essai.');
  if (a === 'reply' && !b.to) return refusEssai_('Relance d’essai : destinataire à indiquer explicitement.');
  if (a === 'attachment') {
    var m; try { m = Gmail.Users.Messages.get('me', String(b.message_id), { format: 'minimal', fields: 'threadId' }); } catch (err) { m = null; }
    if (!m || !threadEssai_(m.threadId)) return refusEssai_('Pièce jointe d’un message hors essai.');
  }
  if (a === 'mail_by_msgid') {
    var id = typeof b.message_id === 'string' ? b.message_id : '';
    if (!MSGID_RE_.test(id)) return null;   // refusé ensuite par mailByMsgId_ (même contrôle)
    var found = GmailApp.search('rfc822msgid:' + id.slice(1, -1) + ' label:"' + ESSAI_.libelle.replace(/"/g, '') + '"', 0, 1);
    // message trouvé : sa conversation doit être TEST (au moins un message portant le libellé)
    if (!found.length || !threadEssai_(found[0].getId())) return { ok: true, found: false, essai: { libelle: ESSAI_.libelle, id: L } };
  }
  return null;
}
/**
 * Synchronisation en mode essai : UNE lecture de la liste des conversations portant le libellé (Threads.list, labelIds = [libellé],
 * au plus 50), puis lecture des seules conversations changées depuis le point de reprise (historyId de la conversation) — jamais
 * l'historique de toute la boîte. Conversations en attente : relues seulement si elles portent toujours le libellé.
 */
function historyEssai_(b) {
  var me = me_(), L = essaiLabel_(), profile = Gmail.Users.getProfile('me');
  if (b.ids && b.ids.length) {
    return { ok: true, account: me, remaining: [], threads: b.ids.slice(0, 50).map(String).filter(threadEssai_).map(function (id) {
      try { return threadMeta_(threadLight_(id), me); } catch (err) { return { id: id, missing: true }; } }) };
  }
  // pages suivantes lues aussi (relecture de 1c79901), au plus 5 pages de 50 conversations TEST
  var depuis = String(b.start_history_id || ''), toutes = [], token = null, n = 0;
  do {
    var r = Gmail.Users.Threads.list('me', { labelIds: [L], maxResults: 50, pageToken: token });
    toutes = toutes.concat(r.threads || []); token = r.nextPageToken; n++;
  } while (token && n < 5);
  var plusRecent = function (h) { h = String(h || ''); return !depuis || h.length > depuis.length || (h.length === depuis.length && h > depuis); };
  var ids = toutes.filter(function (t) { return plusRecent(t.historyId); }).map(function (t) { return t.id; });
  var limit = Math.min(Number(b.max) || 30, 50);
  return { ok: true, account: me, history_id: String(profile.historyId), full: !depuis,
    threads: ids.slice(0, limit).map(function (id) { try { return threadMeta_(threadLight_(id), me); } catch (err) { return { id: id, missing: true }; } }),
    remaining: ids.slice(limit) };
}
