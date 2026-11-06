// Règles des agendas des artistes sur de FAUSSES données : aucun appel au service de lieux ni à Google.
import assert from 'node:assert/strict';
import { chooseCity, isShowTitle } from '../../supabase/functions/cal-sync/regles.ts';

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

let ok = 0;
for (const [nom, f] of cas) { try { await f(); ok++; } catch (e) { console.error('✗', nom, '\n', e.message); process.exitCode = 1; } }
console.log(`Règles des agendas (fausses données) : ${ok}/${cas.length} réussies.`);
