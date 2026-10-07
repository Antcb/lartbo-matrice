/**
 * L'ArtBoristerie — création automatique des dossiers de production Drive.
 *
 * Appelé par Supabase quand une date passe en "Confirmée Salle" ou
 * "Confirmée Festival". Crée :
 *   <Artiste> / 032_Production / <Année> / MM-DD • Ville • Salle (Dept)
 * en copiant le modèle "MM-DD • City • Venue (Dept)" (L'ARTBO TEMPLATES),
 * puis enregistre l'ID du dossier sur la date dans Supabase.
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
      return json_({ ok: false, error: 'unauthorized' });
    }
    out = createShowFolder_(body.show_id, !!body.force);
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json_(out);
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
      '&select=id,venue,date,city,department,drive_folder_id,project:projects(id,name,drive_artist_folder_id)')[0];
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

/** MM-DD • Ville • Salle (Dept) — nomenclature du modèle L'ArtBo. */
function folderName_(show) {
  var d = show.date.split('-'); // YYYY-MM-DD
  var venue = String(show.venue || '').replace(/\*\*/g, '').trim();
  var dept = show.department ? ' (' + show.department + ')' : '';
  return d[1] + '-' + d[2] + ' • ' + (show.city || '').trim() + ' • ' + venue + dept;
}

function artistFolder_(project, p) {
  if (project.drive_artist_folder_id) {
    try { return DriveApp.getFolderById(project.drive_artist_folder_id); } catch (ignore) {}
  }
  var root = DriveApp.getFolderById(p.ARTISTS_ROOT_ID);
  var folder = childFolder_(root, project.name, false);
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
