// v1.66.6 — point n°1 d'Anthony (24/11/2026) : Prénom, Nom et nom de structure prennent une majuscule à la première lettre de chaque mot
// séparé par une espace, PENDANT LA FRAPPE ; le reste du mot garde sa casse ; nouvelles saisies seulement (aucune fiche corrigée en masse).
// Écrans : contacts (fiche, création rapide), structures (fiche, création rapide), équipe d'un artiste, fiche RH (Matrice et pages publiques).
import { test, expect } from '@playwright/test';
import { openApp, preparePage, expectClean } from './helpers.js';

test('v1.66.6 capWords : chaque mot séparé par une espace, reste du mot inchangé', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => { const { capWords } = await import('./js/utils.js');
    return ['jean dupont', 'mcCartney', 'de la tour', 'jean-pierre', "d'artagnan", '  élodie  éric', 'ÉMILE', 'straße', 'àlex ßar', ''].map(capWords); });
  expect(r).toEqual(['Jean Dupont', 'McCartney', 'De La Tour', 'Jean-pierre', "D'artagnan", '  Élodie  Éric', 'ÉMILE', 'Straße', 'Àlex ßar', '']);
  expectClean(ctx);
});

test('v1.66.6 fiche contact : majuscules pendant la frappe, curseur gardé ; fiche existante intacte sans nouvelle saisie', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { (await import('./js/forms.js')).editContact(null); });
  const prenom = page.locator('#modal [name=first_name]'), nom = page.locator('#modal [name=last_name]');
  await prenom.pressSequentially('jean marc');
  await expect(prenom).toHaveValue('Jean Marc');
  await nom.pressSequentially('de mcCartney');
  await expect(nom).toHaveValue('De McCartney');
  // saisie au milieu : le curseur reste où on tape
  await nom.press('Home'); await nom.press('ArrowRight'); await nom.press('ArrowRight'); await nom.press('ArrowRight');
  await nom.pressSequentially('la ');
  await expect(nom).toHaveValue('De La McCartney');
  expect(await nom.evaluate(el => el.selectionStart)).toBe(6);
  await page.keyboard.press('Escape');
  // fiche existante en minuscules : affichée et enregistrée telle quelle tant qu'on ne retape pas dans le champ
  const id = await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    const c = { id: 'ct-min', first_name: 'paul', last_name: 'durand', display_name: 'paul durand' };
    S.db.contacts.push({ ...c }); window.__DB.contacts.push({ ...c }); touch('contacts'); (await import('./js/forms.js')).editContact('ct-min'); return c.id; });
  await expect(page.locator('#modal [name=first_name]')).toHaveValue('paul');
  await expect(page.locator('#modal [name=last_name]')).toHaveValue('durand');
  expect(await page.evaluate(() => window.__DB.contacts.find(c => c.id === 'ct-min').first_name)).toBe('paul');
  expectClean(ctx);
});

test('v1.66.6 structure (fiche et création rapide), membre de l’équipe d’un artiste : majuscules ; autres champs inchangés', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { (await import('./js/forms.js')).editStructure(null); });
  const nomS = page.locator('#modal [name=name]');
  await nomS.pressSequentially('festival des nuits de fourvière');
  await expect(nomS).toHaveValue('Festival Des Nuits De Fourvière');
  // un autre champ texte (ville) n'est pas touché
  await page.locator('#modal [name=city]').pressSequentially('saint-étienne');
  await expect(page.locator('#modal [name=city]')).toHaveValue('saint-étienne');
  await page.keyboard.press('Escape');
  // création rapide d'une structure depuis la recherche : le texte tapé arrive avec ses majuscules
  await page.evaluate(async () => { const { CREATORS } = await import('./js/ui/autocomplete.js'); window.__p = CREATORS.structures('la belle électrique'); });
  await expect(page.locator('#modal2 [name=name]')).toHaveValue('La Belle Électrique');
  await page.keyboard.press('Escape');
  // création rapide d'un contact
  await page.evaluate(async () => { const { CREATORS } = await import('./js/ui/autocomplete.js'); window.__p2 = CREATORS.contacts('marie de la salle'); });
  await expect(page.locator('#modal2 [name=first_name]')).toHaveValue('Marie');
  await expect(page.locator('#modal2 [name=last_name]')).toHaveValue('De La Salle');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // tableau « Équipe » d'un artiste dans la Matrice (cellules) : Prénom / Nom en majuscules pendant la frappe, Poste non
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    const m = { id: 'pm-1', project_id: 'art-a', first_name: '', last_name: '', role: '', sort: 1 };
    S.db.project_members.push({ ...m }); window.__DB.project_members.push({ ...m }); touch('project_members');
    app.go('projects'); S.projectPage = 'art-a'; S.tab.project = 'members'; app.render(); });
  const pre = page.locator('[data-f="first_name"][data-cap]').first(), poste = page.locator('[data-f="role"]').first();
  await pre.click(); await pre.pressSequentially('jean luc');
  await expect(pre).toHaveValue('Jean Luc');
  await poste.click(); await poste.pressSequentially('chant lead');
  await expect(poste).toHaveValue('chant lead');
  expectClean(ctx);
});

test('v1.66.6 pages publiques : Prénom / Nom de l’équipe (artiste) et Prénom(s) / Nom de famille (RH) marqués et mis en majuscules', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/rh.html?t=jeton-rh-test-00000001&p=main');   // partie « Fiche RH » (identité)
  const p = page.locator('input[name=first_name]'), n = page.locator('input[name=last_name]');
  await expect(p).toHaveAttribute('data-cap', '');
  await p.fill(''); await p.pressSequentially('anne marie');
  await expect(p).toHaveValue('Anne Marie');
  await n.fill(''); await n.pressSequentially('le goff');
  await expect(n).toHaveValue('Le Goff');
  expect(await page.locator('input[name=birth_city]').getAttribute('data-cap')).toBeNull();
  await page.goto('/artiste.html?t=jeton-artiste-test-0001');
  await expect(page.locator('body')).toContainText('Artiste Alpha');
  const add = page.getByRole('button', { name: 'Ajouter une personne' });
  if (await add.count()) await add.first().click();
  const fp = page.locator('[data-col=first_name][data-cap]').first();
  await expect(fp).toBeVisible();
  await fp.fill(''); await fp.pressSequentially('léa du pont');
  await expect(fp).toHaveValue('Léa Du Pont');
  expect(await page.locator('[data-col=email][data-cap]').count()).toBe(0);
  expectClean(ctx);
});
