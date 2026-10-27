// Lot Contacts v1.50 (Q23 ; décision du 27/10/2026 sur les doublons) : mail au mauvais format refusé avec un message sous le champ,
// partout (fenêtres, tableaux, pages publiques) ; doublon de contact par mail : avertissement + accès à la fiche existante, sans fusion.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const contacts = page => page.evaluate(() => window.__DB.contacts.map(c => ({ id: c.id, email: c.email || null, name: c.display_name })));
const openContact = (page, id) => page.evaluate(async i => { (await import('./js/forms.js')).editContact(i); }, id);

test('v1.50 fenêtre contact : mail invalide refusé sous le champ (pas de bulle du navigateur), rien n’est enregistré', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = (await contacts(page)).length;
  await openContact(page, null);
  await page.locator('#modal [name=first_name]').fill('Dominique');
  await page.locator('#modal [name=email]').fill('dominique.exemple.com');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal .help.err')).toHaveText('Adresse mail invalide : vérifie le @ et le domaine');
  await expect(page.locator('#modal [name=email]')).toHaveClass(/bad/);
  expect((await contacts(page)).length).toBe(avant);
  await page.locator('#modal [name=email]').fill('dominique@exemple.fr');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(async () => (await contacts(page)).some(c => c.email === 'dominique@exemple.fr')).toBe(true);
  expectClean(ctx);
});

test('v1.50 doublon par mail : avertissement ; « Annuler » reste dans la fenêtre ; « Ouvrir la fiche existante » ; « Enregistrer quand même »', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = (await contacts(page)).length;
  await openContact(page, null);
  await page.locator('#modal [name=first_name]').fill('Cam');
  await page.locator('#modal [name=email]').fill('  CAMILLE@example.com ');
  await page.locator('#modal button[type=submit]').click();
  const q = page.locator('dialog.ask');
  await expect(q).toContainText('est déjà celui de « Camille Exemple » (Salle Exemple)');
  await expect(q).toContainText('Aucune fusion');
  await q.locator('button', { hasText: 'Annuler' }).click();
  await expect(page.locator('#modal')).toBeVisible();
  expect((await contacts(page)).length).toBe(avant);
  // ouvrir la fiche existante : rien n'est enregistré, la fiche de Camille s'ouvre
  await page.locator('#modal button[type=submit]').click();
  await q.locator('button', { hasText: 'Ouvrir la fiche existante' }).click();
  await expect(page.locator('#modal h2')).toHaveText('Camille Exemple');
  expect((await contacts(page)).length).toBe(avant);
  await page.locator('#modal [data-act="closeModal"]').first().click();
  // enregistrer quand même : un second contact, le premier n'est pas modifié (aucune fusion)
  await openContact(page, null);
  await page.locator('#modal [name=first_name]').fill('Camille bis');
  await page.locator('#modal [name=email]').fill('camille@example.com');
  await page.locator('#modal button[type=submit]').click();
  await q.locator('button', { hasText: 'Enregistrer quand même' }).click();
  await expect.poll(async () => (await contacts(page)).length).toBe(avant + 1);
  expect((await contacts(page)).find(c => c.id === 'ct-1')).toMatchObject({ email: 'camille@example.com', name: 'Camille Exemple' });
  expectClean(ctx);
});

test('v1.50 création rapide d’un contact (depuis une autre fenêtre) : « Utiliser ce contact » reprend l’existant', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = (await contacts(page)).length;
  const pending = page.evaluate(async () => { const { CREATORS } = await import('./js/ui/autocomplete.js'); await import('./js/forms.js'); return CREATORS.contacts('Camille Ex'); });
  await page.locator('#modal2 [name=email]').fill('camille@example.com');
  await page.locator('#modal2 button[type=submit]').click();
  await page.locator('dialog.ask button', { hasText: 'Utiliser ce contact' }).click();
  expect(await pending).toEqual({ id: 'ct-1', label: 'Camille Exemple' });
  expect((await contacts(page)).length).toBe(avant);
  expectClean(ctx);
});

test('v1.50 tableau des membres : mail invalide refusé sous la case, l’ancien reste ; pages publiques : même contrôle', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => {
    const { S, touch } = await import('./js/state.js');
    const m = { id: 'mb-1', project_id: 'art-a', first_name: 'Alex', email: 'alex@exemple.fr', sort: 1 };
    window.__DB.project_members.push({ ...m }); S.db.project_members.push({ ...m }); touch('project_members');
    const app = await import('./js/app.js'); app.go('projects'); S.projectPage = 'art-a'; S.tab.project = 'members'; app.render();
  });
  const cell = page.locator('[data-t="project_members"][data-id="mb-1"][data-f="email"]');
  await expect(cell).toBeVisible();
  await cell.fill('alex@');
  await cell.dispatchEvent('change');
  await expect(page.locator('.help.err', { hasText: 'Adresse mail invalide' })).toBeVisible();
  expect(await page.evaluate(() => window.__DB.project_members.find(m => m.id === 'mb-1').email)).toBe('alex@exemple.fr');
  // contrôle commun utilisé par fiche.js, rh.js et artiste.js
  const r = await page.evaluate(async () => {
    const u = await import('./js/utils.js'), f = document.createElement('form');
    f.innerHTML = '<div class="field"><input type="email" value="a@b"></div><div class="field"><input type="email" value="ok@exemple.fr"></div><div class="field" hidden><input type="email" value="caché"></div>';
    document.body.append(f); const bad = u.checkMails(f).length, msgs = [...f.querySelectorAll('.help.err')].map(p => p.textContent); f.remove();
    return { bad, msgs, ok: [u.mailOk(''), u.mailOk('x@y.fr'), u.mailOk('x@y'), u.mailOk('x y@z.fr')] };
  });
  expect(r).toEqual({ bad: 1, msgs: ['Adresse mail invalide : vérifie le @ et le domaine'], ok: [true, true, false, false] });
  expectClean(ctx);
});
