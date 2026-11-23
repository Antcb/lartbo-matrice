// v1.66.3 — règle d'Anthony du 23/11/2026 : tous les choix d'artiste / de projet classés par ACTIVITÉ des 30 derniers jours glissants
// (dates, tâches créées à la main — pas les relances générées —, suivis créés, journal des suivis à sa date réelle avec un point au plus
// par suivi et par jour), puis score historique, puis ordre alphabétique ; actif / inactif hors classement, filtre des inactifs inchangé.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const ago = n => new Date(Date.now() - n * 864e5).toISOString();
const day = n => ago(n).slice(0, 10);

/** Données : Alpha a un gros historique ancien ; Bêta une activité récente ; Gamma rien de récent */
async function seed(page, extra = {}){
  await page.evaluate(async ({ old, recent, extra }) => {
    const { S, touch } = await import('./js/state.js');
    const P = (id, name, active = true) => ({ id, name, active });
    S.db.projects = [P('art-a', 'Artiste Alpha'), P('art-b', 'Artiste Bêta'), P('art-g', 'Artiste Gamma'), P('art-z', 'Zeta inactif', false)];
    S.db.shows = []; S.db.tasks = []; S.db.prospects = []; S.db.prospect_logs = [];
    // historique d'Alpha : 40 tâches anciennes (hors période)
    for (let i = 0; i < 40; i++) S.db.tasks.push({ id: 'ta' + i, title: 'A' + i, status: 'To Do', project_id: 'art-a', project_ids: ['art-a'], tags: [], created_at: old });
    // Bêta récent : 2 tâches à la main, 1 suivi créé
    S.db.tasks.push({ id: 'tb1', title: 'B1', status: 'To Do', project_ids: ['art-b'], tags: [], created_at: recent },
      { id: 'tb2', title: 'B2', status: 'To Do', project_ids: ['art-b'], tags: [], created_at: recent });
    S.db.prospects.push({ id: 'sb', name: 'Suivi', project_ids: ['art-b'], status: 'Mailed', created_at: recent });
    Object.entries(extra).forEach(([t, rows]) => S.db[t].push(...rows));
    ['projects', 'shows', 'tasks', 'prospects', 'prospect_logs'].forEach(touch);
  }, { old: ago(200), recent: ago(3), extra });
}
const order = page => page.evaluate(async () => (await import('./js/selectors.js')).projectOptions(false).map(p => p.id));
const act = page => page.evaluate(async () => Object.fromEntries((await import('./js/selectors.js')).projActivity()));

test('v1.66.3 activité des 30 derniers jours d’abord, puis historique, puis nom ; relances générées exclues', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  // Bêta (3 points récents) passe devant Alpha (gros historique, 0 récent) ; Gamma et Zeta : 0 → historique puis nom
  expect(await act(page)).toEqual({ 'art-b': 3 });
  expect(await order(page)).toEqual(['art-b', 'art-a', 'art-g', 'art-z']);   // actif / inactif hors classement
  // 10 relances GÉNÉRÉES pour Alpha (auto_kind) : ne comptent pas
  await seed(page, { tasks: Array.from({ length: 10 }, (_, i) => ({ id: 'ra' + i, title: 'Relance', status: 'To Do', project_ids: ['art-a'], tags: [], created_at: ago(1), auto_kind: 'relance_mail' })) });
  expect((await act(page))['art-a']).toBeUndefined();
  // « Programmer une relance » (messagerie) : créée à la main → compte ; suivi importé (notion_id) : ne compte pas
  await seed(page, { tasks: [{ id: 'pr1', title: 'Relance — X', status: 'To Do', project_ids: ['art-a'], tags: [], created_at: ago(1), auto_kind: 'relance_mail',
      notes: 'Relance de la conversation « Proposition » (messagerie). Suspendue automatiquement si une réponse arrive avant.' }],
    prospects: [{ id: 'imp', name: 'Suivi', project_ids: ['art-a'], status: 'Mailed', created_at: ago(1), notion_id: 'n-1' }] });
  expect((await act(page))['art-a']).toBe(1);
  // 4 tâches à la main pour Alpha cette semaine : Alpha (4) passe devant Bêta (3)
  await seed(page, { tasks: Array.from({ length: 4 }, (_, i) => ({ id: 'ma' + i, title: 'Main', status: 'To Do', project_ids: ['art-a'], tags: [], created_at: ago(2) })) });
  expect(await order(page)).toEqual(['art-a', 'art-b', 'art-g', 'art-z']);
  // hors période (31 jours) : ne compte pas
  await seed(page, { shows: [{ id: 'sh', project_id: 'art-g', status: 'Option', created_at: ago(31) }] });
  expect((await act(page))['art-g']).toBeUndefined();
  expectClean(ctx);
});

test('v1.66.3 journal : date réelle, un point par suivi et par jour (tous types), ancien mail importé ignoré', async ({ page }) => {
  const ctx = await openApp(page);
  const pr = { id: 'sg', name: 'Suivi', project_ids: ['art-g'], status: 'Mailed', created_at: ago(300) };
  const L = (id, d, kind = 'Mail', extra = {}) => ({ id, prospect_id: 'sg', kind, date: d, body: 'x', created_at: ago(0), ...extra });
  await seed(page, { prospects: [pr], prospect_logs: [
    L('l1', day(1)), L('l2', day(1), 'Appel'), L('l3', day(1), 'Note'),      // même suivi, même jour : 1 point
    L('l4', day(5), 'Note'),                                                   // note à la main : compte
    L('l5', day(400), 'Mail', { created_at: ago(0) }),                         // ancien mail importé aujourd'hui : sa date réelle
  ] });
  expect((await act(page))['art-g']).toBe(2);
  // Gamma (2 récents) reste derrière Bêta (3) mais devant Alpha (0 récent)
  expect(await order(page)).toEqual(['art-b', 'art-g', 'art-a', 'art-z']);
  expectClean(ctx);
});

test('v1.66.3 mêmes ordres dans Suivi, Mails et les fenêtres ; inactifs toujours masqués par défaut', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page);
  // filtre Artiste de Suivi
  await page.evaluate(async () => { const app = await import('./js/app.js'); const { S } = await import('./js/state.js'); app.go('prospects'); S.suiviPage = null; app.render(); });
  await page.locator('[data-suivi-filter="project"]').locator('xpath=..').locator('.pp-btn').click();
  const items = (await page.locator('.pp-items .ac-item[data-pp]:not([data-pp=""])').allInnerTexts()).map(t => t.replace(/^✓?\s*/, '').trim());
  expect(items).toEqual(['Artiste Bêta', 'Artiste Alpha', 'Artiste Gamma']);   // Zeta inactif : masqué (section repliée)
  await page.keyboard.press('Escape');
  // champ Artiste de Nouveau mail (Mails) et cases d'une tâche
  const mails = await page.evaluate(async () => (await import('./js/selectors.js')).projectOptions(true, []).map(p => p.name));
  expect(mails).toEqual(['Artiste Bêta', 'Artiste Alpha', 'Artiste Gamma']);
  await page.evaluate(async () => { (await import('./js/forms.js')).editTask(null); });
  expect(await page.locator('#modal [name=project_ids]').evaluateAll(els => els.map(e => e.closest('label').innerText.trim()))).toEqual(['Artiste Bêta', 'Artiste Alpha', 'Artiste Gamma']);
  expectClean(ctx);
});
