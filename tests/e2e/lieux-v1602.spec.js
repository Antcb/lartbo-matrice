// v1.60.2 — lieux sélectionnables dans les dates et les suivis (adresse, code postal), bonne localisation sur la carte.
// Données FICTIVES ; géocodage neutralisé par les tests (aucun service réel appelé).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const LIEU = { id: 'st-lieu', name: 'Zz Salle Réelle', address: '1 rue Fictive', postal_code: '30200', city: 'Bourg-Réel', country: 'France',
  department_code: '30', tags: ['Salle'], lat: 44.16, lng: 4.62 };
const EVT = { id: 'ev-1', structure_id: 'st-2', name: 'Zz Édition Ailleurs', city: 'Autre-Ville', place: null };

async function seed(page) {
  await page.evaluate(async ({ LIEU, EVT }) => { const { S, touch } = await import('./js/state.js');
    for (const [t, r] of [['structures', LIEU], ['structure_events', EVT]]) { window.__DB[t].push(structuredClone(r)); (S.db[t] ||= []).push(structuredClone(r)); touch(t); } }, { LIEU, EVT });
}
const pick = async (page, box, text, label) => {
  await page.locator(`${box} .ac-input`).fill(text);
  await page.locator('.ac-item', { hasText: label }).first().dispatchEvent('mousedown');
};

test('v1.60.2 date : lieu choisi dans la liste (adresse, CP, ville, département, coordonnées), jamais remplacé par l’organisateur', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow(null, 'art-a'); });
  await page.waitForTimeout(200);
  await pick(page, '#modal .ac[data-ac=lieux]', 'Zz Salle', 'Zz Salle Réelle');
  await expect(page.locator('#modal .ac:has([name=address]) .ac-input')).toHaveValue('1 rue Fictive');
  await expect(page.locator('#modal [name=postal_code]')).toHaveValue('30200');
  await expect(page.locator('#modal .ac:has([name=city]) .ac-input')).toHaveValue('Bourg-Réel');
  await expect(page.locator('#modal [name=department]')).toHaveValue('30');
  // organisateur choisi ensuite (structure à Villeexemple) : le lieu choisi reste
  await pick(page, '#modal .ac[data-ac=structures]', 'Salle Exemple', 'Salle Exemple');
  await expect(page.locator('#modal .ac:has([name=city]) .ac-input')).toHaveValue('Bourg-Réel');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.venue === 'Zz Salle Réelle') || null)).not.toBeNull();
  const row = await page.evaluate(() => window.__DB.shows.find(s => s.venue === 'Zz Salle Réelle'));
  expect(row).toMatchObject({ structure_id: 'st-1', address: '1 rue Fictive', postal_code: '30200', city: 'Bourg-Réel', department: '30', lat: 44.16, lng: 4.62 });
  const c = await page.evaluate(async id => (await import('./js/selectors.js')).showCoords((await import('./js/selectors.js')).byId('shows', id)), row.id);
  expect(c).toEqual([44.16, 4.62]);   // la carte place la date au lieu, pas chez l'organisateur (48.85, 2.35)
  expectClean(ctx);
});

test('v1.60.2 date : code postal tapé → département à 2 chiffres ; nom tapé librement gardé ; événement d’une autre ville', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  const r = await page.evaluate(async () => {
    const { byId, placeOfEvent, showCoords } = await import('./js/selectors.js');
    const ev = placeOfEvent(byId('structure_events', 'ev-1'));
    // date d'une autre ville que son organisateur, pas encore localisée : jamais placée chez l'organisateur
    const loin = showCoords({ structure_id: 'st-2', city: 'Autre-Ville', lat: null, lng: null });
    const meme = showCoords({ structure_id: 'st-2', city: 'Bourg-Test', lat: null, lng: null });
    return { ev, loin, meme };
  });
  expect(r.ev).toEqual({ venue: 'Zz Édition Ailleurs', address: null, postal_code: null, city: 'Autre-Ville', department: null, lat: null, lng: null });
  expect(r.loin).toBeNull();
  expect(r.meme).toEqual([47.45, -0.55]);
  // code postal saisi à la main sur une date existante : département déduit (règle {{cp}} : 2 chiffres, 2A/2B)
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow('sh-3'); });
  await page.waitForTimeout(200);
  await page.locator('#modal [name=postal_code]').fill('20090');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.shows.find(s => s.id === 'sh-3').postal_code)).toBe('20090');
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'sh-3').department)).toBe('2A');
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'sh-3').venue)).toBe('Lieu Témoin');   // nom inchangé
  // date existante enregistrée sans changer son lieu : aucune coordonnée écrite (la structure de sa ville reste le repère)
  await page.evaluate(async () => { (await import('./js/forms.js')).editShow('sh-2'); });
  await page.waitForTimeout(200);
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.table === 'shows' && c.op === 'update' && c.filters.some(f => f[1] === 'sh-2')).length)).toBe(1);
  expect(await page.evaluate(() => window.__DB.shows.find(s => s.id === 'sh-2').lat ?? null)).toBeNull();
  expectClean(ctx);
});

test('v1.60.2 suivi : lieu choisi (adresse, CP), carte centrée sur le lieu, date posée avec ce lieu, lieu retiré', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  await page.evaluate(async () => { const { save } = await import('./js/data.js'); await save('prospects', 'pr-1', { project_ids: ['art-a'] }, { rerender: false });
    await (await import('./js/actions.js')).ACTIONS.openSuivi({ dataset: { id: 'pr-1' } }); });
  // sans lieu : la structure du suivi sert de repère (comme avant)
  await expect(page.locator('.ws-who')).toContainText('Sans lieu choisi, la carte part de la structure');
  await expect.poll(() => page.evaluate(async () => (await import('./js/state.js')).S.mapData?.points?.find(p => p.ring)?.lat)).toBe(48.85);
  await pick(page, '.ws-who .ac[data-ac=lieuxAdr]', 'Zz Salle', 'Zz Salle Réelle');
  await expect.poll(() => page.evaluate(() => window.__DB.prospects.find(p => p.id === 'pr-1').venue)).toBe('Zz Salle Réelle');
  expect(await page.evaluate(() => { const p = window.__DB.prospects.find(p => p.id === 'pr-1');
    return [p.address, p.postal_code, p.city, p.department, p.lat, p.lng, p.structure_id]; })).toEqual(['1 rue Fictive', '30200', 'Bourg-Réel', '30', 44.16, 4.62, 'st-1']);
  await expect(page.locator('.ws-who')).toContainText('Zz Salle Réelle · 1 rue Fictive, 30200 Bourg-Réel');
  await expect.poll(() => page.evaluate(async () => (await import('./js/state.js')).S.mapData.points.find(p => p.ring)?.lat)).toBe(44.16);
  // « Poser une date » : le lieu du suivi est repris (organisateur = structure du suivi)
  await page.evaluate(async () => (await import('./js/actions.js')).ACTIONS.wsShow({ dataset: { id: 'pr-1' } }));
  await page.waitForTimeout(200);
  await expect(page.locator('#modal .ac[data-ac=lieux] .ac-input')).toHaveValue('Zz Salle Réelle');
  await expect(page.locator('#modal [name=postal_code]')).toHaveValue('30200');
  await page.locator('#modal [data-act=close], #modal button:has-text("Annuler")').first().click();
  // lieu retiré : la structure redevient le repère ; rien d'autre n'est touché
  await page.locator('[data-act=suiviLieuClear]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.prospects.find(p => p.id === 'pr-1').venue)).toBeNull();
  expect(await page.evaluate(() => window.__DB.prospects.find(p => p.id === 'pr-1').structure_id)).toBe('st-1');
  await expect(page.locator('.ws-who')).toContainText('Sans lieu choisi');
  expectClean(ctx);
});

test('v1.60.2 suivi : nom tapé sans choisir → gardé, « non localisé », jamais placé à la ville de la structure', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const { save } = await import('./js/data.js'); await save('prospects', 'pr-1', { project_ids: ['art-a'] }, { rerender: false });
    await (await import('./js/actions.js')).ACTIONS.openSuivi({ dataset: { id: 'pr-1' } }); });
  const inp = page.locator('.ws-who .ac[data-ac=lieuxAdr] .ac-input');
  await inp.fill('Zz Lieu Inconnu');
  await page.keyboard.press('Escape');
  await inp.blur();
  await expect.poll(() => page.evaluate(() => window.__DB.prospects.find(p => p.id === 'pr-1').venue)).toBe('Zz Lieu Inconnu');
  expect(await page.evaluate(() => window.__DB.prospects.find(p => p.id === 'pr-1').lat)).toBeNull();
  await expect(page.locator('.ws-who')).toContainText('non localisé');
  expect(await page.evaluate(async () => (await import('./js/selectors.js')).suiviCoords((await import('./js/selectors.js')).byId('prospects', 'pr-1')))).toBeNull();
  expectClean(ctx);
});
