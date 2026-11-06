/**
 * L'ArtBotrice — lecture des calendriers Google des artistes (compte production@). LECTURE SEULE.
 * Projet Apps Script DISTINCT du script principal, pour n'avoir que l'accès en lecture aux agendas (calendar.readonly) :
 * il ne peut ni créer, ni modifier, ni supprimer un événement. Les artistes partagent leur agenda avec production@.
 *
 * Installation (web, pas à pas, sur le compte production@) : nouveau projet Apps Script, coller ce fichier et appsscript.json,
 * Services › ajouter « Google Calendar API », Paramètres du projet › Propriétés du script : WEBHOOK_SECRET (même valeur que
 * Réglages › Google), Déployer › Application Web (exécuter en tant que Moi, accès Tout le monde) → adresse …/exec dans Réglages.
 *
 * Appelé uniquement par la fonction serveur « cal-sync » (code partagé, jamais par le navigateur) :
 *   { action: 'calendars' }                               → agendas visibles par production@ (nom, identifiant, niveau d'accès)
 *   { action: 'events', calendar_id, time_min, time_max } → occurrences (récurrences développées), ou périodes occupées seules
 *                                                           si l'agenda n'est partagé qu'en « disponibilités »
 */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'Code secret du script des calendriers incorrect' });
    if (body.action === 'ping') out = { ok: true, account: Session.getEffectiveUser().getEmail() };
    else if (body.action === 'calendars') out = calendars_();
    else if (body.action === 'events') out = events_(String(body.calendar_id || ''), body.time_min, body.time_max);
    else out = { ok: false, error: 'Action inconnue' };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err), code: err && err.details && err.details.code || null };
  }
  return json_(out);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function calendars_() {
  var list = [], token = null;
  do {
    var r = Calendar.CalendarList.list({ maxResults: 250, pageToken: token, showHidden: true });
    (r.items || []).forEach(function (c) { list.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, access: c.accessRole, time_zone: c.timeZone || null, primary: !!c.primary }); });
    token = r.nextPageToken;
  } while (token);
  return { ok: true, calendars: list };
}

function events_(id, tmin, tmax) {
  if (!id) throw new Error('Agenda non précisé');
  var out = [], token = null;
  try {
    do {
      var r = Calendar.Events.list(id, { singleEvents: true, showDeleted: false, timeMin: tmin, timeMax: tmax, maxResults: 2500, pageToken: token,
        fields: 'nextPageToken,timeZone,items(id,recurringEventId,status,summary,location,start,end,transparency,visibility,eventType,updated)' });
      (r.items || []).forEach(function (ev) {
        if (ev.status === 'cancelled') return;
        out.push({ id: ev.id, recurring_id: ev.recurringEventId || null, title: ev.summary || null, location: ev.location || null,
          start: ev.start.dateTime || null, end: ev.end.dateTime || null, start_date: ev.start.date || null, end_date: ev.end.date || null,
          time_zone: ev.start.timeZone || r.timeZone || null, transparency: ev.transparency || 'opaque', visibility: ev.visibility || 'default',
          type: ev.eventType || 'default', updated: ev.updated || null });
      });
      token = r.nextPageToken;
    } while (token);
    return { ok: true, mode: 'details', events: out };
  } catch (err) {
    // agenda partagé en « disponibilités seulement » : les détails sont refusés → périodes occupées, sans titre ni lieu
    var fb = Calendar.Freebusy.query({ timeMin: tmin, timeMax: tmax, items: [{ id: id }] });
    var cal = fb.calendars && fb.calendars[id];
    if (!cal || (cal.errors && cal.errors.length)) throw new Error('Agenda inaccessible (partage retiré ?) : ' + (cal && cal.errors ? cal.errors.map(function (x) { return x.reason; }).join(', ') : err.message));
    (cal.busy || []).forEach(function (b, i) { out.push({ id: 'occupe-' + b.start + '-' + b.end, title: null, location: null, start: b.start, end: b.end, transparency: 'opaque', visibility: 'private', type: 'busy' }); });
    return { ok: true, mode: 'disponibilites', events: out };
  }
}
