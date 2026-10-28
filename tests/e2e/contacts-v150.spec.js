// Lot Contacts v1.50 (Q23 ; décision du 27/10/2026 sur les doublons) : mail au mauvais format refusé avec un message sous le champ,
// partout (fenêtres, tableaux, pages publiques) ; doublon de contact par mail : avertissement + accès à la fiche existante, sans fusion.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const contacts = page => page.evaluate(() => window.__DB.contacts.map(c => ({ id: c.id, email: c.email || null, name: c.display_name })));
const openContact = async (page, id) => {
  await page.evaluate(async i => { (await import('./js/forms.js')).editContact(i); }, id);
  // nouveau contact : le curseur se place dans le premier champ 30 ms après l'ouverture ; on attend avant de saisir
  if (id == null) await expect(page.locator('#modal [name=first_name]')).toBeFocused();
};

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
  // la fenêtre place le curseur dans le premier champ 30 ms après l'ouverture : on attend avant de saisir (sinon le texte peut y atterrir)
  await expect(page.locator('#modal2 [name=first_name]')).toBeFocused();
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
  // bordure et message en --danger, même quand la case a le focus (relecture, facultatif 3)
  const col = await cell.evaluate(el => { el.focus(); const d = document.createElement('i'); d.style.color = 'var(--danger)'; document.body.append(d);
    const want = getComputedStyle(d).color; d.remove(); return { border: getComputedStyle(el).borderTopColor, msg: getComputedStyle(el.nextElementSibling).color, want }; });
  expect([col.border, col.msg]).toEqual([col.want, col.want]);
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

test('v1.50 relecture B1 : prospection vers un contact à 2 mails — plusieurs destinataires acceptés, une adresse fausse dans la liste refusée', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => {
    const { S, touch } = await import('./js/state.js');
    for (const db of [window.__DB, S.db]) db.contacts.find(c => c.id === 'ct-1').email_2 = 'camille2@example.com';
    touch('contacts');
    (await import('./js/prospection.js')).openProspection('st-1');
  });
  const to = page.locator('#pr-to');
  await expect(to).toHaveValue(/camille@example\.com.*camille2@example\.com/);
  await page.locator('#pr-cc').fill('Régie <regie@exemple.fr>; prod@exemple.fr');
  await page.locator('#modal button[type=submit]').first().click();
  await expect(page.locator('#modal .help.err[data-field-err]')).toHaveCount(0);
  // le contrôle des mails est passé : on arrive aux contrôles suivants de la fenêtre (artiste / objet)
  await expect(page.locator('.toast').last()).toContainText(/artiste|objet/);
  // une adresse fausse dans la liste : message sous le champ, rien n'est envoyé
  const avant = await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length);
  await to.fill('camille@example.com, camille.example.com');
  await page.locator('#modal button[type=submit]').first().click();
  await expect(page.locator('#modal .help.err[data-field-err]')).toHaveText('Adresse mail invalide : vérifie le @ et le domaine');
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(avant);
  expectClean(ctx);
});

test('v1.50 relecture B2 : infos administratives d’une structure — mail invalide jamais enregistré, message sous le champ', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => {
    const box = document.createElement('div'); box.className = 'field';
    box.innerHTML = '<input id="adm-email" data-admin="email" data-sid="st-1">'; document.body.append(box);
  });
  const i = page.locator('#adm-email');
  await i.fill('pas-un-mail'); await i.dispatchEvent('change');
  await expect(page.locator('.help.err[data-field-err]')).toHaveText('Adresse mail invalide : vérifie le @ et le domaine');
  expect(await page.evaluate(() => (window.__DB.structures.find(s => s.id === 'st-1').admin || {}).email)).toBeUndefined();
  await i.fill('admin@exemple.fr'); await i.dispatchEvent('change');
  await expect(page.locator('.help.err[data-field-err]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window.__DB.structures.find(s => s.id === 'st-1').admin || {}).email)).toBe('admin@exemple.fr');
  expectClean(ctx);
});

test('v1.50 relecture B3 : listes de la fiche artiste — un seul message par champ, retiré une fois corrigé ; invisible refusé ; listes d’adresses', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const u = await import('./js/utils.js'), f = document.createElement('form');
    f.innerHTML = '<div class="al-row"><div class="al-cell"><input data-col="email" type="email" value="faux"></div></div><div class="al-row"><input data-col="email" type="email" value="aussi-faux"></div>';
    document.body.append(f);
    const n = () => f.querySelectorAll('[data-field-err]').length;
    const out = [u.checkMails(f).length, n()]; out.push(u.checkMails(f).length, n());
    f.querySelectorAll('input').forEach(i => { i.value = 'ok@exemple.fr'; }); out.push(u.checkMails(f).length, n());
    f.remove();
    return [...out, u.mailsOk('A <a@b.fr>, c@d.fr'), u.mailsOk('a@b.fr; x'), u.mailsOk(''), u.mailsOk(','), u.mailsOk('a@b.fr,'),
      u.mailsOk('"Dupont, Jean" <j@x.fr>; k@y.fr'), u.mailOk('neo@exemple.fr\u200B'), u.mailOk('neo\u200B@exemple.fr'), u.mailOk('neo@exe\u200Bmple.fr'), u.mailOk('n\u202Eeo@exemple.fr'), u.mailsOk('a\u200B@b.fr, c@d.fr')];
  });
  // invisible refusé (relecture N1) : il serait enregistré tel quel hors de la table des contacts
  expect(r).toEqual([2, 2, 2, 2, 0, 0, true, false, true, false, true, true, false, false, false, false, false]);
  expectClean(ctx);
});

test('v1.50 relecture B2 : fiche artiste dans l’app (enregistrée au fil de la saisie) — rien n’est enregistré tant que le mail est faux', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => {
    await import('./js/views/projects.js');
    const box = document.createElement('div');
    box.innerHTML = '<span data-af-state="art-a"></span><form class="af-edit" data-af-form="art-a"><div class="field"><input name="adm_email" type="email"></div></form>';
    document.body.append(box);
  });
  const i = page.locator('form.af-edit input[name=adm_email]');
  await i.fill('pas-un-mail'); await i.dispatchEvent('change');
  await expect(page.locator('form.af-edit .help.err[data-field-err]')).toHaveText('Adresse mail invalide : vérifie le @ et le domaine');
  await expect(page.locator('[data-af-state="art-a"]')).toHaveText('Non enregistré : adresse mail à corriger');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.__calls.filter(c => c.rpc === 'artist_info_save').length)).toBe(0);
  await i.fill('admin@exemple.fr'); await i.dispatchEvent('change');
  await expect(page.locator('form.af-edit .help.err[data-field-err]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.rpc === 'artist_info_save').length)).toBe(1);
  expectClean(ctx);
});

test('v1.50.1 doublon : pas d’avertissement quand on ne change que le téléphone ; avertissement si on change le mail', async ({ page }) => {
  const ctx = await openApp(page);
  // deux contacts partagent déjà le même mail (donnée existante)
  await page.evaluate(async () => {
    const { S, touch } = await import('./js/state.js');
    const d = { id: 'ct-2', first_name: 'Camille', last_name: 'Bis', display_name: 'Camille Bis', email: 'camille@example.com' };
    window.__DB.contacts.push({ ...d }); S.db.contacts.push({ ...d }); touch('contacts');
  });
  await openContact(page, 'ct-2');
  await page.locator('#modal [name=phone]').fill('06 00 00 00 00');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('dialog.ask')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__DB.contacts.find(c => c.id === 'ct-2').phone)).toBe('06 00 00 00 00');
  // mail 2 ajouté, déjà celui d'un autre contact : avertissement
  const d = { id: 'ct-3', first_name: 'Dom', display_name: 'Dom', email: 'dom@exemple.fr' };
  await page.evaluate(async x => { const { S, touch } = await import('./js/state.js'); window.__DB.contacts.push({ ...x }); S.db.contacts.push({ ...x }); touch('contacts'); }, d);
  await openContact(page, 'ct-3');
  await page.locator('#modal [name=email_2]').fill('CAMILLE@example.com');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('dialog.ask')).toContainText('Contact déjà présent');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  expectClean(ctx);
});
