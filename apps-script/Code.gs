/**
 * L'ArtBoristerie — script Google du compte production@ (Drive + Gmail).
 *
 * 1. Dossiers de production : appelé par Supabase quand une date passe en
 *    "Confirmée Salle" ou "Confirmée Festival". Crée :
 *      <Artiste> / 032_Production / <Année> / MM-DD • Ville • Salle (79)
 *    en copiant le dossier modèle (L'ARTBO TEMPLATES), puis enregistre l'ID sur la date.
 * 2. Brouillons Gmail : le site envoie le mail préparé (action "draft").
 * 3. Chaque matin (déclencheur dailyJob) : brouillons des boucles à envoyer
 *    + récap des notifications par mail à Anthony et Chloé.
 * 4. "contract" / "contract_pdf" : contrat rempli depuis le modèle Google Docs, puis PDF.
 * 5. Salariés : "rh_folders" (dossier « NOM Prénom » de chaque salarié), "rh_file_docs" (range
 *    les pièces reçues, renommées « RIB - NOM Prénom », « BDS-NOM Prénom AAAA-MM-JJ »…).
 * 6. "rename_audit" / "rename_apply" : liste dans un Google Sheet les dossiers de dates et contrats
 *    mal nommés avec le nom proposé, puis renomme seulement les lignes cochées.
 * 7. "link_folders" : rattache les dossiers de dates déjà existants ;
 *    "folder_path" : chemin du dossier (pour le Finder).
 * 8. "file_piece" : range une pièce du budget dans 02_Finance du dossier de la date (doublons signalés).
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
    else if (action === 'gmail_attachments') out = gmailAttachments_(body.query);
    else if (action === 'link_folders') out = { ok: true, linked: linkExistingFolders() };
    else if (action === 'folder_path') out = { ok: true, path: folderPath_(body.folder_id) };
    else if (action === 'contract') out = createContract_(body);
    else if (action === 'contract_pdf') out = contractPdf_(body.doc_id);
    else if (action === 'rh_folders') out = rhFolders_();
    else if (action === 'rh_sheet') out = rhSheet_(body);
    else if (action === 'rh_file_docs') out = { ok: true, filed: rhFileDocs_() };
    else if (action === 'rename_audit') out = renameAudit();
    else if (action === 'rename_apply') out = renameApply();
    else if (action === 'file_piece') out = filePiece_(body);
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
  // Pièces jointes : fichiers Drive ({id} ou identifiant) ou fichiers déposés dans la Matrice ({path} du stockage « suivi »)
  var p = props_();
  var files = (body.attachments || []).map(function (a) {
    try {
      if (typeof a === 'string') return DriveApp.getFileById(a).getBlob();
      if (a.id) return DriveApp.getFileById(a.id).getBlob();
      // pièce jointe d'un mail reçu dans Gmail (sans passer par l'ordinateur)
      if (a.gmail) return GmailApp.getMessageById(a.gmail).getAttachments({ includeInlineImages: false })[a.idx || 0].copyBlob();
      if (a.path) {
        var res = UrlFetchApp.fetch(p.SUPABASE_URL + '/storage/v1/object/suivi/' + a.path.split('/').map(encodeURIComponent).join('/'),
          { headers: authHeaders_({}), muteHttpExceptions: true });
        if (res.getResponseCode() >= 300) return null;
        return res.getBlob().setName(a.name || a.path.split('/').pop());
      }
    } catch (e) { Logger.log('Pièce jointe : ' + e); }
    return null;
  }).filter(Boolean);
  if (files.length) opts.attachments = files;
  var draft = GmailApp.createDraft(body.to || '', body.subject || '', plain_(body.html || ''), opts);
  var msgId = draft.getMessage().getId();
  return { ok: true, draft_id: draft.getId(), url: 'https://mail.google.com/mail/u/0/#drafts?compose=' + msgId };
}

/** Pièces jointes des mails Gmail (production@) qui correspondent à la recherche, du plus récent au plus ancien */
function gmailAttachments_(query) {
  var q = String(query || '').trim();
  var threads = GmailApp.search((q ? q + ' ' : '') + 'has:attachment', 0, 15), out = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      m.getAttachments({ includeInlineImages: false }).forEach(function (a, i) {
        out.push({ msg: m.getId(), idx: i, name: a.getName(), size: a.getSize(), subject: m.getSubject(), from: m.getFrom(), date: m.getDate().toISOString() });
      });
    });
  });
  out.sort(function (a, b) { return b.date < a.date ? -1 : 1; });
  return { ok: true, attachments: out.slice(0, 60) };
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

/** Le modèle s'applique-t-il à cette date ? (mêmes règles que la Matrice : salle, festival, co-réalisation, cession) */
function applies_(rule, s) {
  var r = { all: true, salle: /Salle/.test(s.status || ''), festival: /Festival/.test(s.status || ''),
    cr: s.contract_type === 'Co-Réalisation', cession: s.contract_type === 'Cession' }[rule || 'all'];
  return r === undefined ? true : r;
}

/** Meilleur modèle, comme le choix proposé dans la Matrice : celui de l'artiste avant le générique, celui dont la règle correspond avant « toutes les dates » */
function pickTemplate_(show, kind) {
  var list = (sb_('GET', 'mail_templates?kind=eq.' + kind + '&select=*') || [])
    .filter(function (t) { return !t.project_id || t.project_id === show.project_id; });
  var score = function (t) { return (t.project_id === show.project_id ? 10 : 0) + (!applies_(t.applies_to, show) ? -20 : (t.applies_to && t.applies_to !== 'all' ? 5 : 0)); };
  list.sort(function (a, b) { return score(b) - score(a) || String(a.name || '').localeCompare(String(b.name || '')); });
  return list[0] || null;
}

/**
 * Déclencheur quotidien (à créer une fois : Déclencheurs › dailyJob › tous les jours 7h-8h).
 * - prépare le brouillon des boucles qui arrivent à échéance (une seule fois par date)
 * - envoie le récap des nouvelles notifications à l'équipe
 */
function dailyJob() {
  try { rhFileDocs_(); } catch (err) { Logger.log('Pièces salariés : ' + err); }
  var notifs = sb_('GET', 'notifications?emailed_at=is.null&select=*&order=created_at.asc') || [];
  var KIND = { boucle_accueil: 'boucle_tech', boucle_com: 'boucle_com' };
  var drafted = [];
  notifs.forEach(function (n) {
    var kind = KIND[n.kind];
    if (!kind || !n.show_id) return;
    try {
      var show = sb_('GET', 'shows?id=eq.' + n.show_id + '&select=id,project_id,venue,status,contract_type,mail_log,conf_contact_id')[0];
      if (!show || (show.mail_log && show.mail_log[kind])) return;
      var tpl = pickTemplate_(show, kind);
      if (!tpl) return;
      var vars = sb_('POST', 'rpc/mail_vars', { p_show: show.id, p_contact: show.conf_contact_id });
      var out = createDraft_({ to: vars.contact_email || '', cc: tpl.cc, subject: fill_(tpl.subject, vars, false),
        html: fill_(tpl.html, vars, true), attachments: tpl.attachments || [] });
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

// ─────────────── Salariés ───────────────

var RH_LABELS = { rib: 'RIB', carte_vitale: 'Carte vitale', cni: 'CNI', passeport: 'Passeport', photo: 'Photo d\'identité',
  permis: 'Permis de conduire', carte_grise: 'Carte grise', bds: 'BDS', ndf: 'NDF', autre: 'Document' };

function rhName_(e) { return [String(e.last_name || '').toUpperCase(), e.first_name || ''].join(' ').trim(); }
function rhNorm_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function rhRoot_() {
  var id = setting_('employees_folder_id');
  if (!id) throw new Error('Dossier Drive des salariés non renseigné (Réglages)');
  return DriveApp.getFolderById(id);
}

/** Dossier « NOM Prénom » de chaque salarié : rattaché s'il existe déjà, créé sinon */
function rhFolders_() {
  var root = rhRoot_(), byName = {}, it = root.getFolders();
  while (it.hasNext()) { var f = it.next(); byName[rhNorm_(f.getName())] = f; }
  var list = sb_('GET', 'employees?drive_folder_id=is.null&select=id,last_name,first_name') || [];
  var created = 0, linked = 0;
  list.forEach(function (e) {
    var name = rhName_(e); if (!name) return;
    var f = byName[rhNorm_(name)];
    if (f) linked++; else { f = root.createFolder(name); created++; }
    sb_('PATCH', 'employees?id=eq.' + e.id, { drive_folder_id: f.getId() });
  });
  return { ok: true, created: created, linked: linked };
}

/** Fiche RH (Google Sheet) du salarié à partir du modèle « Fiche RH 2026 », balises <<…>> remplies */
function rhSheet_(b) {
  var tpl = setting_('rh_sheet_template') || '1T3T1gwquWRLsruEeUA0xDn6yt-HRIwqozs6NU5lMp_o';
  var e = sb_('GET', 'employees?id=eq.' + b.employee_id + '&select=id,last_name,first_name,drive_folder_id')[0];
  if (!e.drive_folder_id) { rhFolders_(); e = sb_('GET', 'employees?id=eq.' + b.employee_id + '&select=id,last_name,first_name,drive_folder_id')[0]; }
  var folder = DriveApp.getFolderById(e.drive_folder_id);
  var old = folder.getFilesByName(b.name);
  while (old.hasNext()) old.next().setTrashed(true);
  var copy = DriveApp.getFileById(tpl).makeCopy(b.name, folder);
  var ss = SpreadsheetApp.openById(copy.getId());
  ss.getSheets().forEach(function (sh) {
    Object.keys(b.values || {}).forEach(function (k) { sh.createTextFinder('<<' + k + '>>').matchCase(false).replaceAllWith(String(b.values[k] || '')); });
    sh.createTextFinder('<<[^>]*>>').useRegularExpression(true).replaceAllWith('');
  });
  return { ok: true, url: ss.getUrl() };
}

/**
 * Dossier compta d'un bulletin de paie ou d'une note de frais :
 *   01_Finance - L'ArtBoristerie / 2025:2026 (exercice du 1er octobre au 30 septembre) /
 *     E - Sociale / AAAA-MM                      (bulletin de paie, mois du travail)
 *     B - Notes de Frais / AAAA-MM / NOM Prénom  (note de frais, dossier type copié depuis le modèle « NOM Prénom »)
 */
function financeFolder_(d, e) {
  var root = DriveApp.getFolderById(setting_('finance_folder_id') || '1EoWoCI8NdJ0TKUjpF8N35_gSKAYJsK_3');
  var ym = String(d.when || d.at || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('date du document inconnue');
  var y = Number(ym.slice(0, 4)), start = Number(ym.slice(5, 7)) >= 10 ? y : y - 1;
  var year = childFolder_(root, start + ':' + (start + 1), false) || childFolder_(root, start + '/' + (start + 1), false);
  if (!year) {
    // nouvel exercice (octobre → septembre) : copie de « Template 20XX:20XX » s'il existe
    year = root.createFolder(start + ':' + (start + 1));
    var tpl = childFolder_(root, 'Template 20XX:20XX', false) || childFolder_(root, 'Template 20XX/20XX', false);
    if (tpl) copyContents_(tpl, year);
  }
  if (d.kind === 'bds') return childFolder_(childFolder_(year, 'E - Sociale', true), ym, true);
  var month = childFolder_(childFolder_(year, 'B - Notes de Frais', true), ym, true);
  var name = rhName_(e), mine = childFolder_(month, name, false);
  if (mine) return mine;
  mine = month.createFolder(name);
  copyContents_(DriveApp.getFolderById(setting_('ndf_template_folder_id') || '1IXC0mGW8C4NQNphzPHXhTfg5JcCICnHA'), mine);
  // le modèle « NDF-YYYY-MM NOM Prénom.xlsx » prend le bon nom
  var files = mine.getFiles();
  while (files.hasNext()) { var f = files.next(); f.setName(f.getName().replace('YYYY-MM', ym).replace('NOM Prénom', name)); }
  return mine;
}

/** Range dans le Drive les pièces en attente (stockage temporaire « rh »), puis les supprime du stockage */
function rhFileDocs_() {
  var p = props_(), filed = 0;
  var list = sb_('GET', 'employees?select=id,last_name,first_name,drive_folder_id,docs') || [];
  list.forEach(function (e) {
    var docs = e.docs || [];
    docs.forEach(function (d) {
      if (!d.path || d.file_id) return;
      if (!e.drive_folder_id) { rhFolders_(); e.drive_folder_id = sb_('GET', 'employees?id=eq.' + e.id + '&select=drive_folder_id')[0].drive_folder_id; }
      // Bulletins de paie et notes de frais : dans leurs dossiers à part (Réglages › Google)
      // Bulletins de paie et notes de frais : dans la compta (01_Finance), pas dans le dossier du salarié
      var folder;
      try { folder = (d.kind === 'bds' || d.kind === 'ndf') ? financeFolder_(d, e) : DriveApp.getFolderById(e.drive_folder_id); }
      catch (err) { Logger.log('Rangement impossible (' + d.kind + ') : ' + err); return; }
      var url = p.SUPABASE_URL + '/storage/v1/object/rh/' + d.path.split('/').map(encodeURIComponent).join('/');
      var res = UrlFetchApp.fetch(url, { headers: authHeaders_({}), muteHttpExceptions: true });
      if (res.getResponseCode() >= 300) { Logger.log('Pièce introuvable : ' + d.path); return; }
      var ext = (String(d.name || d.path).match(/\.(\w{1,5})$/) || ['', 'pdf'])[1].toLowerCase();
      var base = d.target || ((RH_LABELS[d.kind] || 'Document') + ' - ' + rhName_(e)), name = base + '.' + ext, n = 1;
      while (folder.getFilesByName(name).hasNext()) name = base + ' (' + (++n) + ').' + ext;
      var file = folder.createFile(res.getBlob().setName(name));
      // on enregistre d'abord le lien vers la copie Drive ; la pièce d'origine n'est supprimée qu'ensuite
      var oldPath = d.path;
      d.file_id = file.getId(); d.drive_name = name; d.path = null;
      try { sb_('PATCH', 'employees?id=eq.' + e.id, { docs: docs }); }
      catch (err) {
        file.setTrashed(true); d.file_id = null; d.drive_name = null; d.path = oldPath;
        Logger.log('Pièce non rangée (enregistrement impossible, réessai au prochain passage) : ' + err); return;
      }
      UrlFetchApp.fetch(url, { method: 'delete', headers: authHeaders_({}), muteHttpExceptions: true });
      filed++;
    });
  });
  return filed;
}

// ─────────────── Pièces du budget → dossier Drive de la date ───────────────

/**
 * Range une pièce (facture, bulletin, note de frais) dans « 02_Finance » du dossier de la date.
 * Si le même fichier y est déjà (même contenu ou même nom), rien n'est ajouté : on renvoie le doublon
 * et la Matrice demande quoi faire (decision : replace = remplacer l'ancien, skip = garder l'ancien, keep_both).
 */
function filePiece_(b) {
  if (!b.folder_id) throw new Error('La date n’a pas encore de dossier Drive');
  var root = DriveApp.getFolderById(b.folder_id);
  var folder = childFolder_(root, '02_Finance', false) || childFolder_(root, 'Finance', false) || childFolder_(root, '02_Finance', true);
  var blob = UrlFetchApp.fetch(b.url).getBlob();
  var name = String(b.name || blob.getName() || 'piece.pdf').replace(/[\\/:*?"<>|]+/g, '-');
  var bytes = blob.getBytes(), hash = digest_(bytes), dup = null;
  // doublon : même contenu (dans 02_Finance ou à la racine du dossier de la date), ou même nom
  [folder, root].forEach(function (f) {
    var it = f.getFiles();
    while (!dup && it.hasNext()) {
      var x = it.next();
      if (x.isTrashed()) continue;
      if (x.getName() === name || (x.getSize() === bytes.length && digest_(x.getBlob().getBytes()) === hash)) dup = x;
    }
  });
  if (dup && !b.decision) return { ok: true, duplicate: { id: dup.getId(), name: dup.getName(), url: dup.getUrl(), same: digest_(dup.getBlob().getBytes()) === hash } };
  if (dup && b.decision === 'skip') return { ok: true, skipped: true, file_id: dup.getId(), url: dup.getUrl(), name: dup.getName() };
  if (dup && b.decision === 'replace') dup.setTrashed(true);
  if (dup && b.decision === 'keep_both') {
    var base = name.replace(/(\.\w{1,5})$/, ''), ext = (name.match(/\.\w{1,5}$/) || [''])[0], n = 1;
    while (folder.getFilesByName(name).hasNext()) name = base + ' (' + (++n) + ')' + ext;
  }
  var file = folder.createFile(blob.setName(name));
  return { ok: true, file_id: file.getId(), url: file.getUrl(), name: name, replaced: dup && b.decision === 'replace' ? dup.getName() : null };
}

function digest_(bytes) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes));
}

// ─────────────── Drive ───────────────

/** Chemin lisible du dossier (« Mon Drive/…/10-17 • Ville • Salle (33) ») pour le Finder */
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
      '&select=id,venue,date,city,department,drive_folder_id,project:projects(id,name,drive_artist_folder_id),structure:structures(postal_code,city)')[0];
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

/**
 * Département pour les noms : 2 premiers chiffres du code postal (79200 → 79 ; Corse 2A / 2B ; outre-mer 971…),
 * sinon le département de la date (pays à l'étranger : CH, BE…).
 */
function dept_(show) {
  // 1. le département de la date (lieu du concert) ; 2. à défaut le CP de la structure, seulement si elle est dans la même ville
  //    (le siège d'un producteur est souvent ailleurs : 3AG à Clermont, RPO à Grenoble…)
  var d = String(show.department || '').trim();
  if (d) return /^\d$/.test(d) ? '0' + d : (/^\d{5}$/.test(d) ? cpDept_(d) : d.toUpperCase());
  var st = show.structure || {};
  var same = st.city && show.city && rhNorm_(st.city) === rhNorm_(show.city);
  return same ? cpDept_(st.postal_code) : '';
}

function cpDept_(cp) {
  cp = String(cp || '').replace(/\s/g, '');
  if (!/^\d{5}$/.test(cp)) return '';
  if (/^9[78]/.test(cp)) return cp.slice(0, 3);
  if (/^20/.test(cp)) return Number(cp) < 20200 ? '2A' : '2B';
  return cp.slice(0, 2);
}

/** MM-DD • Ville • Salle (79) — nomenclature L'ArtBo du dossier d'une date. */
function folderName_(show) {
  var d = show.date.split('-'); // YYYY-MM-DD
  var venue = String(show.venue || '').replace(/\*\*/g, '').replace(/\s*•\s*[A-Z\/]{1,5}(\s*\([^)]*\))?\s*$/, '').trim();
  var dp = dept_(show);
  return d[1] + '-' + d[2] + ' • ' + (show.city || '').trim() + ' • ' + venue + (dp ? ' (' + dp + ')' : '');
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

/** Clé secrète Supabase : ancienne clé « service_role » (eyJ…) ou nouvelle clé secrète (sb_secret_…) */
function authHeaders_(extra) {
  var key = props_().SUPABASE_SERVICE_KEY, h = { apikey: key };
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;
  Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
  return h;
}

function sb_(method, path, payload) {
  var p = props_();
  var opts = {
    method: method,
    muteHttpExceptions: true,
    headers: authHeaders_({ Prefer: 'return=representation' }),
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
 * "MM-DD • …" (ou "MM_DD • …") à la date du même projet et du même jour.
 * Lancé depuis Réglages › Google › « Rattacher les dossiers Drive existants ».
 */
/**
 * Plusieurs dates le même jour pour un artiste (une confirmée + des pistes sans suite) : on prend la confirmée,
 * sinon la seule encore en cours ; les dates « Sans Suite » / « Annulée » ne récupèrent un dossier que si elles sont seules.
 * Si le choix reste ambigu, on ne rattache rien (mieux vaut rien que la mauvaise date).
 */
function pickShow_(list) {
  if (list.length <= 1) return list[0] || null;
  var rank = function (s) { var st = String(s.status || ''); return /^Confirm/.test(st) ? 0 : (st === 'Annulée' || st === 'Sans Suite') ? 2 : 1; };
  var best = Math.min.apply(null, list.map(rank));
  var top = list.filter(function (s) { return rank(s) === best; });
  return top.length === 1 && best < 2 ? top[0] : null;
}

function linkExistingFolders() {
  var p = props_();
  var projects = sb_('GET', 'projects?select=id,name,drive_artist_folder_id');
  var shows = sb_('GET', 'shows?select=id,project_id,date,status,drive_folder_id&date=not.is.null');
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
        var m = f.getName().match(/^(\d{2})[-_](\d{2})/);   // « 10-17 • … » (ou « 10_17 • … »)
        if (!m) continue;
        var date = y.getName() + '-' + m[1] + '-' + m[2];
        if (shows.some(function (s) { return s.drive_folder_id === f.getId(); })) continue;   // déjà rattaché
        var show = pickShow_(shows.filter(function (s) { return s.project_id === proj.id && s.date === date; }));
        if (show && !show.drive_folder_id) {
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

// ─────────────── Renommage des dossiers et contrats existants ───────────────

var SKIP_ARTIST_FOLDERS = ['pyrprod', 'fiches techniques', 'contrats a traiter', 'drive'];

/** Contrat : « Artiste • AAAA-MM-JJ • Ville (79) • Salle • CC » (CR pour une co-réalisation) */
function contractName_(show, artist) {
  var venue = String(show.venue || '').replace(/\*\*/g, '').replace(/\s*•\s*[A-Z\/]{1,5}(\s*\([^)]*\))?\s*$/, '').trim();
  var dp = dept_(show);
  return [artist, show.date, (show.city || '').trim() + (dp ? ' (' + dp + ')' : ''), venue, show.contract_type === 'Co-Réalisation' ? 'CR' : 'CC'].join(' • ');
}

/**
 * Parcourt <Artiste>/032_Production/<Année>/<dossiers de dates> et propose les bons noms dans un Google Sheet.
 * Rien n'est renommé : on coche ou décoche la colonne « Appliquer », puis on lance renameApply.
 */
function renameAudit() {
  var p = props_();
  var shows = sb_('GET', 'shows?select=id,project_id,date,status,venue,city,department,contract_type,drive_folder_id,structure:structures(postal_code,city)&date=not.is.null') || [];
  var projects = sb_('GET', 'projects?select=id,name,drive_artist_folder_id') || [];
  var rows = [['Appliquer', 'Type', 'Artiste', 'Dossier', 'Nom actuel', 'Nom proposé', 'ID']];
  var root = DriveApp.getFolderById(p.ARTISTS_ROOT_ID), artists = root.getFolders();
  while (artists.hasNext()) {
    var af = artists.next(), aname = af.getName();
    if (SKIP_ARTIST_FOLDERS.indexOf(rhNorm_(aname)) >= 0) continue;
    var proj = projects.filter(function (x) { return x.drive_artist_folder_id === af.getId() || rhNorm_(x.name.replace(/\s*•.*$/, '')) === rhNorm_(aname); })[0];
    var prod = childFolder_(af, p.PRODUCTION_FOLDER || '032_Production', false);
    if (!prod) continue;
    var years = prod.getFolders();
    while (years.hasNext()) {
      var y = years.next(); if (!/^\d{4}$/.test(y.getName())) continue;
      var dates = y.getFolders();
      while (dates.hasNext()) {
        var df = dates.next(), m = df.getName().match(/^(\d{2})[-_ .](\d{2})/);
        var show = shows.filter(function (s) { return s.drive_folder_id === df.getId(); })[0]
          || (m && proj ? pickShow_(shows.filter(function (s) { return s.project_id === proj.id && s.date === y.getName() + '-' + m[1] + '-' + m[2]; })) : null);
        if (!show) { rows.push([false, 'Dossier (date inconnue)', aname, y.getName(), df.getName(), '', df.getId()]); continue; }
        var want = folderName_(show);
        if (!sameName_(want, df.getName())) rows.push([true, 'Dossier de date', aname, y.getName(), df.getName(), want, df.getId()]);
        auditContracts_(df, show, proj ? proj.name.replace(/\s*•.*$/, '').trim() : aname, rows, aname, y.getName() + '/' + want);
      }
    }
  }
  var ss = SpreadsheetApp.create('Matrice • Renommages proposés ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd HH:mm'));
  var sh = ss.getSheets()[0];
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  if (rows.length > 1) sh.getRange(2, 1, rows.length - 1, 1).insertCheckboxes();
  sh.setFrozenRows(1); sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold'); sh.autoResizeColumns(2, 5);
  PropertiesService.getScriptProperties().setProperty('RENAME_SHEET_ID', ss.getId());
  // rangé directement dans « - Temp » (Réglages › Google › Dossier temporaire)
  try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(setting_('temp_folder_id') || '1icxpOARizOC3mr8pA3e3ICrE0TFEKyTz')); } catch (err) {}
  // visible aussi depuis le compte d'Anthony, et lien gardé dans Réglages › Google
  try { ss.addEditor('anthony@lartboristerie.com'); } catch (err) {}
  try { sb_('PATCH', 'settings?key=eq.rename_sheet_url', { value: ss.getUrl() }); } catch (err) {}
  return { ok: true, url: ss.getUrl(), count: rows.length - 1 };
}

/** Même nom à l'apostrophe, la casse, les espaces ou les accents près : on ne propose pas de renommer pour si peu */
function sameName_(a, b) {
  var n = function (x) { return rhNorm_(String(x).replace(/[’‘`´]/g, "'").replace(/\s*•\s*/g, ' • ')); };
  return n(a) === n(b);
}

function auditContracts_(folder, show, artist, rows, aname, where) {
  var stack = [folder], found = [];
  while (stack.length) {
    var f = stack.pop(), subs = f.getFolders();
    while (subs.hasNext()) stack.push(subs.next());
    var files = f.getFiles();
    while (files.hasNext()) {
      var file = files.next(), name = file.getName();
      // seulement les vrais contrats de cession / co-réalisation : pas les avenants, contrats techniques, fiches,
      // pré-contrats, contrats de location, ni les fichiers qui ne sont pas des documents (.numbers, images…)
      if (!/contrat/i.test(name) || /avenant|technique|fiche|engagement|rider|pr[ée][\s_-]?contrat|location/i.test(name)) continue;
      var ext = (name.match(/\.(pdf|docx?|odt)$/i) || ['', ''])[1];
      if (!ext) continue;
      // signé par l'organisateur → « • Signed » ; signé par les deux parties → « • Co-signed »
      var signed = /co[\s_-]?sign|contre[\s_-]?sign|cosign/i.test(name) ? ' • Co-signed' : /sign/i.test(name) ? ' • Signed' : '';
      var ver = (name.replace(/\.[^.]+$/, '').match(/[\s_-]v(\d+)\b/i) || [])[1];
      found.push({ file: file, name: name, ext: ext.toLowerCase(), signed: signed, ver: ver ? Number(ver) : 1, created: file.getDateCreated().getTime() });
    }
  }
  // Plusieurs versions non signées du même contrat : « • V1 », « • V2 »… pour ne pas avoir deux fichiers au même nom
  var base = contractName_(show, artist);
  var groups = {};
  found.forEach(function (c) { var k = c.signed + '|' + c.ext; (groups[k] = groups[k] || []).push(c); });
  Object.keys(groups).forEach(function (k) {
    var g = groups[k].sort(function (a, b) { return a.ver - b.ver || a.created - b.created; });
    g.forEach(function (c, i) {
      var want = base + c.signed + (g.length > 1 ? ' • V' + (i + 1) : '') + '.' + c.ext;
      if (!sameName_(want, c.name)) rows.push([true, 'Contrat', aname, where, c.name, want, c.file.getId()]);
    });
  });
}

/** Renomme les lignes cochées du dernier Google Sheet créé par renameAudit */
function renameApply() {
  var id = PropertiesService.getScriptProperties().getProperty('RENAME_SHEET_ID');
  if (!id) throw new Error('Lance d’abord la vérification des noms');
  var sh = SpreadsheetApp.openById(id).getSheets()[0], data = sh.getDataRange().getValues(), done = 0;
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (r[0] !== true || !r[5] || !r[6]) continue;
    try {
      (/^Dossier/.test(r[1]) ? DriveApp.getFolderById(r[6]) : DriveApp.getFileById(r[6])).setName(r[5]);
      sh.getRange(i + 1, 1).setValue(false); sh.getRange(i + 1, 2).setValue(r[1] + ' ✔ renommé'); done++;
    } catch (err) { sh.getRange(i + 1, 2).setValue(r[1] + ' ✖ ' + err); }
  }
  return { ok: true, renamed: done };
}
