/**
 * L'ArtBoristerie — script Google du compte production@ (Drive + Gmail).
 *
 * 1. Dossiers de production : appelé par Supabase quand une date passe en
 *    "Confirmée Salle" ou "Confirmée Festival". Crée :
 *      <Artiste> / 032_Production / <Année> / MM_DD • Ville • Salle (CP)
 *    en copiant le dossier modèle (L'ARTBO TEMPLATES), puis enregistre l'ID sur la date.
 * 2. Brouillons Gmail : le site envoie le mail préparé (action "draft").
 * 3. Chaque matin (déclencheur dailyJob) : brouillons des boucles à envoyer
 *    + récap des notifications par mail à Anthony et Chloé.
 * 4. "contract" / "contract_pdf" : contrat rempli depuis le modèle Google Docs, puis PDF.
 * 5. "link_folders" : rattache les dossiers de dates déjà existants ;
 *    "folder_path" : chemin du dossier (pour le Finder).
 *
 * Le lien se fait par ID : le dossier peut ensuite être renommé ou déplacé
 * librement sans rien casser.
 *
 * Propriétés du script (Paramètres du projet > Propriétés du script) :
 *   SUPABASE_URL          https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  clé service_role du projet (secrète)
 *   WEBHOOK_SECRET        même valeur que settings.drive_webhook_secret
 *   TEMPLATE_FOLDER_ID    1LjcPIKo3zsOejsj8Dm1_nigbwPFg8QTU
 *   ARTISTS_ROOT_ID       1jcudFeSxND8_NuriMUOpUdOAybTd5e0l  (dossier qui contient "The Locos", etc.)
 *   PRODUCTION_FOLDER     032_Production
 */

function props_() {
  return PropertiesService.getScriptProperties().getProperties();
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var p = props_();
    if (!body.secret || body.secret !== p.WEBHOOK_SECRET) {
      return json_({ ok: false, error: 'Code secret du script incorrect (Réglages › Google)' });
    }
    var action = body.action || 'create_folder';
    if (action === 'create_folder') out = createShowFolder_(body.show_id, !!body.force);
    else if (action === 'draft') out = createDraft_(body);
    else if (action === 'link_folders') out = { ok: true, linked: linkExistingFolders() };
    else if (action === 'folder_path') out = { ok: true, path: folderPath_(body.folder_id) };
    else if (action === 'contract') out = createContract_(body);
    else if (action === 'contract_pdf') out = contractPdf_(body.doc_id);
    else if (action === 'ping') out = { ok: true, account: Session.getEffectiveUser().getEmail() };
    else out = { ok: false, error: 'Action inconnue : ' + action };
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json_(out);
}

// ─────────────── Gmail ───────────────

/** Brouillon dans la boîte production@. body : {to, cc, subject, html, attachments:[id Drive]} */
function createDraft_(body) {
  var opts = { htmlBody: body.html || '', name: 'L\'ArtBoristerie Productions' };
  if (body.cc) opts.cc = body.cc;
  var files = (body.attachments || []).map(function (id) {
    try { return DriveApp.getFileById(id).getBlob(); } catch (e) { return null; }
  }).filter(Boolean);
  if (files.length) opts.attachments = files;
  var draft = GmailApp.createDraft(body.to || '', body.subject || '', plain_(body.html || ''), opts);
  var msgId = draft.getMessage().getId();
  return { ok: true, draft_id: draft.getId(), url: 'https://mail.google.com/mail/u/0/#drafts?compose=' + msgId };
}

function plain_(html) {
  return String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}

/** Balises {{…}} remplies avec mail_vars() ; une balise vide reste visible en jaune */
function fill_(text, vars, html) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, function (m, k) {
    var v = vars[k];
    if (v === null || v === undefined || v === '') return html ? '<span style="background:#FFE9A8">[' + k + ' à compléter]</span>' : '[' + k + ' à compléter]';
    v = String(v);
    return html ? v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : v;
  });
}

/** Meilleur modèle : celui de l'artiste, sinon le générique */
function pickTemplate_(show, kind) {
  var list = sb_('GET', 'mail_templates?kind=eq.' + kind + '&select=*');
  var mine = list.filter(function (t) { return t.project_id === show.project_id; });
  var generic = list.filter(function (t) { return !t.project_id; });
  return mine[0] || generic[0] || null;
}

/**
 * Déclencheur quotidien (à créer une fois : Déclencheurs › dailyJob › tous les jours 7h-8h).
 * - prépare le brouillon des boucles qui arrivent à échéance (une seule fois par date)
 * - envoie le récap des nouvelles notifications à l'équipe
 */
function dailyJob() {
  var notifs = sb_('GET', 'notifications?emailed_at=is.null&select=*&order=created_at.asc') || [];
  var KIND = { boucle_accueil: 'boucle_tech', boucle_com: 'boucle_com' };
  var drafted = [];
  notifs.forEach(function (n) {
    var kind = KIND[n.kind];
    if (!kind || !n.show_id) return;
    try {
      var show = sb_('GET', 'shows?id=eq.' + n.show_id + '&select=id,project_id,venue,mail_log,conf_contact_id')[0];
      if (!show || (show.mail_log && show.mail_log[kind])) return;
      var tpl = pickTemplate_(show, kind);
      if (!tpl) return;
      var vars = sb_('POST', 'rpc/mail_vars', { p_show: show.id, p_contact: show.conf_contact_id });
      var out = createDraft_({ to: vars.contact_email || '', cc: tpl.cc, subject: fill_(tpl.subject, vars, false),
        html: fill_(tpl.html, vars, true), attachments: (tpl.attachments || []).map(function (a) { return a.id; }) });
      var log = show.mail_log || {};
      log[kind] = { at: new Date().toISOString(), to: vars.contact_email || '', draft: true, auto: true };
      sb_('PATCH', 'shows?id=eq.' + show.id, { mail_log: log });
      drafted.push(n.title + ' → brouillon prêt : ' + out.url);
    } catch (err) { drafted.push(n.title + ' → brouillon impossible : ' + err); }
  });
  if (!notifs.length) return;
  var site = setting_('site_url') || 'https://antcb.github.io/lartbo-matrice/';
  var rows = notifs.map(function (n) {
    return '<li><b>' + esc_(n.title) + '</b>' + (n.body ? '<br><span style="color:#5B677D">' + esc_(n.body) + '</span>' : '') + '</li>';
  }).join('');
  var html = '<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#16213A">'
    + '<p>Bonjour,</p><p>' + notifs.length + ' nouveauté' + (notifs.length > 1 ? 's' : '') + ' dans la Matrice :</p><ul>' + rows + '</ul>'
    + (drafted.length ? '<p><b>Brouillons préparés dans Gmail (production@) :</b><br>' + drafted.map(esc_).join('<br>') + '</p>' : '')
    + '<p><a href="' + site + '" style="color:#283C63;font-weight:bold">Ouvrir la Matrice</a></p></div>';
  GmailApp.sendEmail('anthony@lartboristerie.com,production@lartboristerie.com',
    'Matrice · ' + notifs.length + ' rappel' + (notifs.length > 1 ? 's' : '') + ' du ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM'),
    plain_(html), { htmlBody: html, name: 'Matrice L\'ArtBoristerie' });
  var ids = notifs.map(function (n) { return n.id; });
  sb_('PATCH', 'notifications?id=in.(' + ids.join(',') + ')', { emailed_at: new Date().toISOString() });
}

function esc_(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function setting_(key) { var r = sb_('GET', 'settings?key=eq.' + key + '&select=value')[0]; return r ? r.value : null; }

// ─────────────── Contrats ───────────────

/**
 * Copie le modèle dans le dossier de la date (sous-dossier « 01_Legal » s'il existe),
 * remplace les passages « XXX » (seq, dans l'ordre) puis les balises <<…>> (tags),
 * et surligne en jaune ce qui reste à compléter.
 */
function createContract_(b) {
  var tpl = DriveApp.getFileById(b.template_id);
  if (tpl.getMimeType() !== MimeType.GOOGLE_DOCS) {
    throw new Error('Le modèle de contrat doit être un Google Doc (ouvrir le .docx › Fichier › Enregistrer au format Google Docs), puis coller ce nouveau lien dans Réglages › Contrats.');
  }
  var folder = DriveApp.getFolderById(b.folder_id);
  var legal = null, it = folder.getFolders();
  while (it.hasNext()) { var f = it.next(); if (/^01[_ ]/.test(f.getName())) { legal = f; break; } }
  var copy = tpl.makeCopy(b.name, legal || folder);
  var doc = DocumentApp.openById(copy.getId());
  var parts = [doc.getBody(), doc.getHeader(), doc.getFooter()].filter(Boolean);
  (b.seq || []).forEach(function (s) {
    var i = 0;
    parts.forEach(function (p) { i = replaceSeq_(p, s.find, s.values, i); });
  });
  Object.keys(b.tags || {}).forEach(function (k) {
    var v = b.tags[k];
    if (v === null || v === undefined || v === '') return;   // balise vide : laissée visible
    parts.forEach(function (p) { replaceSeq_(p, '<<' + k + '>>', [String(v)], 0, true); });
  });
  parts.forEach(function (p) {
    highlight_(p, '<<[^>]*>>');
    highlight_(p, 'X{2,4}');
  });
  doc.saveAndClose();
  return { ok: true, doc_id: copy.getId() };
}

function escRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Remplace chaque occurrence du texte par values[i], values[i+1]… (repeat : toujours values[0]).
 * La recherche repart du début après chaque remplacement : les valeurs ne contiennent jamais le texte cherché.
 */
function replaceSeq_(container, find, values, start, repeat) {
  var i = start || 0, re = escRe_(find), r = container.findText(re), guard = 0;
  while (r && guard++ < 200) {
    if (!repeat && i >= values.length) break;
    var v = repeat ? values[0] : values[i++];
    if (v && String(v).indexOf(find) >= 0) break;
    var t = r.getElement().asText(), a = r.getStartOffset(), z = r.getEndOffsetInclusive();
    if (v) { if (z + 1 >= t.getText().length) t.appendText(v); else t.insertText(z + 1, v); }   // insérer après puis supprimer : garde la mise en forme
    t.deleteText(a, z);
    r = container.findText(re);
  }
  return i;
}

function highlight_(container, re) {
  var r = container.findText(re);
  while (r) {
    r.getElement().asText().setBackgroundColor(r.getStartOffset(), r.getEndOffsetInclusive(), '#FFE9A8');
    r = container.findText(re, r);
  }
}

/** PDF du contrat, à côté du Google Doc (même nom) */
function contractPdf_(docId) {
  var file = DriveApp.getFileById(docId);
  var parent = file.getParents().next();
  var old = parent.getFilesByName(file.getName() + '.pdf');
  while (old.hasNext()) old.next().setTrashed(true);
  var pdf = parent.createFile(file.getAs(MimeType.PDF).setName(file.getName() + '.pdf'));
  return { ok: true, pdf_id: pdf.getId() };
}

// ─────────────── Drive ───────────────

/** Chemin lisible du dossier (« Mon Drive/…/10_17 • Ville • Salle (33000) ») pour le Finder */
function folderPath_(id) {
  var f = DriveApp.getFolderById(id), parts = [];
  for (var i = 0; i < 20 && f; i++) {
    parts.unshift(f.getName());
    var it = f.getParents();
    f = it.hasNext() ? it.next() : null;
  }
  if (parts[0] === 'Mon Drive' || parts[0] === 'My Drive') parts.shift();
  return parts.join('/');
}

/** Point d'entrée manuel pour tester depuis l'éditeur Apps Script. */
function testCreate() {
  var showId = 'COLLER_ICI_UN_ID_DE_DATE';
  Logger.log(JSON.stringify(createShowFolder_(showId, false)));
}

function createShowFolder_(showId, force) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var show = sb_('GET', 'shows?id=eq.' + showId +
      '&select=id,venue,date,city,department,drive_folder_id,project:projects(id,name,drive_artist_folder_id),structure:structures(postal_code)')[0];
    if (!show) throw new Error('Date introuvable : ' + showId);

    // Déjà créé et toujours présent → on ne refait rien
    if (show.drive_folder_id) {
      try {
        var existing = DriveApp.getFolderById(show.drive_folder_id);
        if (!existing.isTrashed()) return { ok: true, folder_id: show.drive_folder_id, existed: true };
      } catch (ignore) { /* dossier supprimé → on recrée */ }
      if (!force) return { ok: true, folder_id: show.drive_folder_id, existed: true };
    }

    if (!show.project) throw new Error('Aucun projet/artiste rattaché à la date');
    if (!show.date) throw new Error('La date n\'a pas de jour renseigné');

    var p = props_();
    var artist = artistFolder_(show.project, p);
    var prod = childFolder_(artist, p.PRODUCTION_FOLDER || '032_Production', true);
    var year = childFolder_(prod, show.date.substring(0, 4), true);

    var name = folderName_(show);
    var template = DriveApp.getFolderById(p.TEMPLATE_FOLDER_ID);
    var folder = year.createFolder(name);
    copyContents_(template, folder);

    sb_('PATCH', 'shows?id=eq.' + show.id, {
      drive_folder_id: folder.getId(),
      drive_folder_error: null
    });
    return { ok: true, folder_id: folder.getId(), name: name };
  } catch (err) {
    try { sb_('PATCH', 'shows?id=eq.' + showId, { drive_folder_error: String(err).substring(0, 500) }); } catch (ignore) {}
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/** MM_DD • Ville • Salle (CP) — nomenclature L'ArtBo. */
function folderName_(show) {
  var d = show.date.split('-'); // YYYY-MM-DD
  var venue = String(show.venue || '').replace(/\*\*/g, '').replace(/\s*•\s*[A-Z\/]{1,5}\s*$/, '').trim();
  var cp = (show.structure && show.structure.postal_code) || show.department;
  return d[1] + '_' + d[2] + ' • ' + (show.city || '').trim() + ' • ' + venue + (cp ? ' (' + cp + ')' : '');
}

function artistFolder_(project, p) {
  if (project.drive_artist_folder_id) {
    try { return DriveApp.getFolderById(project.drive_artist_folder_id); } catch (ignore) {}
  }
  var root = DriveApp.getFolderById(p.ARTISTS_ROOT_ID);
  // Dossier « Nom de l'artiste » (le nom du projet peut avoir un suffixe « • TL »)
  var folder = childFolder_(root, project.name, false) || childFolder_(root, project.name.replace(/\s*•.*$/, '').trim(), false);
  if (!folder) throw new Error('Dossier artiste "' + project.name + '" introuvable dans le dossier racine');
  // On mémorise l'ID pour ne plus dépendre du nom
  sb_('PATCH', 'projects?id=eq.' + project.id, { drive_artist_folder_id: folder.getId() });
  return folder;
}

function childFolder_(parent, name, createIfMissing) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) return f;
  }
  return createIfMissing ? parent.createFolder(name) : null;
}

/** Copie récursive (Drive ne sait pas copier un dossier directement). */
function copyContents_(src, dest) {
  var files = src.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    f.makeCopy(f.getName(), dest);
  }
  var folders = src.getFolders();
  while (folders.hasNext()) {
    var sub = folders.next();
    copyContents_(sub, dest.createFolder(sub.getName()));
  }
}

function sb_(method, path, payload) {
  var p = props_();
  var opts = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      apikey: p.SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + p.SUPABASE_SERVICE_KEY,
      Prefer: 'return=representation'
    },
    contentType: 'application/json'
  };
  if (payload) opts.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(p.SUPABASE_URL + '/rest/v1/' + path, opts);
  if (res.getResponseCode() >= 300) {
    throw new Error('Supabase ' + res.getResponseCode() + ' : ' + res.getContentText());
  }
  var txt = res.getContentText();
  return txt ? JSON.parse(txt) : null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Parcourt <Artiste>/032_Production/<Année>/ et rattache chaque dossier
 * "MM_DD • …" (ou ancien "MM-DD • …") à la date du même projet et du même jour.
 * Lancé depuis Réglages › Google › « Rattacher les dossiers Drive existants ».
 */
function linkExistingFolders() {
  var p = props_();
  var projects = sb_('GET', 'projects?select=id,name,drive_artist_folder_id');
  var shows = sb_('GET', 'shows?select=id,project_id,date,drive_folder_id&drive_folder_id=is.null&date=not.is.null');
  var linked = 0;
  projects.forEach(function (proj) {
    var artist;
    try { artist = artistFolder_(proj, p); } catch (e) { return; }
    var prod = childFolder_(artist, p.PRODUCTION_FOLDER || '032_Production', false);
    if (!prod) return;
    var years = prod.getFolders();
    while (years.hasNext()) {
      var y = years.next();
      if (!/^\d{4}$/.test(y.getName())) continue;
      var folders = y.getFolders();
      while (folders.hasNext()) {
        var f = folders.next();
        var m = f.getName().match(/^(\d{2})[-_](\d{2})/);   // « 10_17 • … » ou ancien « 10-17 • … »
        if (!m) continue;
        var date = y.getName() + '-' + m[1] + '-' + m[2];
        var show = shows.filter(function (s) { return s.project_id === proj.id && s.date === date && !s.drive_folder_id; })[0];
        if (show) {
          sb_('PATCH', 'shows?id=eq.' + show.id, { drive_folder_id: f.getId() });
          show.drive_folder_id = f.getId();
          linked++;
        }
      }
    }
  });
  Logger.log(linked + ' dossiers rattachés');
  return linked;
}
