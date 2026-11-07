// v1.60.2 — décision d'Anthony du 07/11/2026 : lieu de représentation d'une date défini date par date (lieu choisi, adresse propre,
// ou case « Utiliser l'adresse de la structure comme lieu de représentation ») ; documents sans l'adresse de la structure sans la case ;
// carte : repères conservés (« localisation héritée — lieu à confirmer »), « localisation manquante » sans coordonnées.
// Données FICTIVES ; géocodage neutralisé (aucun service réel appelé).
import { test, expect } from '@playwright/test';
import { openApp, preparePage, expectClean } from './helpers.js';

const ST = { id: 'st-siege', name: 'Zz Organisateur', address: '1 avenue du Siège', postal_code: '75011', city: 'Paris', country: 'France',
  department_code: '75', tags: ['Association'], lat: 48.86, lng: 2.38 };
const EVT = { id: 'ev-siege', structure_id: 'st-siege', name: 'Zz Festival du Siège', city: 'Paris', place: null };

async function seed(page) {
  await page.evaluate(async ({ ST, EVT }) => { const { S, touch } = await import('./js/state.js');
    for (const [t, r] of [['structures', ST], ['structure_events', EVT]]) { window.__DB[t].push(structuredClone(r)); (S.db[t] ||= []).push(structuredClone(r)); touch(t); } }, { ST, EVT });
}

test('documents : adresse de la date, sinon de la structure seulement si la case est cochée, sinon à compléter', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const { ficheDefaults, venueAddressOf } = await import('./js/fiche-fields.js');
    const structure = { name: 'Org', address: '1 avenue du Siège', postal_code: '75011', city: 'Paris', admin: { address: '9 rue Admin', postal_code: '93310' } };
    const pick = d => { const x = ficheDefaults({ structure, city: 'Paris', cp: '75', ...d }); return [x.venue_address ?? null, x.venue_postal_code ?? null]; };
    return {
      propre: pick({ address: '12 rue du Lieu', postal_code: '69003', venue_is_structure: true }),
      cochee: pick({ address: null, postal_code: '', venue_is_structure: true }),
      nonCochee: pick({ address: null, postal_code: null, venue_is_structure: false }),
      ancienne: pick({}),   // date existante (colonne absente / faux) : rien de la structure
      sansStructure: venueAddressOf({ venue_is_structure: true }, null),
    };
  });
  expect(r.propre).toEqual(['12 rue du Lieu', '69003']);
  expect(r.cochee).toEqual(['1 avenue du Siège', '75011']);
  expect(r.nonCochee).toEqual([null, null]);
  expect(r.ancienne).toEqual([null, null]);
  expect(r.sansStructure).toEqual({ address: null, postal_code: null });
  expectClean(ctx);
});

test('fiche publique : adresse de la structure proposée seulement avec la case ; coordonnées de l’organisateur inchangées', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/fiche.html?t=jeton-fiche-lieu-00002');
  await expect(page.locator('#fiche-form')).toBeVisible();
  await expect(page.locator('#fiche-form [name="venue_address"]')).toHaveValue('');
  await expect(page.locator('#fiche-form [name="venue_postal_code"]')).toHaveValue('');
  await expect(page.locator('#fiche-form [name="address"]')).toHaveValue('1 avenue du Siège');   // siège social (administratif) : gardé
  await page.goto('/fiche.html?t=jeton-fiche-lieu-00003');
  await expect(page.locator('#fiche-form [name="venue_address"]')).toHaveValue('1 avenue du Siège');
  await expect(page.locator('#fiche-form [name="venue_postal_code"]')).toHaveValue('75011');
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
  await expect(page.locator('#modal .ac:has([name=city]) .ac-input')).toHaveValue('Paris');
  await expect(page.locator('#modal [name=venue_is_structure]')).not.toBeChecked();
  await expect(page.locator('#modal [data-place-note]')).toContainText('reste à compléter');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.structure_id === 'st-siege') || null)).not.toBeNull();
  const a = await page.evaluate(() => window.__DB.shows.find(s => s.structure_id === 'st-siege'));
  expect([a.address ?? null, a.postal_code ?? null, a.lat ?? null, a.lng ?? null, !!a.venue_is_structure]).toEqual([null, null, null, null, false]);
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

test('événement de la structure : jamais l’adresse ni les coordonnées de la structure', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  const ev = await page.evaluate(async () => { const { byId, placeOfEvent } = await import('./js/selectors.js'); return placeOfEvent(byId('structure_events', 'ev-siege')); });
  expect(ev).toEqual({ venue: 'Zz Festival du Siège', address: null, postal_code: null, city: 'Paris', department: '75', lat: null, lng: null });
  expectClean(ctx);
});
