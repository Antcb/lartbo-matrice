// v1.60 — structure administrative de l'artiste = référence (décision d'Anthony du 05/11/2026). Données FICTIVES.
import { test, expect } from '@playwright/test';
import { openApp, preparePage, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}

test('v1.60 fiche artiste (lien public) : informations légales reprises de la structure, sans ressaisie', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/artiste.html?t=jeton-artiste-admin-01');
  await expect(page.locator('[name=adm_legal_name]')).toHaveValue('ASSOCIATION FICTIVE');
  await expect(page.locator('[name=adm_siret]')).toHaveValue('00000000000000');
  await expect(page.locator('[name=adm_city]')).toHaveValue('Ancienneville');   // réponse différente gardée : signalée à l'envoi, jamais appliquée
  await expect(page.locator('body')).toContainText('viennent de la fiche de ta structure');
  expectClean(ctx);
});

test('v1.60 onglet « Fiche artiste » : reprise de la structure, contradictions listées, rien d’écrasé ; TVA de la date à vérifier', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    structures: [{ id: 'adm-1', name: 'Association Fictive', tags: ['Structure artiste'], admin: { legal_name: 'ASSOCIATION FICTIVE', siret: '000 000 000 00000', vat_subject: 'Non', city: 'Villefictive' } }],
    projects: [{ id: 'art-g', name: 'Artiste Gamma', active: true, mode: 'booking', admin_structure_id: 'adm-1',
      artist_info: { adm_legal_name: 'Autre Nom', adm_siret: '00000000000000', adm_city: 'Villefictive' } }],
    shows: [{ id: 'g-1', project_id: 'art-g', venue: 'Salle G', date: `${Y}-02-01`, status: 'Confirmée Salle', prod_mode: 'booking', contract_type: 'Cession', fee_ht: 400 },
      { id: 'g-2', project_id: 'art-g', venue: 'Salle H', date: `${Y}-02-02`, status: 'Confirmée Salle', prod_mode: 'booking', contract_type: 'Cession', fee_ht: 400, vat_rate: 0 }] });
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js');
    app.go('projects'); S.projectPage = 'art-g'; S.tab.project = 'fiche'; app.render(); });
  const form = page.locator('[data-af-form="art-g"]');
  // réponse de l'artiste différente : elle reste affichée (listée « À vérifier »), la structure n'est pas modifiée
  await expect(form.locator('[name=adm_legal_name]')).toHaveValue('Autre Nom');
  await expect(page.locator('.panel')).toContainText('À vérifier : la fiche diffère de la structure');
  await expect(page.locator('.panel')).toContainText('fiche « Autre Nom », structure « ASSOCIATION FICTIVE »');
  await expect(page.locator('.panel')).not.toContainText('SIRET : fiche');   // même SIRET, écrit avec ou sans espaces : pas de contradiction
  expect(await page.evaluate(() => window.__calls.filter(c => c.op !== 'select' && ['structures', 'projects'].includes(c.table)).length)).toBe(0);
  // relecture v1.60.0 (B1) : modifier un AUTRE champ n'efface pas la réponse différente de l'artiste
  const gn = form.locator('[name=group_name]');
  if (await gn.count()){ await gn.fill('Nom de groupe fictif'); await gn.dispatchEvent('change'); }
  else { const any = form.locator('input:not([name^=adm_])').first(); await any.fill('valeur fictive'); await any.dispatchEvent('change'); }
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.rpc === 'artist_info_save').length)).toBeGreaterThan(0);
  const sent = await page.evaluate(() => { const c = window.__calls.filter(c => c.rpc === 'artist_info_save').at(-1); return c.args?.p_info; });
  expect(sent.adm_legal_name).toBe('Autre Nom');
  // TVA : structure non soumise ; date en booking sans TVA renseignée → à vérifier ; date déjà à 0 % → rien
  const v = await page.evaluate(async () => { const { vatConflict } = await import('./js/calc.js'); const { byId } = await import('./js/selectors.js');
    return [vatConflict(byId('shows', 'g-1')), vatConflict(byId('shows', 'g-2'))]; });
  expect(v).toEqual([true, false]);
  expectClean(ctx);
});
