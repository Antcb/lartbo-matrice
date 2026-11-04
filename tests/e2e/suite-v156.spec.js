// Lot V1.56 — suite des demandes d'Anthony du 04/11/2026 (points 4 à 7 de son message de 10 h 34). Données FICTIVES ; aucun envoi.
//  - contact rattaché à plusieurs structures : le retirer d'une structure garde sa fiche et ses autres rattachements ; fonction par structure ;
//  - structures inactives : exclues par défaut des nouvelles sélections de prospection (suivi), accessibles sur demande, anciens dossiers intacts ;
//  - artiste sélectionné : visible et désélectionnable partout ; jamais repris d'office dans un nouveau suivi ; textes saisis jamais perdus ;
//  - projets les plus utilisés en premier : preuve sur chaque type de sélecteur.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const render = page => page.evaluate(async () => (await import('./js/app.js')).render());

test('v1.56 contact retiré d’une structure : fiche et autres rattachements gardés ; fonction différente selon la structure', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { structures: [{ id: 'sc-2', name: 'Zz Deuxième salle', city: 'Ailleurs' }], contact_structures: [{ contact_id: 'ct-1', structure_id: 'sc-2', role: 'Directrice' }] });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.contact_structures.find(l => l.contact_id === 'ct-1' && l.structure_id === 'st-1').role = 'Programmatrice'; touch('contact_structures'); });
  const role = s => page.evaluate(s => window.__DB.contact_structures.find(l => l.contact_id === 'ct-1' && l.structure_id === s)?.role ?? null, s);
  expect([await role('st-1'), await role('sc-2')]).toEqual(['Programmatrice', 'Directrice']);
  // fiche contact : on retire la structure « Salle Exemple » seulement
  await page.evaluate(async () => { (await import('./js/forms.js')).editContact('ct-1'); });
  await page.locator('#modal .chip[data-lid="st-1"] [data-act=unlink]').click();
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__DB.contact_structures.filter(l => l.contact_id === 'ct-1').map(l => l.structure_id))).toEqual(['sc-2']);
  expect(await page.evaluate(() => window.__DB.contacts.filter(c => c.id === 'ct-1').length)).toBe(1);   // fiche gardée
  expect(await role('sc-2')).toBe('Directrice');                                                       // l'autre rattachement et sa fonction intacts
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'contacts' && c.op === 'delete').length)).toBe(0);
  expectClean(ctx);
});

test('v1.56 structures inactives : absentes des nouvelles sélections de suivi, accessibles sur demande, anciens dossiers intacts', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, {
    structures: [{ id: 'si-1', name: 'Zz Salle fermée', city: 'Ville', inactive_at: '2026-11-01T10:00:00Z' }, { id: 'si-2', name: 'Zz Salle ouverte', city: 'Ville' }],
    prospects: [{ id: 'pi-old', name: 'Suivi', structure_id: 'si-1', project_ids: ['art-a'], project_id: 'art-a', status: 'Interest', last_contact: '2026-01-10' }],
  });
  // nouveau suivi : la structure fermée n'est pas proposée, une ligne permet de l'afficher
  await page.evaluate(async () => (await import('./js/actions.js')).ACTIONS.newProspect());
  const ac = page.locator('.ws-who .ac-input');
  await ac.fill('Zz Salle');
  await expect(page.locator('.ac-item', { hasText: 'Zz Salle ouverte' })).toHaveCount(1);
  await expect(page.locator('.ac-item', { hasText: 'Zz Salle fermée' })).toHaveCount(0);
  await expect(page.locator('.ac-item', { hasText: 'Afficher aussi 1 structure inactive' })).toHaveCount(1);
  // accès volontaire : la ligne affiche la structure, signalée « inactive », et on peut la choisir
  await page.locator('.ac-item', { hasText: 'Afficher aussi' }).dispatchEvent('mousedown');
  await expect(page.locator('.ac-item', { hasText: 'Zz Salle fermée' })).toContainText('inactive');
  await page.locator('.ac-item', { hasText: 'Zz Salle fermée' }).dispatchEvent('mousedown');
  await expect.poll(() => page.evaluate(() => window.__DB.prospects.at(-1).structure_id)).toBe('si-1');
  // ancien dossier : intact, structure affichée
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.view = 'prospects'; S.suiviPage = 'pi-old'; (await import('./js/app.js')).render(); });
  await expect(page.locator('.ws-who .ac-input')).toHaveValue('Zz Salle fermée');
  expect(await page.evaluate(() => window.__DB.prospects.find(p => p.id === 'pi-old').structure_id)).toBe('si-1');
  // fiche de la structure fermée : « Nouveau suivi » demande d'abord (Annuler : rien n'est créé) ; « Prospection » n'est plus le bouton principal
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); app.go('structures'); S.structurePage = 'si-1'; app.render(); });
  await expect(page.locator('[data-act=prospection][data-id=si-1]')).not.toHaveClass(/primary/);
  const n = await page.evaluate(() => window.__DB.prospects.length);
  await page.locator('[data-act=newSuiviFor][data-id=si-1]').click();
  await expect(page.locator('dialog.ask')).toContainText('marquée inactive');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__DB.prospects.length)).toBe(n);
  expectClean(ctx);
});

test('v1.56 artiste sélectionné : rappelé et désélectionnable sur les pages sans filtre ; jamais repris d’office dans un nouveau suivi', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const st = await import('./js/state.js'); st.setProjects(['art-a']); (await import('./js/app.js')).go('structures'); });
  await expect(page.locator('.artist-ctx')).toContainText('Artiste Alpha');
  await page.locator('.artist-ctx [data-act=clearArtists]').click();
  await expect(page.locator('.artist-ctx')).toHaveCount(0);
  expect(await page.evaluate(async () => (await import('./js/state.js')).S.projects)).toEqual([]);
  // pages avec le filtre artistes : pas de rappel en double
  await page.evaluate(async () => { (await import('./js/state.js')).setProjects(['art-a']); (await import('./js/app.js')).go('booking'); });
  await expect(page.locator('.artist-ctx')).toHaveCount(0);
  // nouveau suivi : aucun artiste repris du filtre
  await page.evaluate(async () => (await import('./js/actions.js')).ACTIONS.newProspect());
  await expect.poll(() => page.evaluate(() => window.__DB.prospects.at(-1).project_ids)).toEqual([]);
  expectClean(ctx);
});

test('v1.56 textes saisis jamais perdus : objet de prospection retouché gardé ; mail d’une date : changement de contact sans écraser le texte', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { mail_templates: [{ id: 'mt-p', kind: 'prospection', name: 'Prospection (test)', subject: 'Proposition {{artistes}}', html: '<div>Bonjour</div>', attachments: [] },
      { id: 'mt-p2', kind: 'prospection', name: 'Prospection bis (test)', subject: 'Autre proposition', html: '<div>Salut</div>', attachments: [] },
      { id: 'mt-c2', project_id: 'art-a', kind: 'confirmation', name: 'Confirmation bis (test)', subject: 'Autre confirmation', html: '<div>Autre</div>', attachments: [] }],
    contacts: [{ id: 'ct-9', display_name: 'Dominique Autre', email: 'dominique@exemple.invalid' }], contact_structures: [{ contact_id: 'ct-9', structure_id: 'st-2' }] });
  // prospection : objet retouché, puis un artiste coché → l'objet reste
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('st-1'); });
  await page.locator('#pr-tpl').selectOption('mt-p');
  await page.locator('#pr-subj').fill('Mon objet à moi');
  await page.locator('#modal .pr-arts label', { hasText: 'Artiste Alpha' }).click();
  await expect(page.locator('#modal [data-pr-art="art-a"]')).toBeChecked();
  await expect(page.locator('#pr-subj')).toHaveValue('Mon objet à moi');
  // texte retouché aussi ; artiste décoché puis un autre coché : rien n'est perdu, les artistes cochés restent ceux choisis
  await page.locator('#pr-body').click(); await page.keyboard.press('End'); await page.keyboard.type(' — ma phrase');
  await page.locator('#modal .pr-arts label', { hasText: 'Artiste Alpha' }).click();
  await page.locator('#modal .pr-arts label', { hasText: 'Artiste Bêta' }).click();
  await expect(page.locator('#pr-subj')).toHaveValue('Mon objet à moi');
  await expect(page.locator('#pr-body')).toContainText('ma phrase');
  await expect(page.locator('#modal [data-pr-art="art-a"]')).not.toBeChecked();
  await expect(page.locator('#modal [data-pr-art="art-b"]')).toBeChecked();
  // autre modèle demandé puis « Annuler » : objet et texte intégralement gardés, modèle d'avant affiché
  const before = { subj: await page.locator('#pr-subj').inputValue(), body: await page.locator('#pr-body').innerHTML() };
  await page.locator('#pr-tpl').selectOption('mt-p2');
  await expect(page.locator('dialog.ask')).toContainText('Remplacer le texte retouché');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  await expect(page.locator('#pr-tpl')).toHaveValue('mt-p');
  expect({ subj: await page.locator('#pr-subj').inputValue(), body: await page.locator('#pr-body').innerHTML() }).toEqual(before);
  await page.locator('#modal [data-act=closeModal]').first().click();
  // mail d'une date (confirmation) : texte retouché, puis autre contact → question ; « Annuler » garde le texte, l'adresse suit le contact
  await page.evaluate(async () => { (await import('./js/mail.js')).prepareMail('sh-1', 'confirmation'); });
  await expect(page.locator('#ml-body')).toBeVisible();
  await page.locator('#ml-body').click(); await page.keyboard.press('End'); await page.keyboard.type(' — mon ajout');
  // choix au clavier : événement « vrai » (un selectOption de Playwright ressemble à une restauration de brouillon, ignorée exprès)
  await page.locator('#ml-contact').focus();
  for (let i = 0; i < 6 && await page.locator('#ml-contact').inputValue() !== 'ct-9'; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('#ml-contact')).toHaveValue('ct-9');
  await expect(page.locator('dialog.ask')).toContainText('Remplacer le texte retouché');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  await expect(page.locator('#ml-body')).toContainText('mon ajout');
  const subj = await page.locator('#ml-subj').inputValue();
  expect(subj).toBe('Confirmation Artiste Alpha');                                    // objet intact
  // autre modèle choisi puis « Annuler » : objet, texte et modèle d'avant gardés
  const keep = { subj, body: await page.locator('#ml-body').innerHTML(), tpl: await page.locator('#ml-tpl').inputValue() };
  await page.locator('#ml-tpl').focus(); await page.keyboard.press(keep.tpl === 'mt-c2' ? 'ArrowUp' : 'ArrowDown');
  await expect(page.locator('dialog.ask')).toContainText('Remplacer le texte retouché');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  expect({ subj: await page.locator('#ml-subj').inputValue(), body: await page.locator('#ml-body').innerHTML(), tpl: await page.locator('#ml-tpl').inputValue() }).toEqual(keep);
  // « Remplacer le texte » (autre modèle demandé) : le texte retouché est alors remplacé, sur accord explicite
  await page.locator('#ml-contact').focus(); await page.keyboard.press('ArrowUp');
  await expect(page.locator('dialog.ask')).toContainText('Remplacer le texte retouché');
  await page.locator('dialog.ask button', { hasText: 'Remplacer le texte' }).click();
  await expect(page.locator('#ml-body')).not.toContainText('mon ajout');
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test('v1.56 projets les plus utilisés en premier : filtre, champ « Artiste », menu « + Artistes », cases à cocher, prospection', async ({ page }) => {
  const ctx = await openApp(page);
  // Artiste Bêta : beaucoup plus de tâches que Artiste Alpha → doit passer devant partout
  await seed(page, { tasks: Array.from({ length: 30 }, (_, i) => ({ id: 'tu-' + i, title: 'T' + i, status: 'To Do', project_id: 'art-b', project_ids: ['art-b'], tags: [] })) });
  const usage = await page.evaluate(async () => Object.fromEntries((await import('./js/selectors.js')).projUsage()));
  expect(usage['art-b']).toBeGreaterThan(usage['art-a'] || 0);
  const first = ['Artiste Bêta', 'Artiste Alpha'];
  // 1. filtre artistes (en-tête des pages)
  await page.evaluate(async () => (await import('./js/app.js')).go('booking'));
  await page.locator('#f-project').locator('xpath=..').locator('.pp-btn').click();
  expect((await page.locator('.pp-items .ac-item[data-pp]:not([data-pp=""])').allInnerTexts()).map(t => t.replace(/^✓?\s*/, '').trim()).slice(0, 2)).toEqual(first);
  await page.keyboard.press('Escape');
  // 2. cases « Projet(s) » d'une tâche (projectOptions)
  await page.evaluate(async () => { (await import('./js/forms.js')).editTask(null); });
  expect((await page.locator('#modal [name=project_ids]').evaluateAll(els => els.map(e => e.closest('label').innerText.trim()))).slice(0, 2)).toEqual(first);
  await page.locator('#modal [data-act=closeModal]').first().click();
  // 3. prospection
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('st-1'); });
  expect((await page.locator('#modal .pr-arts label').allInnerTexts()).map(t => t.trim()).slice(0, 2)).toEqual(first);
  await page.locator('#modal [data-act=closeModal]').first().click();
  // 4. menu « + Artistes » d'une ligne de tableau (projmenu)
  await page.evaluate(async () => (await import('./js/app.js')).go('todo'));
  await page.locator('[data-projmenu]').first().click();
  expect((await page.locator('.pm-list .pm-item').allInnerTexts()).map(t => t.trim()).slice(0, 2)).toEqual(first);
  expectClean(ctx);
});

test('v1.56 visuel : grands montants lisibles en entier dans les factures d’une date, tableau sans défilement à 1 440 px', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) Object.assign(db.shows.find(s => s.id === 'sh-1'), { fee_ht: 1234567.89 }); touch('shows');
    const app = await import('./js/app.js'); app.go('production'); S.openProd = new Set(['sh-1']); S.tab['prod:sh-1'] = 'factures'; app.render(); });
  await expect(page.locator('.prod-bill table')).toBeVisible();
  const r = await page.evaluate(() => ({
    tronques: [...document.querySelectorAll('.prod-bill input[type=number]')].filter(i => (i.value || i.placeholder) && i.scrollWidth > i.clientWidth + 1).length,
    champs: [...document.querySelectorAll('.prod-bill input[data-f=amount_ttc]')].map(i => i.value),
    defile: (w => w.scrollWidth > w.clientWidth + 1)(document.querySelector('.prod-bill .tbl-wrap')) }));
  expect(r.champs).toContain('1302469.12');
  expect(r).toMatchObject({ tronques: 0, defile: false });
  expectClean(ctx);
});
