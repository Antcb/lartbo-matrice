// v1.60.2 — structures inactives et adresses des contacts (demandes d'Anthony). Données FICTIVES ; aucun envoi, aucune écriture attendue.
//  - relances suspendues pour les contacts liés UNIQUEMENT à des structures inactives (affichage calculé : aucune tâche modifiée) ;
//    un contact lié à au moins une structure active reste relancé ; réactiver la structure rétablit les relances ;
//  - prospection : ces contacts ne sont proposés dans la recherche de destinataires que sur demande (les mails des dates : inchangé) ;
//  - un contact se trouve par n'importe laquelle de ses adresses, et chacune de ses adresses est proposée comme destinataire.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  // chargement initial terminé d'abord : sinon il peut remplacer les données ajoutées (et refermer une fenêtre) au premier lancement
  await page.waitForFunction(() => import('./js/state.js').then(m => m.S.dataLoaded === true));
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const setInactive = (page, id, v) => page.evaluate(async ([id, v]) => { const { S, touch } = await import('./js/state.js');
  for (const db of [S.db, window.__DB]) db.structures.find(s => s.id === id).inactive_at = v; touch('structures'); (await import('./js/app.js')).render(); }, [id, v]);
const todo = (page, f) => page.evaluate(async f => { const { S } = await import('./js/state.js'); S.todoFilter = f; (await import('./js/app.js')).go('todo'); }, f);
const writes = page => page.evaluate(() => window.__calls.filter(c => ['tasks', 'prospects', 'contacts', 'contact_structures'].includes(c.table) && c.op !== 'select').length);

const PAST = '2026-01-05';
const DATA = {
  structures: [{ id: 'zf', name: 'Zz Salle fermée', city: 'Ville', inactive_at: '2026-11-01T10:00:00Z' }, { id: 'zo', name: 'Zz Salle ouverte', city: 'Ville' }],
  contacts: [
    { id: 'zc-f', display_name: 'Fanny Fermée', email: 'fanny@exemple.invalid' },
    { id: 'zc-m', display_name: 'Marc Mixte', email: 'marc@exemple.invalid' },
    { id: 'zc-b', display_name: 'Bea Deux', email: 'bea@exemple.invalid', email_2: 'bea.pro@exemple.invalid' },
    { id: 'zc-n', display_name: 'Nina Sansmail' },
  ],
  contact_structures: [{ contact_id: 'zc-f', structure_id: 'zf' }, { contact_id: 'zc-m', structure_id: 'zf' }, { contact_id: 'zc-m', structure_id: 'zo' }, { contact_id: 'zc-b', structure_id: 'zo' }],
  prospects: [
    { id: 'zp-f', name: 'Suivi', structure_id: 'zf', project_ids: ['art-a'], project_id: 'art-a', status: 'Mailed', mail_to: 'fanny@exemple.invalid', mail_thread_id: 't1', mail_sent_at: '2026-01-01T10:00:00Z' },
    { id: 'zp-m', name: 'Suivi', structure_id: 'zf', project_ids: ['art-a'], project_id: 'art-a', status: 'Mailed', mail_to: 'Marc <MARC@exemple.invalid>', mail_thread_id: 't2', mail_sent_at: '2026-01-01T10:00:00Z' },
    { id: 'zp-u', name: 'Suivi', structure_id: 'zf', project_ids: ['art-a'], project_id: 'art-a', status: 'Mailed', mail_to: 'inconnu@exemple.invalid', mail_thread_id: 't3', mail_sent_at: '2026-01-01T10:00:00Z' },
  ],
  tasks: [
    { id: 'zt-f', title: 'Relance — Fanny seule', status: 'To Do', deadline: PAST, department: 'Booking', structure_id: 'zf', prospect_id: 'zp-f', auto_kind: 'relance_mail', project_ids: ['art-a'], project_id: 'art-a', tags: [] },
    { id: 'zt-m', title: 'Relance — Marc mixte', status: 'To Do', deadline: PAST, department: 'Booking', structure_id: 'zf', prospect_id: 'zp-m', auto_kind: 'relance_tel', project_ids: ['art-a'], project_id: 'art-a', tags: [] },
    { id: 'zt-u', title: 'Relance — adresse libre', status: 'To Do', deadline: PAST, department: 'Booking', structure_id: 'zf', prospect_id: 'zp-u', auto_kind: 'relance_mail', project_ids: ['art-a'], project_id: 'art-a', tags: [] },
  ],
  shows: [{ id: 'zs-1', project_id: 'art-a', structure_id: 'zo', venue: 'Zz Salle ouverte', city: 'Ville', status: 'Confirmée Salle', contract_type: 'Cession', fee_ht: 1000, prod_mode: 'production', date: `${Y}-12-01` }],
};
const IDS = { 'Relance — Fanny seule': 'zt-f', 'Relance — Marc mixte': 'zt-m', 'Relance — adresse libre': 'zt-u' };
const row = (page, title) => page.locator('#main tbody tr', { has: page.locator(`textarea[data-t="tasks"][data-f="title"][data-id="${IDS[title]}"]`) });

test('v1.60.2 relances suspendues : contacts liés uniquement à des structures inactives ; contact mixte relancé ; réactivation = retour normal, aucune tâche modifiée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await todo(page, 'open');
  await expect(row(page, 'Relance — Fanny seule').locator('.urg')).toHaveText('Relance suspendue (structure inactive)');
  await expect(row(page, 'Relance — adresse libre').locator('.urg')).toHaveText('Relance suspendue (structure inactive)');   // destinataire inconnu : structure du suivi
  await expect(row(page, 'Relance — Marc mixte').locator('.urg')).toContainText('En retard');                              // lié aussi à une structure active
  // « Urgentes » : jamais une relance suspendue
  await todo(page, 'late');
  await expect(row(page, 'Relance — Fanny seule')).toHaveCount(0);
  await expect(row(page, 'Relance — adresse libre')).toHaveCount(0);
  await expect(row(page, 'Relance — Marc mixte')).toHaveCount(1);
  // fiche de la structure inactive : annoncé
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); app.go('structures'); S.structurePage = 'zf'; app.render(); });
  await expect(page.locator('.mode-note', { hasText: 'inactive' })).toContainText('2 relances automatiques suspendues');
  // réactivation : tout redevient normal
  await setInactive(page, 'zf', null);
  await todo(page, 'open');
  await expect(row(page, 'Relance — Fanny seule').locator('.urg')).toContainText('En retard');
  await expect(row(page, 'Relance — adresse libre').locator('.urg')).toContainText('En retard');
  // rien n'est enregistré : ni tâche, ni suivi, ni contact touché
  expect(await writes(page)).toBe(0);
  expectClean(ctx);
});

test('v1.60.2 prospection : contacts liés uniquement à des structures inactives proposés seulement sur demande ; mails des dates inchangés', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('zo'); });
  const search = page.locator('[data-rcpt-box="pr-cc"] .ac-input'), cc = page.locator('#pr-cc');
  await search.fill('exemple.invalid');
  await expect(page.locator('.ac-item', { hasText: 'fanny@exemple.invalid' })).toHaveCount(0);
  await expect(page.locator('.ac-item', { hasText: 'marc@exemple.invalid' })).toHaveCount(1);       // lié aussi à une structure active
  await expect(page.locator('.ac-item', { hasText: 'Afficher aussi 1 adresse' })).toHaveCount(1);
  // accès volontaire : l'adresse apparaît, signalée, et peut être choisie
  await page.locator('.ac-item', { hasText: 'Afficher aussi' }).dispatchEvent('mousedown');
  await expect(page.locator('.ac-item', { hasText: 'fanny@exemple.invalid' })).toContainText('structures inactives uniquement');
  await page.locator('.ac-item', { hasText: 'fanny@exemple.invalid' }).dispatchEvent('mousedown');
  await expect(cc).toHaveValue('fanny@exemple.invalid');
  await page.locator('#modal [data-act=closeModal]').first().click();
  // mail d'une date (pas une prospection) : la recherche propose tout, comme avant
  await page.evaluate(async () => { (await import('./js/mail.js')).prepareMail('zs-1', 'confirmation'); });
  await page.locator('[data-rcpt-box="ml-cc"] .ac-input').fill('fanny');
  await expect(page.locator('.ac-item', { hasText: 'fanny@exemple.invalid' })).toHaveCount(1);
  await expect(page.locator('.ac-item', { hasText: 'Afficher aussi' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expect(await writes(page)).toBe(0);
  expectClean(ctx);
});

test('v1.60.2 adresses d’un contact : trouvé par n’importe laquelle, chacune proposée ; Contacts et doublons par le 2e mail', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await page.evaluate(async () => { (await import('./js/mail.js')).prepareMail('zs-1', 'confirmation'); });
  const search = page.locator('[data-rcpt-box="ml-to"] .ac-input'), to = page.locator('#ml-to');
  // recherche par la 2e adresse : le contact est trouvé, ses deux adresses sont proposées (celle tapée d'abord)
  await search.fill('bea.pro');
  const items = page.locator('.ac-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('bea.pro@exemple.invalid');
  await expect(items.nth(1)).toContainText('bea@exemple.invalid');
  await expect(items.nth(0)).toContainText('adresse 2 sur 2');
  await items.nth(1).dispatchEvent('mousedown');
  await expect(to).toHaveValue('bea@exemple.invalid');
  // l'autre adresse s'ajoute aussi, sans doublon
  await search.fill('Bea Deux');
  await page.locator('.ac-item', { hasText: 'bea.pro@exemple.invalid' }).dispatchEvent('mousedown');
  await expect(to).toHaveValue('bea@exemple.invalid, bea.pro@exemple.invalid');
  await search.fill('Bea Deux');
  await page.locator('.ac-item', { hasText: 'bea.pro@exemple.invalid' }).dispatchEvent('mousedown');
  await expect(to).toHaveValue('bea@exemple.invalid, bea.pro@exemple.invalid');
  // contact sans adresse : trouvé, et le dit
  await search.fill('Nina');
  await page.locator('.ac-item', { hasText: 'Nina Sansmail' }).dispatchEvent('mousedown');
  await expect(page.locator('.toast.err')).toContainText('n’a pas d’adresse mail');
  await expect(to).toHaveValue('bea@exemple.invalid, bea.pro@exemple.invalid');
  await page.locator('#modal [data-act=closeModal]').first().click();
  // onglet Contacts : trouvé par sa 2e adresse
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.search.contacts = 'bea.pro@exemple'; (await import('./js/app.js')).go('contacts'); });
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Bea Deux');
  // doublons : la 2e adresse d'un contact est reconnue (majuscules et espaces ignorés)
  expect(await page.evaluate(async () => (await import('./js/selectors.js')).contactsWithMail([' BEA.PRO@exemple.invalid ']).map(c => c.id))).toEqual(['zc-b']);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});
