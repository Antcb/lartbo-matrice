// Lot V1.52.1 — Prospection sur iPhone (demande d'Anthony du 28/10/2026) : correction d'interface seulement.
// Fenêtre de mail plein écran en une colonne (le choix du modèle n'est plus hors écran), tout le contenu défile, boutons
// d'action en bas toujours visibles, cibles tactiles ≥ 40 px ; fiche de suivi sans défilement horizontal ; ordinateur inchangé.
// Émulation Chromium (largeurs iPhone, écran tactile) : Safari iOS réel non testé ici.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const TPLS = [0, 1, 2, 3].map(i => ({ id: 'tp-' + i, kind: i < 3 ? 'prospection' : 'relance', name: `Modèle ${i} de prospection au nom assez long pour un téléphone`,
  subject: `Proposition ${i} {{artistes}}`, html: `<div>Texte du modèle ${i} pour {{contact}}.</div>`, attachments: i === 1 ? [{ path: 'm/dossier.pdf', name: 'Dossier.pdf', size: 1e6 }] : [] }));
async function seed(page) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const x of t) { window.__DB.mail_templates.push(structuredClone(x)); S.db.mail_templates.push(structuredClone(x)); } touch('mail_templates');
    for (const db of [S.db, window.__DB]) Object.assign(db.prospects.find(p => p.id === 'pr-1'), { mail_thread_id: 'th-1', mail_sent_at: '2026-10-01', mail_to: 'contact@exemple.invalid', mail_subject: 'Proposition' });
    touch('prospects'); }, TPLS);
}
const inView = (box, w, h) => box && box.x >= 0 && box.x + box.width <= w + 0.5 && box.y >= 0 && box.y + box.height <= h + 0.5;

for (const [w, h] of [[375, 667], [390, 844], [430, 932]]) {
  test.describe(`iPhone ${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });

    test(`v1.52.1 parcours de prospection complet sur téléphone (${w} px)`, async ({ page }) => {
      const ctx = await openApp(page);
      await seed(page);
      // 1-2. Suivi : recherche, puis fiche du suivi ; aucune largeur imposée
      await page.evaluate(async () => (await import('./js/app.js')).go('prospects'));
      await page.locator('main .search').fill('Salle');
      await expect(page.locator('main')).toContainText('Salle Exemple');
      await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.suiviPage = 'pr-1'; (await import('./js/app.js')).render(); });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      // 9. historique (journal) consultable
      await expect(page.locator('main')).toContainText('Journal des échanges');
      // 3. fenêtre de rédaction : plein écran, une colonne
      await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('st-1'); });
      const dlg = page.locator('#modal');
      await expect(dlg).toBeVisible();
      const d = await dlg.boundingBox();
      expect([Math.round(d.x), Math.round(d.width)]).toEqual([0, w]);
      expect(await dlg.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      // 4. modèle : visible, dans l'écran, assez grand au doigt, choisi librement ; le texte suit
      const tpl = page.locator('#pr-tpl');
      await tpl.scrollIntoViewIfNeeded();
      const tb = await tpl.boundingBox();
      expect(tb.x).toBeGreaterThanOrEqual(0); expect(tb.x + tb.width).toBeLessThanOrEqual(w); expect(tb.height).toBeGreaterThanOrEqual(40);
      await tpl.selectOption('tp-2');
      await expect(page.locator('#pr-body')).toContainText('Texte du modèle 2');
      await expect(page.locator('#pr-subj')).toHaveValue(/Proposition 2/);
      // le modèle choisi reste choisi pendant l'édition
      await page.locator('#pr-body').click();
      await page.keyboard.type(' Ajout depuis le téléphone.');
      await expect(page.locator('#pr-body')).toContainText('Ajout depuis le téléphone');
      await expect(tpl).toHaveValue('tp-2');
      // 6. pièces jointes : modèle avec un fichier, case cochable au doigt
      await tpl.selectOption('tp-1');
      await page.locator('dialog.ask button', { hasText: 'Remplacer le texte' }).click();
      const box = page.locator('#pr-files input[type=checkbox]').first();
      await box.scrollIntoViewIfNeeded(); await box.check();
      await expect(page.locator('#pr-files')).toContainText('1 cochée');
      // 7. aperçu : le texte mis en forme est visible en entier en faisant défiler la fenêtre
      const body = page.locator('#modal .modal-body');
      expect(await body.evaluate(e => getComputedStyle(e).overflowY)).toBe('auto');
      await body.evaluate(e => { e.scrollTop = e.scrollHeight; });
      await expect(page.locator('#modal .help')).toBeInViewport();
      // 8. « Envoyer maintenant » et « Brouillon » toujours dans l'écran, au doigt
      for (const sel of ['#modal button[type=submit]', '#pr-draft', '#modal .modal-foot [data-act=closeModal]']) {
        const b = await page.locator(sel).boundingBox(); expect(inView(b, w, h), sel).toBe(true); expect(b.height).toBeGreaterThanOrEqual(40);
      }
      // aucun envoi en test : on ferme
      await page.locator('#modal .modal-foot [data-act=closeModal]').click();
      // 10. relance dans le fil : même fenêtre, modèle de relance choisi, boutons accessibles
      await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('st-1', { prospectId: 'pr-1' }); });
      await expect(page.locator('#modal')).toContainText('Relance n°1');
      await expect(page.locator('#pr-tpl')).toHaveValue('tp-3');
      expect(inView(await page.locator('#modal button[type=submit]').boundingBox(), w, h)).toBe(true);
      expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
      expectClean(ctx);
    });
  });
}

test.describe('ordinateur', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('v1.52.1 ordinateur inchangé : fenêtre de mail en grille à 4 colonnes, largeur limitée', async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page);
    await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('st-1'); });
    const cols = await page.locator('#modal .mail-grid').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(4);
    expect(await page.locator('#modal .modal-body').evaluate(e => getComputedStyle(e).overflowY)).toBe('hidden');
    expect((await page.locator('#modal').boundingBox()).width).toBeLessThan(1280);
    expectClean(ctx);
  });
});
