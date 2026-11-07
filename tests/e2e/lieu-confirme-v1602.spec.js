// v1.60.2 — décision d'Anthony du 07/11/2026 : lieu de représentation d'une date défini date par date (lieu choisi, adresse propre,
// ou case « Utiliser l'adresse de la structure comme lieu de représentation ») ; documents sans l'adresse de la structure sans la case ;
// carte : repères conservés (« localisation héritée — lieu à confirmer »), « localisation manquante » sans coordonnées.
// Données FICTIVES ; géocodage neutralisé (aucun service réel appelé).
import { test, expect } from '@playwright/test';
import { openApp, preparePage, expectClean } from './helpers.js';

const ST = { id: 'st-siege', name: 'Zz Organisateur', address: '1 avenue du Siège', postal_code: '75011', city: 'Paris', country: 'France',
  department_code: '75', tags: ['Association'], lat: 48.86, lng: 2.38 };
const EVT = { id: 'ev-siege', structure_id: 'st-siege', name: 'Zz Festival du Siège', city: 'Paris', place: null };
// événement avec son propre lieu (« Lieu (si différent) ») : repris quand il est sélectionné
const EVT2 = { id: 'ev-parc', structure_id: 'st-siege', name: 'Zz Festival au Parc', city: 'Vincennes', place: 'Parc floral, route de la Pyramide' };

async function seed(page) {
  await page.evaluate(async ({ ST, EVT, EVT2 }) => { const { S, touch } = await import('./js/state.js');
    for (const [t, r] of [['structures', ST], ['structure_events', EVT], ['structure_events', EVT2]]) { window.__DB[t].push(structuredClone(r)); (S.db[t] ||= []).push(structuredClone(r)); touch(t); } }, { ST, EVT, EVT2 });
}

test('documents : adresse de la date, sinon de la structure seulement si la case est cochée, sinon à compléter', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const { ficheDefaults, venueSource } = await import('./js/fiche-fields.js');
    const structure = { name: 'Org', address: '1 avenue du Siège', postal_code: '75011', city: 'Paris', admin: { address: '9 rue Admin', postal_code: '93310' } };
    const pick = d => { const x = ficheDefaults({ structure, city: 'Paris', cp: '75', ...d }); return [x.venue_address ?? null, x.venue_postal_code ?? null]; };
    return {
      propre: pick({ address: '12 rue du Lieu', postal_code: '69003', venue_is_structure: true }),
      cochee: pick({ address: null, postal_code: '', venue_is_structure: true }),
      nonCochee: pick({ address: null, postal_code: null, venue_is_structure: false }),
      ancienne: pick({}),   // date existante (colonne absente / faux) : rien de la structure
      sansStructure: venueSource({ venue_is_structure: true }, null),
    };
  });
  expect(r.propre).toEqual(['12 rue du Lieu', '69003']);
  expect(r.cochee).toEqual(['1 avenue du Siège', '75011']);
  expect(r.nonCochee).toEqual([null, null]);
  expect(r.ancienne).toEqual([null, null]);
  expect(r.sansStructure).toEqual({ address: null, postal_code: null, city: null, department: null, country: null, confirmed: false });
  expectClean(ctx);
});

test('fiche publique : adresse de la structure proposée seulement avec la case ; coordonnées de l’organisateur inchangées', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/fiche.html?t=jeton-fiche-lieu-00002');
  await expect(page.locator('#fiche-form')).toBeVisible();
  await expect(page.locator('#fiche-form [name="venue_address"]')).toHaveValue('');
  await expect(page.locator('#fiche-form [name="venue_postal_code"]')).toHaveValue('');
  await expect(page.locator('#fiche-form [name="venue_city"]')).toHaveValue('');   // ville : même source que l'adresse
  await expect(page.locator('#fiche-form [name="address"]')).toHaveValue('1 avenue du Siège');   // siège social (administratif) : gardé
  await page.goto('/fiche.html?t=jeton-fiche-lieu-00003');
  await expect(page.locator('#fiche-form [name="venue_address"]')).toHaveValue('1 avenue du Siège');
  await expect(page.locator('#fiche-form [name="venue_postal_code"]')).toHaveValue('75011');
  await expect(page.locator('#fiche-form [name="venue_city"]')).toHaveValue('Paris');
  expectClean(ctx);
});

test('carte : coordonnées propres, structure confirmée, localisation héritée « lieu à confirmer », localisation manquante', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  const r = await page.evaluate(async () => {
    const { showPlace, showPlaceNote } = await import('./js/selectors.js');
    const s = d => ({ structure_id: 'st-siege', city: 'Paris', lat: null, lng: null, ...d });
    const out = {};
    for (const [k, d] of Object.entries({
      propre: s({ lat: 45.76, lng: 4.83, address: '12 rue du Lieu' }),
      copiee: s({ lat: 48.86, lng: 2.38 }),                  // coordonnées copiées autrefois de la structure : conservées, à confirmer
      confirmee: s({ venue_is_structure: true }),
      heritee: s({}),
      autreVille: s({ city: 'Lyon' }),                       // régression 8198aac : la date restait hors de la carte
      manquante: { structure_id: null, city: 'Nulle-Part', lat: null, lng: null },
    })) { const p = showPlace(d); out[k] = [p.coords, p.state, showPlaceNote(d)]; }
    return out;
  });
  expect(r.propre).toEqual([[45.76, 4.83], 'own', '']);
  expect(r.copiee).toEqual([[48.86, 2.38], 'inherited', 'Localisation héritée de la structure — lieu à confirmer']);
  expect(r.confirmee).toEqual([[48.86, 2.38], 'confirmed', '']);
  expect(r.heritee).toEqual([[48.86, 2.38], 'inherited', 'Localisation héritée de la structure — lieu à confirmer']);
  expect(r.autreVille).toEqual([[48.86, 2.38], 'inherited', 'Localisation héritée de la structure — lieu à confirmer']);
  expect(r.manquante).toEqual([null, 'missing', 'Localisation manquante']);
  // liste Booking : la date sans localisation reste listée, signalée
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.view = 'booking'; S.projects = []; S.project = null;
    S.year = Number(window.__DB.shows.find(x => x.id === 'sh-3').date.slice(0, 4)); (await import('./js/app.js')).render(); });
  await expect(page.locator('.gig[data-id="sh-3"]')).toContainText('localisation manquante');
  await expect(page.locator('.gig[data-id="sh-2"]')).not.toContainText('localisation manquante');
  // repère hérité (sh-2 : sans coordonnées, structure st-1) : sur la carte, avec la mention
  const pt = await page.evaluate(async () => (await import('./js/state.js')).S.mapData.points.find(p => p.showId === 'sh-2'));
  expect([pt.lat, pt.lng]).toEqual([48.85, 2.35]);
  expect(pt.label).toContain('lieu à confirmer');
  expectClean(ctx);
});

test('fenêtre d’une date : rien de la structure (adresse, CP, coordonnées) sans la case ; case cochée → structure confirmée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  // nouvelle date posée depuis la structure : organisateur, nom et ville seulement
  await page.evaluate(async () => { const { editShow, showPrefillFromStructure } = await import('./js/forms.js'); const { byId } = await import('./js/selectors.js');
    editShow(null, 'art-a', showPrefillFromStructure(byId('structures', 'st-siege'))); });   // = action newShowFor, artiste choisi
  await page.waitForTimeout(200);
  await expect(page.locator('#modal .ac:has([name=address]) .ac-input')).toHaveValue('');
  await expect(page.locator('#modal [name=postal_code]')).toHaveValue('');
  await expect(page.locator('#modal .ac:has([name=city]) .ac-input')).toHaveValue('');   // ville : même source que l'adresse (07/11)
  await expect(page.locator('#modal [name=department]')).toHaveValue('');
  await expect(page.locator('#modal [name=venue_is_structure]')).not.toBeChecked();
  await expect(page.locator('#modal [data-place-note]')).toContainText('restent à compléter');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.structure_id === 'st-siege') || null)).not.toBeNull();
  const a = await page.evaluate(() => window.__DB.shows.find(s => s.structure_id === 'st-siege'));
  expect([a.address ?? null, a.postal_code ?? null, a.city ?? null, a.department ?? null, a.lat ?? null, a.lng ?? null, !!a.venue_is_structure]).toEqual([null, null, null, null, null, null, false]);
  // réouverte : « localisation héritée — lieu à confirmer » dans la fiche de la date ; la case cochée → enregistrée, structure confirmée
  await page.evaluate(async id => { (await import('./js/forms.js')).editShow(id); }, a.id);
  await page.waitForTimeout(200);
  await expect(page.locator('#modal [data-place-note]')).toContainText('lieu à confirmer');
  await page.locator('#modal [name=venue_is_structure]').check();
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(id => window.__DB.shows.find(s => s.id === id).venue_is_structure, a.id)).toBe(true);
  const st = await page.evaluate(async id => { const { showPlace, byId } = await import('./js/selectors.js'); const { ficheDefaults } = await import('./js/fiche-fields.js');
    const s = byId('shows', id), d = ficheDefaults({ ...s, structure: byId('structures', s.structure_id) }); return [showPlace(s).state, d.venue_address, d.venue_postal_code]; }, a.id);
  expect(st).toEqual(['confirmed', '1 avenue du Siège', '75011']);
  expectClean(ctx);
});

test('événement de la structure : son propre lieu repris, jamais l’adresse ni les coordonnées de l’organisateur', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  const ev = await page.evaluate(async () => { const { byId, placeOfEvent } = await import('./js/selectors.js');
    return [placeOfEvent(byId('structure_events', 'ev-siege')), placeOfEvent(byId('structure_events', 'ev-parc'))]; });
  expect(ev[0]).toEqual({ venue: 'Zz Festival du Siège', address: null, postal_code: null, city: 'Paris', department: '75', lat: null, lng: null });
  expect(ev[1]).toEqual({ venue: 'Zz Festival au Parc', address: 'Parc floral, route de la Pyramide', postal_code: null, city: 'Vincennes', department: null, lat: null, lng: null });
  // sélectionné dans la liste « Lieu » d'une date : son lieu propre remplit la date
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow(null, 'art-a'); });
  await page.waitForTimeout(200);
  await page.locator('#modal .ac[data-ac=lieux] .ac-input').fill('Zz Festival au');
  await page.locator('.ac-item', { hasText: 'Zz Festival au Parc' }).first().dispatchEvent('mousedown');
  await expect(page.locator('#modal .ac:has([name=address]) .ac-input')).toHaveValue('Parc floral, route de la Pyramide');
  await expect(page.locator('#modal .ac:has([name=city]) .ac-input')).toHaveValue('Vincennes');
  await expect(page.locator('#modal [name=venue_is_structure]')).not.toBeChecked();
  expectClean(ctx);
});

test('source du lieu : ville, département, code postal ; valeurs historiques de la date ; CP et département jamais l’un pour l’autre', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  const r = await page.evaluate(async () => {
    const { venueSource } = await import('./js/fiche-fields.js'); const { byId } = await import('./js/selectors.js'); const { contractVars } = await import('./js/contract.js');
    const st = byId('structures', 'st-siege');
    const v = d => { const x = venueSource(d, st); return [x.address, x.postal_code, x.city, x.department, x.country]; };
    const base = { structure_id: 'st-siege', project_id: 'art-a', venue: 'Zz Salle', date: '2027-03-01', contract_type: 'Cession' };
    return {
      nonConfirmee: v({}),
      confirmee: v({ venue_is_structure: true }),
      historique: v({ city: 'Ajaccio', department: '2A' }),                       // valeurs propres conservées, rien de l'organisateur
      cpPropre: v({ city: 'Lyon', postal_code: '69003' }),                        // département tiré du CP de la date
      mixte: v({ city: 'Montreuil', department: '93', venue_is_structure: true }), // la date prime, la structure complète
      etranger: v({ city: 'Genève', department: 'CH' }),
      // nom du fichier de contrat : département de la même source
      fichierNonConfirme: contractVars({ ...base, id: 'x1', city: 'Lyon' }).name,
      fichierConfirme: contractVars({ ...base, id: 'x2', city: null, venue_is_structure: true }).name,
    };
  });
  expect(r.nonConfirmee).toEqual([null, null, null, null, null]);
  expect(r.confirmee).toEqual(['1 avenue du Siège', '75011', 'Paris', '75', 'France']);
  expect(r.historique).toEqual([null, null, 'Ajaccio', '2A', 'France']);
  expect(r.cpPropre).toEqual([null, '69003', 'Lyon', '69', 'France']);
  expect(r.mixte).toEqual(['1 avenue du Siège', '75011', 'Montreuil', '93', 'France']);
  expect(r.etranger).toEqual([null, null, 'Genève', 'CH', null]);
  expect(r.fichierNonConfirme).not.toMatch(/\(75\)/);
  expect(r.fichierNonConfirme).toContain('Lyon •');
  expect(r.fichierConfirme).toContain('Paris (75)');
  expectClean(ctx);
});

test('choisir la structure elle-même comme lieu vaut confirmation (case cochée, enregistrée)', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await page.evaluate(async () => { const { editShow, showPrefillFromStructure } = await import('./js/forms.js'); const { byId } = await import('./js/selectors.js');
    editShow(null, 'art-a', showPrefillFromStructure(byId('structures', 'st-siege'))); });
  await page.waitForTimeout(200);
  await page.locator('#modal .ac[data-ac=lieux] .ac-input').fill('Zz Organisateur');
  await page.locator('.ac-item', { hasText: 'Zz Organisateur' }).first().dispatchEvent('mousedown');
  await expect(page.locator('#modal [name=venue_is_structure]')).toBeChecked();
  await expect(page.locator('#modal .ac:has([name=address]) .ac-input')).toHaveValue('1 avenue du Siège');
  // un autre lieu choisi ensuite : la case cochée automatiquement est retirée
  await page.locator('#modal .ac[data-ac=lieux] .ac-input').fill('Zz Festival au');
  await page.locator('.ac-item', { hasText: 'Zz Festival au Parc' }).first().dispatchEvent('mousedown');
  await expect(page.locator('#modal [name=venue_is_structure]')).not.toBeChecked();
  await page.locator('#modal .ac[data-ac=lieux] .ac-input').fill('Zz Organisateur');
  await page.locator('.ac-item', { hasText: 'Zz Organisateur' }).first().dispatchEvent('mousedown');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.structure_id === 'st-siege')?.venue_is_structure ?? null)).toBe(true);
  const s = await page.evaluate(async () => { const { showPlace, byId } = await import('./js/selectors.js'); const x = window.__DB.shows.find(s => s.structure_id === 'st-siege');
    return [x.address, x.postal_code, x.city, x.department, showPlace(byId('shows', x.id)).state]; });
  expect(s).toEqual(['1 avenue du Siège', '75011', 'Paris', '75', 'own']);
  expectClean(ctx);
});

// relecture v1.60.2 (847c131) : enregistrer une ancienne date sans rien changer ne la déplace pas et n'écrit aucune coordonnée
test('v1.60.2 relecture : ancienne date d’une autre ville enregistrée sans changement → repère hérité conservé, rien n’est écrit', async ({ page }) => {
  const ST = { id: 'st-siege-rel', name: 'Zz Organisateur', address: '1 avenue du Siège', postal_code: '75011', city: 'Paris', country: 'France', department_code: '75', tags: [], lat: 48.86, lng: 2.38 };
  const SH = { id: 'sh-old-rel', project_id: null, structure_id: 'st-siege-rel', venue: 'Zz Ancienne date', city: 'Lyon', department: '69', date: '2027-05-01', status: 'Option Salle', contract_type: 'Cession', lat: null, lng: null, fee_ht: 1000 };
  await openApp(page);
  let geocode = 0;
  await page.route(/data\.geopf\.fr/, r => { geocode++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ features: [{ geometry: { coordinates: [4.83, 45.76] }, properties: { score: 0.9, city: 'Lyon', postcode: '69001', citycode: '69381', context: '69, Rhône', label: 'Lyon', type: 'municipality' } }] }) }); });
  const avant = await page.evaluate(async ({ ST, SH }) => { const { S, touch } = await import('./js/state.js');
    SH.project_id = S.db.projects[0].id;
    for (const [t, r] of [['structures', ST], ['shows', SH]]) { window.__DB[t].push(structuredClone(r)); S.db[t].push(structuredClone(r)); touch(t); }
    const { showPlace } = await import('./js/selectors.js'); return showPlace(S.db.shows.find(s => s.id === 'sh-old-rel')); }, { ST, SH });
  expect(avant.state).toBe('inherited');
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow('sh-old-rel'); });
  await page.locator('#modal').getByRole('button', { name: /Enregistrer/ }).first().click();
  await expect(page.locator('#modal')).toBeHidden();
  const apres = await page.evaluate(async () => { const { S } = await import('./js/state.js'); const s = S.db.shows.find(x => x.id === 'sh-old-rel'); const db = window.__DB.shows.find(x => x.id === 'sh-old-rel');
    const { showPlace } = await import('./js/selectors.js'); return { app: [s.lat, s.lng], base: [db.lat, db.lng], place: showPlace(s) }; });
  expect(apres.base).toEqual([null, null]);
  expect(apres.place.state).toBe('inherited');
  expect(apres.place.coords).toEqual([48.86, 2.38]);
  expect(geocode).toBe(0);
});
