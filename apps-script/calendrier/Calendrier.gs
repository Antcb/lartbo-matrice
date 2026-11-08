/**
 * L'ArtBotrice — lecture des calendriers Google des artistes (compte production@). LECTURE SEULE.
 * Projet Apps Script DISTINCT du script principal, pour n'avoir que l'accès en lecture aux agendas (calendar.readonly) :
 * il ne peut ni créer, ni modifier, ni supprimer un événement. Les artistes partagent leur agenda avec production@.
 *
 * Installation (web, pas à pas, sur le compte production@) : nouveau projet Apps Script, coller ce fichier et appsscript.json,
 * Services › ajouter « Google Calendar API », Paramètres du projet › Propriétés du script : SECRET_AGENDAS = secret DÉDIÉ
 * de ce script (private.import_secrets « cal_script_secret », tiré au hasard par la migration v1.62 ; distinct du code du script principal), Déployer › Application Web (exécuter en tant que Moi, accès Tout le monde) → adresse …/exec dans Réglages.
 *
 * Appelé uniquement par la fonction serveur « cal-sync » (code partagé, jamais par le navigateur) :
 *   { action: 'calendars' }                               → agendas visibles par production@ (nom, identifiant, niveau d'accès)
 *   { action: 'events', calendar_id, time_min, time_max } → occurrences (récurrences développées), ou périodes occupées seules
 *                                                           si l'agenda n'est partagé qu'en « disponibilités »
 *   { action: 'ping' }                                    → { ok, version } (version du script : SCRIPT_VERSION)
 * Aucune fonction d'écriture de l'API Agenda n'est appelée (contrôlé par tests/static/agendas-script.mjs) ; le manifeste ne demande
 * que calendar.readonly : Google refuserait toute écriture.
 */
var SCRIPT_VERSION = 'v1.61.0';   // version de l'application qui a livré ce script (le lot « agendas » est nommé v1.62 dans les documents)
var FB_DAYS = 60;   // Google limite une requête « disponibilités » (freeBusy) à 90 jours : la fenêtre est lue par tranches de 60 jours
function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET_AGENDAS') || '';
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'Code secret du script des calendriers incorrect' });
    if (body.action === 'ping') out = { ok: true, version: SCRIPT_VERSION };
    else if (body.action === 'calendars') out = calendars_();
    else if (body.action === 'events') out = events_(String(body.calendar_id || ''), body.time_min, body.time_max);
    else out = { ok: false, error: 'Action inconnue : le script des agendas n’est pas à jour (Réglages › Google)' };
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
  return { ok: true, calendars: list, version: SCRIPT_VERSION };
}

/** Code d'erreur HTTP d'une erreur de l'API (403 / 404…) */
function code_(err) { return String(err && err.details && err.details.code || (/\b(403|404)\b/.exec(String(err && err.message)) || [])[1] || ''); }
/** Raison donnée par Google (forbidden, notFound, rateLimitExceeded…) */
function reason_(err) { var e = err && err.details && err.details.errors; return String(e && e[0] && e[0].reason || ''); }
/** Limite d'usage (Google répond 403 aussi pour ces cas) : panne passagère, JAMAIS un partage « disponibilités » */
function usageLimit_(err) {
  return /^(rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|usageLimits)$/.test(reason_(err))
    || String(err && err.details && err.details.errors && err.details.errors[0] && err.details.errors[0].domain || '') === 'usageLimits'
    || /rate limit|quota|usage limit|limit exceeded/i.test(String(err && err.message || ''));
}
/**
 * Refus d'accès aux DÉTAILS seulement (partage réduit à « disponibilités ») ? Oui si l'agenda est en freeBusyReader dans la liste, ou si
 * Google refuse avec la raison forbidden / notFound / requiredAccessLevel (ou un 404 sans raison). Limite d'usage, 403 sans raison,
 * toute autre erreur : NON — l'erreur remonte, rien n'est effacé, l'agenda passe en « disponibilités plus à jour ».
 */
function detailsRefused_(err, entry) {
  if (usageLimit_(err)) return false;
  if (entry && entry.accessRole === 'freeBusyReader') return true;
  var c = code_(err), r = reason_(err);
  if (c !== '403' && c !== '404') return false;
  if (r) return /^(forbidden|notFound|requiredAccessLevel)$/.test(r);
  return c === '404';
}

function events_(id, tmin, tmax) {
  if (!id) throw new Error('Agenda non précisé');
  // niveau d'accès donné par l'artiste : « disponibilités seulement » (freeBusyReader) → périodes occupées directement
  var entry = null;
  try { entry = Calendar.CalendarList.get(id); } catch (err) { entry = null; }   // retiré de la liste : on essaie quand même de le lire
  if (entry && entry.accessRole === 'freeBusyReader') return busy_(id, tmin, tmax, entry.timeZone || null);
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
    return { ok: true, mode: 'details', events: out, version: SCRIPT_VERSION };
  } catch (err) {
    // SEUL un refus d'accès aux détails bascule en périodes occupées (sans titre ni lieu) ; toute autre erreur (limite d'usage en 403
    // comprise, panne passagère) remonte : l'agenda passe en « disponibilités plus à jour », rien n'est réécrit ni effacé
    if (!detailsRefused_(err, entry)) throw err;
    return busy_(id, tmin, tmax, entry && entry.timeZone || null);
  }
}

/**
 * Périodes occupées seules (partage « disponibilités seulement ») : ni titre ni lieu. Lues par tranches de FB_DAYS jours (limite Google
 * de 90 jours par requête), puis RECOLLÉES (une période à cheval sur deux tranches = une seule), pour des identifiants stables
 * d'un passage à l'autre (aucun doublon). Agenda illisible (partage retiré) : erreur — jamais présenté comme libre.
 */
function busy_(id, tmin, tmax, tz) {
  var a = new Date(tmin).getTime(), z = new Date(tmax).getTime(), step = FB_DAYS * 86400000, blocks = [];
  for (var t = a; t < z; t += step) {
    var to = Math.min(t + step, z);
    var fb = Calendar.Freebusy.query({ timeMin: new Date(t).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: id }] });
    var cal = fb.calendars && fb.calendars[id];
    if (!cal || (cal.errors && cal.errors.length)) throw new Error('Agenda inaccessible (partage retiré ?) : ' + (cal && cal.errors ? cal.errors.map(function (x) { return x.reason; }).join(', ') : 'aucune réponse'));
    (cal.busy || []).forEach(function (b) { blocks.push({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }); });
  }
  blocks.sort(function (x, y) { return x.s - y.s; });
  var merged = [];
  blocks.forEach(function (b) { var l = merged[merged.length - 1]; if (l && b.s <= l.e) l.e = Math.max(l.e, b.e); else merged.push({ s: b.s, e: b.e }); });
  var out = merged.map(function (b) { var s = new Date(b.s).toISOString(), e = new Date(b.e).toISOString();
    return { id: 'occupe-' + s + '-' + e, title: null, location: null, start: s, end: e, time_zone: tz, transparency: 'opaque', visibility: 'private', type: 'busy' }; });
  return { ok: true, mode: 'disponibilites', events: out, version: SCRIPT_VERSION };
}
