// Script Google « Agendas » (apps-script/calendrier/Calendrier.gs) exécuté avec un FAUX service Agenda : aucune connexion à Google.
// Vérifie : lecture seule (aucun appel d'écriture, manifeste calendar.readonly), récurrences / exceptions / annulations, privé,
// « disponibilités seulement » (lecture par tranches < 90 jours, périodes recollées), perte d'accès (erreur, jamais « libre »).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../apps-script/calendrier/', import.meta.url);
const code = readFileSync(new URL('Calendrier.gs', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('appsscript.json', root), 'utf8'));

/** Faux Google : calendriers { id: { role, tz, events?: [...], busy?: [...], eventsError?, fbError? } } ; journal des appels */
function google(cals) {
  const calls = [];
  const err = (code, msg) => Object.assign(new Error(msg || `API call failed with error: ${code}`), { details: { code } });
  const Calendar = {
    CalendarList: {
      list: () => { calls.push(['CalendarList.list']); return { items: Object.entries(cals).map(([id, c]) => ({ id, summary: c.name || id, accessRole: c.role, timeZone: c.tz, primary: !!c.primary })) }; },
      get: id => { calls.push(['CalendarList.get', id]); const c = cals[id]; if (!c || c.removed) throw err(404, 'Not Found'); return { id, accessRole: c.role, timeZone: c.tz }; },
    },
    Events: {
      list: (id, o) => { calls.push(['Events.list', id, o]); const c = cals[id];
        if (!c || c.eventsError) throw (c && c.eventsError) || err(404, 'Not Found');
        if (c.role === 'freeBusyReader') throw err(403, 'Forbidden');
        const items = c.events || [], page = o.pageToken ? Number(o.pageToken) : 0, size = c.pageSize || items.length || 1;
        const next = page + size < items.length ? String(page + size) : undefined;
        return { timeZone: c.tz, items: items.slice(page, page + size), nextPageToken: next }; },
    },
    Freebusy: {
      query: req => { calls.push(['Freebusy.query', req.timeMin, req.timeMax]);
        const days = (Date.parse(req.timeMax) - Date.parse(req.timeMin)) / 86400000;
        if (days > 90) throw err(400, 'timeRangeTooLong');   // limite réelle de Google
        const id = req.items[0].id, c = cals[id];
        if (!c || c.fbError) return { calendars: { [id]: { errors: [{ reason: 'notFound' }] } } };
        const a = Date.parse(req.timeMin), z = Date.parse(req.timeMax);
        // comme Google : périodes coupées aux bornes de la requête
        const busy = (c.busy || []).filter(b => Date.parse(b.end) > a && Date.parse(b.start) < z)
          .map(b => ({ start: new Date(Math.max(a, Date.parse(b.start))).toISOString(), end: new Date(Math.min(z, Date.parse(b.end))).toISOString() }));
        return { calendars: { [id]: { busy } } }; },
    },
  };
  // toute autre fonction (insert, update, patch, delete, move, quickAdd, import…) : interdite — le test échoue si elle est appelée
  for (const k of Object.keys(Calendar)) Calendar[k] = new Proxy(Calendar[k], { get: (o, p) => p in o ? o[p] : () => { throw new Error(`écriture interdite : Calendar.${k}.${String(p)}`); } });
  const ctx = { Calendar, PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'WEBHOOK_SECRET' ? 'code-essai' : null }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }) }, Date, JSON, Math, String, Error };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const call = body => ctx.doPost({ postData: { contents: JSON.stringify({ secret: 'code-essai', ...body }) } });
  return { call, calls };
}
const TMIN = '2027-01-01T00:00:00.000Z', TMAX = '2028-07-02T00:00:00.000Z';   // même ampleur que cal-sync (30 j + 548 j)
const cas = []; const t = (nom, f) => cas.push([nom, f]);

t('lecture seule : manifeste calendar.readonly uniquement ; aucune fonction d’écriture de l’API Agenda dans le code', () => {
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/calendar.readonly']);
  assert.doesNotMatch(code, /Calendar\.\w+\.(insert|update|patch|remove|delete|move|quickAdd|import|clear|watch)\s*\(/);
  assert.doesNotMatch(code, /CalendarApp\./);   // le service simple pourrait écrire : jamais utilisé
});
t('code secret faux ou absent : refusé, aucun appel à Google', () => {
  const g = google({ a: { role: 'reader', tz: 'Europe/Paris' } });
  const r = g.call({ secret: 'faux', action: 'calendars' });
  assert.equal(r.ok, false); assert.equal(g.calls.length, 0);
});
t('ping et liste des agendas : version du script, niveau d’accès, agenda principal signalé', () => {
  const g = google({ 'moi@x': { role: 'owner', tz: 'Europe/Paris', primary: true }, a: { role: 'reader', tz: 'Europe/Paris', name: 'Artiste A' }, b: { role: 'freeBusyReader', tz: 'Europe/Paris' } });
  assert.match(g.call({ action: 'ping' }).version, /^v\d+\.\d+/);
  const r = g.call({ action: 'calendars' });
  assert.deepEqual(r.calendars.map(c => [c.id, c.access, c.primary]), [['moi@x', 'owner', true], ['a', 'reader', false], ['b', 'freeBusyReader', false]]);
  assert.equal(g.call({ action: 'inconnue' }).ok, false);
});
t('détails : récurrence développée (une occurrence par ligne), exception, occurrence annulée retirée, privé signalé, pages suivies', () => {
  const ev = (id, o) => ({ id, status: 'confirmed', summary: 'Cours', start: { dateTime: '2027-03-01T18:00:00+01:00', timeZone: 'Europe/Paris' }, end: { dateTime: '2027-03-01T19:00:00+01:00' }, ...o });
  const g = google({ a: { role: 'reader', tz: 'Europe/Paris', pageSize: 2, events: [
    ev('r_1', { recurringEventId: 'r' }), ev('r_2', { recurringEventId: 'r', summary: 'Cours (exception)', start: { dateTime: '2027-03-08T21:00:00+01:00' }, end: { dateTime: '2027-03-08T22:00:00+01:00' } }),
    ev('r_3', { recurringEventId: 'r', status: 'cancelled' }),
    ev('p', { visibility: 'private', summary: 'Rendez-vous perso' }), ev('d', { transparency: 'transparent', summary: 'Disponible' }),
    { id: 'j', status: 'confirmed', summary: 'Vacances', start: { date: '2027-03-10' }, end: { date: '2027-03-13' } }] } });
  const r = g.call({ action: 'events', calendar_id: 'a', time_min: TMIN, time_max: TMAX });
  assert.equal(r.ok, true); assert.equal(r.mode, 'details');
  assert.deepEqual(r.events.map(e => e.id), ['r_1', 'r_2', 'p', 'd', 'j']);
  assert.equal(r.events[1].title, 'Cours (exception)'); assert.equal(r.events[1].recurring_id, 'r');
  assert.equal(r.events[2].visibility, 'private'); assert.equal(r.events[3].transparency, 'transparent');
  assert.deepEqual([r.events[4].start_date, r.events[4].end_date, r.events[4].start], ['2027-03-10', '2027-03-13', null]);
  const lists = g.calls.filter(c => c[0] === 'Events.list');
  assert.equal(lists.length, 3); assert.equal(lists[0][2].singleEvents, true);   // récurrences développées par Google ; pages suivies
});
t('« disponibilités seulement » : tranches < 90 jours, périodes recollées (identifiants stables), ni titre ni lieu, fuseau de l’agenda', () => {
  const g = google({ b: { role: 'freeBusyReader', tz: 'America/New_York', busy: [
    { start: '2027-03-01T17:00:00Z', end: '2027-03-01T19:00:00Z' }, { start: '2027-03-02T05:00:00Z', end: '2027-03-02T05:00:00Z' },
    { start: '2027-02-28T22:00:00Z', end: '2027-03-03T02:00:00Z' } ] } });   // période à cheval sur la limite de tranche du 02/03
  const r = g.call({ action: 'events', calendar_id: 'b', time_min: TMIN, time_max: TMAX });
  assert.equal(r.ok, true); assert.equal(r.mode, 'disponibilites');
  const q = g.calls.filter(c => c[0] === 'Freebusy.query');
  assert.ok(q.length >= 9); assert.ok(q.every(c => (Date.parse(c[2]) - Date.parse(c[1])) / 86400000 <= 60));
  assert.equal(q[0][1], TMIN); assert.equal(q.at(-1)[2], TMAX);
  assert.deepEqual(r.events.map(e => [e.start, e.end]), [['2027-02-28T22:00:00.000Z', '2027-03-03T02:00:00.000Z']]);   // une seule période
  assert.equal(r.events[0].id, 'occupe-2027-02-28T22:00:00.000Z-2027-03-03T02:00:00.000Z');
  assert.equal(r.events[0].title, null); assert.equal(r.events[0].location, null); assert.equal(r.events[0].time_zone, 'America/New_York');
  assert.equal(g.calls.filter(c => c[0] === 'Events.list').length, 0);   // détails jamais demandés
  // relu le lendemain (fenêtre décalée) : même identifiant
  const r2 = g.call({ action: 'events', calendar_id: 'b', time_min: '2027-01-02T00:00:00.000Z', time_max: '2028-07-03T00:00:00.000Z' });
  assert.equal(r2.events[0].id, r.events[0].id);
});
t('perte d’accès (partage retiré) : erreur explicite, jamais une liste vide présentée comme « libre »', () => {
  const g = google({ a: { role: 'reader', tz: 'Europe/Paris', removed: true, eventsError: Object.assign(new Error('Not Found'), { details: { code: 404 } }), fbError: true } });
  const r = g.call({ action: 'events', calendar_id: 'a', time_min: TMIN, time_max: TMAX });
  assert.equal(r.ok, false); assert.match(r.error, /Agenda inaccessible \(partage retiré \?\)/);
});
t('panne passagère (quota, 500) : erreur remontée telle quelle, aucune bascule en « disponibilités »', () => {
  const g = google({ a: { role: 'reader', tz: 'Europe/Paris', eventsError: Object.assign(new Error('Rate Limit Exceeded'), { details: { code: 429 } }) } });
  const r = g.call({ action: 'events', calendar_id: 'a', time_min: TMIN, time_max: TMAX });
  assert.equal(r.ok, false); assert.match(r.error, /Rate Limit/);
  assert.equal(g.calls.filter(c => c[0] === 'Freebusy.query').length, 0);
});
t('partage réduit à « disponibilités » sans que la liste le dise (403 sur les détails) : périodes occupées', () => {
  const g = google({ a: { role: 'reader', tz: 'Europe/Paris', eventsError: Object.assign(new Error('Forbidden'), { details: { code: 403 } }), busy: [{ start: '2027-05-01T10:00:00Z', end: '2027-05-01T12:00:00Z' }] } });
  const r = g.call({ action: 'events', calendar_id: 'a', time_min: TMIN, time_max: TMAX });
  assert.equal(r.ok, true); assert.equal(r.mode, 'disponibilites'); assert.equal(r.events.length, 1); assert.equal(r.events[0].title, null);
});

let ok = 0;
for (const [nom, f] of cas) { try { await f(); ok++; } catch (e) { console.error('✗', nom, '\n', e.message); process.exitCode = 1; } }
console.log(`Script Google des agendas (faux service Agenda) : ${ok}/${cas.length} réussies.`);
