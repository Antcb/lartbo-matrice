// v1.60.2 — corrections visuelles (point 16) : en-tête de la fiche artiste, tarifs du budget type par jauge
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const ficheArtiste = page => page.evaluate(async () => { const { S } = await import('./js/state.js'); const a = await import('./js/app.js');
  for (const db of [S.db, window.__DB]) db.projects.find(p => p.id === 'art-a').name = 'Artiste Alpha Orchestra International';
  a.go('projects'); S.projectPage = 'art-a'; a.render(); });
const coupe = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// les champs ne recouvrent pas le texte « jusqu’à » et restent dans leur cellule
async function tarifsAlignes(page) {
  const t = page.locator('table.bt-tiers').first();
  await t.scrollIntoViewIfNeeded();
  return t.evaluate(tbl => [...tbl.querySelectorAll('tbody td')].flatMap(td => [...td.querySelectorAll('input')].map(i => {
    const c = td.getBoundingClientRect(), r = i.getBoundingClientRect();
    const txt = document.createRange(); const n = [...td.childNodes].find(x => x.nodeType === 3 && x.textContent.trim());
    let surTexte = false; if (n && n.nextSibling === i){ txt.selectNodeContents(n); const b = txt.getBoundingClientRect(); surTexte = r.left < b.right - 1 && Math.abs(r.top - b.top) < r.height; }
    return (r.left < c.left - 1 || r.right > c.right + 1 || surTexte) ? `${i.dataset.bt} [${Math.round(r.left)}–${Math.round(r.right)}] hors [${Math.round(c.left)}–${Math.round(c.right)}]${surTexte ? ' sur le texte' : ''}` : null;
  }).filter(Boolean)));
}

for (const [w, h, opts] of [[390, 844, { hasTouch: true, isMobile: true }], [1024, 768, {}], [1440, 900, {}]]) test.describe(`${w} px`, () => {
  test.use({ viewport: { width: w, height: h }, ...opts });
  test(`v1.60.2 fiche artiste : les boutons ne recouvrent ni le nom ni les pastilles (${w} px)`, async ({ page }) => {
    const ctx = await openApp(page);
    await ficheArtiste(page);
    const hero = page.locator('.project-hero');
    await expect(hero.locator('h1')).toBeVisible();
    const zones = [await hero.locator('h1').boundingBox(), ...await hero.locator('.proj-chips .badge').evaluateAll(l => l.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }))];
    const btns = await hero.locator('.vh-actions .btn').evaluateAll(l => l.map(e => { const r = e.getBoundingClientRect(); return { t: e.innerText.trim(), x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(btns.length).toBe(5);
    expect(btns.filter(b => zones.some(z => coupe(b, z))).map(b => b.t), 'boutons posés sur le nom ou les pastilles').toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'pas de défilement horizontal').toBeLessThanOrEqual(w);
    const h1 = zones[0];
    if (w <= 1100) expect(Math.min(...btns.map(b => b.y)), 'boutons sous le nom').toBeGreaterThanOrEqual(h1.y + h1.height - 1);
    else expect(btns.every(b => b.y < h1.y + h1.height), 'ordinateur : boutons à droite du nom, comme avant').toBe(true);
    expect(await tarifsAlignes(page), 'budget type de l’artiste : tarifs par jauge').toEqual([]);
    expectClean(ctx);
  });
});

test('v1.60.2 Réglages : tarifs du budget type par jauge alignés (même formulaire)', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => (await import('./js/app.js')).go('settings'));
  const n = await page.locator('table.bt-tiers').count();
  test.skip(n === 0, 'budget type non affiché dans cet onglet des Réglages');
  expect(await tarifsAlignes(page)).toEqual([]);
  expectClean(ctx);
});
