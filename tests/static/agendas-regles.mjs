// Règles des agendas des artistes sur de FAUSSES données : aucun appel au service de lieux ni à Google.
import assert from 'node:assert/strict';
import { chooseCity, isShowTitle, planSync } from '../../supabase/functions/cal-sync/regles.ts';

const F = (name, cc, lng, lat, postcode) => ({ properties: { name, countrycode: cc, postcode }, geometry: { coordinates: [lng, lat] } });
const DB = {
  paris: [F('Paris', 'FR', 2.35, 48.86, '75001;75020'), F('Paris', 'US', -95.55, 33.66, '75460')],
  lille: [F('Lille', 'FR', 3.06, 50.63, '59000'), F('Lille', 'BE', 4.82, 51.24, '2275')],
  lyon: [F('Lyon', 'FR', 4.83, 45.76, '69001;69009')],
  'saint denis': [F('Saint-Denis', 'FR', 2.36, 48.94, '93200'), F('Saint-Denis', 'FR', 55.45, -20.88, '97400')],
  paul: [F('Paul', 'PT', -7.85, 40.2, null)],
};
const n = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const photon = async q => DB[n(q)] || [];
const cas = []; const t = (nom, f) => cas.push([nom, f]);

t('« show » : mot entier, casse, crochets, ponctuation ; jamais Showroom / Slideshow', () => {
  for (const x of ['SHOW Lyon', '[Show] Transbordeur', 'show, Lille', 'Concert / show.', 'Le show!', 'show']) assert.equal(isShowTitle(x), true, x);
  for (const x of ['Showroom Paris', 'Slideshow', 'Showcase label', 'shower', '', null]) assert.equal(isShowTitle(x), false, String(x));
});
t('pays absent : France par défaut (« Paris » seul est utilisable) ; pays écrit prioritaire', async () => {
  assert.equal((await chooseCity('Bataclan, Paris', 'FR', photon))?.country, 'FR');
  assert.equal((await chooseCity('Paris', 'FR', photon))?.city, 'Paris');
  assert.equal((await chooseCity('Bar, Lille, Belgique', 'FR', photon))?.country, 'BE');
  assert.equal(await chooseCity('Bataclan, Paris', null, photon), null);   // aucun pays (réglage vidé) : homonymes → à préciser
  assert.equal((await chooseCity('Bataclan, Paris', 'US', photon))?.country, 'US');   // pays par défaut réglé autrement
});
t('code postal, adresse, salle : utilisés ; incohérent ou ambigu → à préciser', async () => {
  assert.equal((await chooseCity('Le Transbordeur, 3 bd de Stalingrad, 69100 Lyon', 'FR', photon))?.city, 'Lyon');
  assert.equal((await chooseCity('Stade, 93200 Saint-Denis', 'FR', photon))?.lng, 2.36);   // le code postal tranche entre homonymes
  assert.equal(await chooseCity('Stade, Saint-Denis', 'FR', photon), null);                 // sans code postal : homonymes éloignés
  assert.equal((await chooseCity('Salle Paris, Lille', 'FR', photon))?.city, 'Lille');      // « Salle Paris » n'est pas une ville : Lille
  assert.equal(await chooseCity('Paris, Lille', 'FR', photon), null);                       // deux villes différentes : incohérent
  assert.equal(await chooseCity('Lyon 75011', 'FR', photon), null);                         // code postal d'un autre département
  assert.equal(await chooseCity('chez Paul', 'FR', photon), null);
  assert.equal(await chooseCity('', 'FR', photon), null);
});

// ── Synchronisation sur plusieurs passages (fausse table, mêmes opérations que cal-sync/index.ts : masquage, upsert, suppressions) ──
const CAL = { id: 'cal-1', project_id: 'art-1', default_country: 'FR' };
const TMIN = '2027-01-01T00:00:00.000Z', TMAX = '2028-07-01T00:00:00.000Z';
const villes = async (loc, cc) => chooseCity(loc, cc, photon);
async function passage(table, reponse, cal = CAL, tmin = TMIN, tmax = TMAX) {
  const old = [...table.values()].map(r => ({ ...r }));
  const plan = await planSync(reponse, cal, old, tmin, tmax, villes, '2027-01-01T00:00:00Z');
  if (plan.scrub) for (const r of table.values()) if (!r.private) Object.assign(r, { title: null, location: null, city: null, lat: null, lng: null, is_show: false, geo_status: 'sans_lieu', geo_key: null, private: true });
  for (const r of plan.rows) table.set(r.gcal_event_id, { ...(table.get(r.gcal_event_id) || {}), ...r });   // upsert (calendar_ref, gcal_event_id)
  for (const id of plan.gone) if (!table.get(id).deleted_at) table.get(id).deleted_at = 'supprimé';
  return plan;
}
const vivants = table => [...table.values()].filter(r => !r.deleted_at);
const G = (id, o = {}) => ({ id, title: 'Répétition', start: '2027-03-01T18:00:00+01:00', end: '2027-03-01T20:00:00+01:00', time_zone: 'Europe/Paris', transparency: 'opaque', visibility: 'default', ...o });

t('créations, modifications, suppressions : une ligne par événement, jamais de doublon, suppression marquée (jamais effacée)', async () => {
  const T = new Map();
  await passage(T, { mode: 'details', events: [G('a'), G('b', { title: 'Studio' })] });
  assert.equal(vivants(T).length, 2);
  await passage(T, { mode: 'details', events: [G('a', { title: 'Répétition déplacée', start: '2027-03-02T18:00:00+01:00', end: '2027-03-02T20:00:00+01:00' }), G('b', { title: 'Studio' })] });
  assert.equal(T.size, 2); assert.equal(T.get('a').title, 'Répétition déplacée'); assert.equal(T.get('a').start_at, '2027-03-02T18:00:00+01:00');
  await passage(T, { mode: 'details', events: [G('a', { title: 'Répétition déplacée', start: '2027-03-02T18:00:00+01:00', end: '2027-03-02T20:00:00+01:00' })] });
  assert.equal(T.size, 2); assert.equal(T.get('b').deleted_at, 'supprimé'); assert.equal(vivants(T).length, 1);
  // même occurrence renvoyée deux fois (pages Google) : une seule ligne (sinon l'upsert échouerait en base)
  const p = await planSync({ mode: 'details', events: [G('x'), G('x', { title: 'Dernière version' })] }, CAL, [], TMIN, TMAX, villes, 'n');
  assert.equal(p.rows.length, 1); assert.equal(p.rows[0].title, 'Dernière version');
  // un événement supprimé puis recréé avec le même identifiant redevient visible
  await passage(T, { mode: 'details', events: [G('a'), G('b')] });
  assert.equal(T.get('b').deleted_at, null);
});

t('récurrence et exceptions : une ligne par occurrence, exception mise à jour, occurrence supprimée absente, aucun doublon', async () => {
  const T = new Map();
  const occ = d => G(`rec_2027030${d}T170000Z`, { recurring_id: 'rec', title: 'Cours', start: `2027-03-0${d}T18:00:00+01:00`, end: `2027-03-0${d}T19:00:00+01:00` });
  await passage(T, { mode: 'details', events: [occ(1), occ(2), occ(3), occ(4)] });
  assert.equal(vivants(T).length, 4); assert.ok(vivants(T).every(r => r.recurring_id === 'rec'));
  // exception : l'occurrence du 2 déplacée à 21 h et renommée (même identifiant d'occurrence chez Google) ; celle du 3 supprimée
  await passage(T, { mode: 'details', events: [occ(1), { ...occ(2), title: 'Cours (exception)', start: '2027-03-02T21:00:00+01:00', end: '2027-03-02T22:00:00+01:00' }, occ(4)] });
  assert.equal(T.size, 4); assert.equal(vivants(T).length, 3);
  assert.equal(T.get('rec_20270302T170000Z').title, 'Cours (exception)');
  assert.equal(T.get('rec_20270303T170000Z').deleted_at, 'supprimé');
  // passage identique : rien ne change, toujours aucun doublon
  await passage(T, { mode: 'details', events: [occ(1), { ...occ(2), title: 'Cours (exception)' }, occ(4)] });
  assert.equal(T.size, 4); assert.equal(vivants(T).length, 3);
});

t('fenêtre : une occurrence passée hors fenêtre est gardée telle quelle ; une occurrence à cheval sur le début de fenêtre est relue', async () => {
  const T = new Map([['vieux', { gcal_event_id: 'vieux', start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-01T11:00:00Z', deleted_at: null }],
    ['cheval', { gcal_event_id: 'cheval', start_at: '2026-12-31T20:00:00Z', end_at: '2027-01-01T02:00:00Z', deleted_at: null }],
    ['jour', { gcal_event_id: 'jour', start_date: '2026-12-30', end_date: '2026-12-31', deleted_at: null }]]);
  const p = await passage(T, { mode: 'details', events: [] });
  assert.deepEqual(p.gone, ['cheval']);
  assert.equal(T.get('vieux').deleted_at, null); assert.equal(T.get('jour').deleted_at, null);
});

t('privé / confidentiel : ni titre ni lieu enregistrés, jamais « Show » ; « Disponible » non bloquant', async () => {
  const p = await planSync({ mode: 'details', events: [G('p', { title: 'SHOW secret', location: 'Bataclan, Paris', visibility: 'private' }),
    G('c', { title: 'Médecin', location: '12 rue X', visibility: 'confidential' }), G('d', { title: 'Libre', transparency: 'transparent' })] }, CAL, [], TMIN, TMAX, villes, 'n');
  const [pr, co, di] = p.rows;
  for (const r of [pr, co]) { assert.equal(r.title, null); assert.equal(r.location, null); assert.equal(r.private, true); assert.equal(r.is_show, false); assert.equal(r.lat, null); assert.equal(r.busy, true); }
  assert.equal(di.busy, false); assert.equal(di.private, false);
});

t('« disponibilités seulement » : périodes occupées sans détail ; passage d’un partage complet à « disponibilités » : détails anciens effacés', async () => {
  const T = new Map();
  await passage(T, { mode: 'details', events: [G('a', { title: 'SHOW Lyon', location: 'Le Transbordeur, 69100 Lyon' })] });
  assert.equal(T.get('a').title, 'SHOW Lyon'); assert.equal(T.get('a').geo_status, 'ok');
  const p = await passage(T, { mode: 'disponibilites', events: [{ id: 'occupe-x', title: 'ne doit pas rester', location: 'idem', start: '2027-03-01T17:00:00Z', end: '2027-03-01T19:00:00Z', transparency: 'opaque', visibility: 'private' }] });
  assert.equal(p.mode, 'disponibilites');
  for (const r of T.values()) { assert.equal(r.title, null); assert.equal(r.location, null); assert.equal(r.lat, null); assert.equal(r.private, true); }
  assert.equal(T.get('a').deleted_at, 'supprimé'); assert.equal(vivants(T).length, 1);
});

t('journée entière : dates calendaires sans heure ni fuseau (fin exclue, règle Google) ; à l’heure : instants et fuseau de l’événement', async () => {
  const p = await planSync({ mode: 'details', events: [{ id: 'j', title: 'Vacances', start_date: '2027-03-10', end_date: '2027-03-13', time_zone: 'America/New_York' },
    G('ny', { start: '2027-06-10T20:00:00-04:00', end: '2027-06-10T23:00:00-04:00', time_zone: 'America/New_York' })] }, CAL, [], TMIN, TMAX, villes, 'n');
  assert.deepEqual([p.rows[0].all_day, p.rows[0].start_date, p.rows[0].end_date, p.rows[0].start_at, p.rows[0].time_zone], [true, '2027-03-10', '2027-03-13', null, null]);
  assert.deepEqual([p.rows[1].all_day, p.rows[1].start_at, p.rows[1].time_zone], [false, '2027-06-10T20:00:00-04:00', 'America/New_York']);
});

t('« Show » : repère seulement pour une ville sûre, pays par défaut de l’agenda (France), recalcul quand le pays change, rien d’inventé', async () => {
  const T = new Map(); let appels = 0; const compte = async (l, c) => { appels++; return villes(l, c); };
  const ev = [G('s1', { title: '[SHOW] Bataclan', location: 'Bataclan, Paris' }), G('s2', { title: 'Showroom', location: 'Paris' }), G('s3', { title: 'show', location: 'Stade, Saint-Denis' })];
  let p = await planSync({ mode: 'details', events: ev }, CAL, [], TMIN, TMAX, compte, 'n');
  for (const r of p.rows) T.set(r.gcal_event_id, r);
  assert.deepEqual(p.rows.map(r => [r.is_show, r.geo_status, r.city]), [[true, 'ok', 'Paris'], [false, 'a_preciser', null], [true, 'a_preciser', null]]);
  assert.equal(p.rows[0].lat, 48.86);
  const n = appels;
  p = await planSync({ mode: 'details', events: ev }, CAL, [...T.values()], TMIN, TMAX, compte, 'n');
  assert.equal(appels, n);   // lieu et pays inchangés : rien n'est redemandé au service de lieux ; Showroom jamais localisé
  p = await planSync({ mode: 'details', events: ev }, { ...CAL, default_country: 'US' }, [...T.values()], TMIN, TMAX, compte, 'n');
  assert.equal(p.rows[0].lat, 33.66);   // pays par défaut changé : recalculé (Paris, Texas)
});

let ok = 0;
for (const [nom, f] of cas) { try { await f(); ok++; } catch (e) { console.error('✗', nom, '\n', e.message); process.exitCode = 1; } }
console.log(`Règles des agendas (fausses données) : ${ok}/${cas.length} réussies.`);
