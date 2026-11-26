// v1.68.3 — brouillons propres à leur objet pour les trois fenêtres à risque élevé (décision d'Anthony du 26/11/2026) :
// « Fiche de renseignements » (valeurs retenues = contrat), mails de date (destinataires, objet, texte), « Sur quel compte ce paiement
// est-il arrivé ? » (jamais de compte supposé). Pour chacune : une saisie abandonnée revient sur LE MÊME objet ; un autre objet n'en
// récupère rien, ni depuis l'ancien brouillon partagé (clé « …new » d'avant la v1.68.3). Données FICTIVES ; aucun envoi.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
/** Le brouillon d'une fenêtre est suivi 60 ms après son ouverture, puis réappliqué à 400, 1 200 et 2 500 ms (ui/drafts.js) */
const SUIVI = 250, REAPPLIQUE = 2800;
const m = page => page.locator('#modal');
const fermer = async page => { await m(page).locator('[data-act="closeModal"]').last().click(); await expect(m(page)).not.toBeVisible(); };
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
/** Ancien brouillon PARTAGÉ (clé d'avant la v1.68.3, sans identifiant), tel que le navigateur a pu le garder */
const ancienBrouillon = (page, titre, d) => page.evaluate(async ([titre, d]) => {
  const { ENV } = await import('./js/config.js'); const { localSet } = await import('./js/storage.js');
  localSet('draft.modal.1.' + titre + '.new', JSON.stringify({ ...d, env: ENV }));
}, [titre, d]);

// deux dates dans la MÊME salle (le titre des fenêtres ne contient que la salle)
const DATA = {
  structures: [{ id: 'sf-1', name: 'Salle Fictive', city: 'Ville' }],
  contacts: [{ id: 'cf-a', display_name: 'Alice Fictive', email: 'alice@exemple.invalid' }],
  contact_structures: [{ contact_id: 'cf-a', structure_id: 'sf-1' }],
  shows: [1, 2].map(i => ({ id: `df-${i}`, project_id: 'art-a', structure_id: 'sf-1', venue: 'Salle Fictive', city: 'Ville', status: 'Confirmée Salle',
    contract_type: 'Cession', fee_ht: 1000, prod_mode: 'production', date: `${Y}-12-0${i + 2}`, conf_contact_id: 'cf-a' })),
  show_payments: [1, 2].map(i => ({ id: `pf-${i}`, show_id: `df-${i}`, kind: 'acompte', label: 'Acompte', pct: 30, amount: 300, sort: 1 })),
  mail_templates: [{ id: 'mf-boucle', project_id: 'art-a', project_ids: ['art-a'], kind: 'boucle_tech', name: 'Boucle fictive', subject: 'Objet du modèle', html: '<div>Bonjour</div>', attachments: [] }],
};

test('v1.68.3 « Fiche de renseignements » : valeur retenue abandonnée → revient sur la même date, jamais sur une autre date de la même salle', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  const ouvrir = id => page.evaluate(async i => { (await import('./js/contract.js')).validateFiche(i); }, id);
  await ouvrir('df-1');
  await expect(m(page)).toContainText('Fiche de renseignements');
  const champ = m(page).locator('.vf-table input[name]').first();
  const nom = await champ.getAttribute('name');
  const initial = await champ.inputValue();
  await page.waitForTimeout(SUIVI);
  await champ.fill('VALEUR-DATE-1');
  await fermer(page);
  // ancien brouillon partagé (même titre, sans date) : jamais lu
  await ancienBrouillon(page, 'Fiche de renseignements · Salle Fictive', { f: { [nom]: 'ANCIEN-PARTAGÉ' }, h: {} });
  await ouvrir('df-2');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator(`.vf-table [name="${nom}"]`)).toHaveValue(initial);
  await expect(m(page).locator('.draft-bar')).toHaveCount(0);
  await fermer(page);
  // même date : la saisie revient
  await ouvrir('df-1');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator(`.vf-table [name="${nom}"]`)).toHaveValue('VALEUR-DATE-1');
  await expect(m(page).locator('.draft-bar')).toBeVisible();
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'shows' && c.op === 'update').length)).toBe(0);   // rien d'enregistré
  expectClean(ctx);
});

test('v1.68.3 mail de date : objet et texte abandonnés → reviennent sur le même mail de la même date, jamais sur une autre date de la même salle', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  const ouvrir = id => page.evaluate(async i => { (await import('./js/mail.js')).prepareMail(i, 'boucle_tech'); }, id);
  await ouvrir('df-1');
  await expect(m(page).locator('#ml-subj')).toHaveValue('Objet du modèle');
  await page.waitForTimeout(SUIVI);
  await m(page).locator('#ml-subj').fill('OBJET-DATE-1');
  await m(page).locator('#ml-body').evaluate(e => { e.innerHTML = '<div>TEXTE-DATE-1</div>'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await fermer(page);
  await ancienBrouillon(page, 'Boucle accueil & technique · Salle Fictive', { f: { '#ml-subj': 'ANCIEN-PARTAGÉ' }, h: { 'ml-body': '<div>ANCIEN-PARTAGÉ</div>' } });
  await ancienBrouillon(page, (await page.evaluate(async () => (await import('./js/mail.js')).MAIL_KINDS?.boucle_tech)) + ' · Salle Fictive',
    { f: { '#ml-subj': 'ANCIEN-PARTAGÉ' }, h: { 'ml-body': '<div>ANCIEN-PARTAGÉ</div>' } });
  await ouvrir('df-2');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('#ml-subj')).toHaveValue('Objet du modèle');
  await expect(m(page).locator('#ml-body')).not.toContainText('TEXTE-DATE-1');
  await expect(m(page).locator('#ml-body')).not.toContainText('ANCIEN-PARTAGÉ');
  await expect(m(page).locator('.draft-bar')).toHaveCount(0);
  await fermer(page);
  await ouvrir('df-1');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('#ml-subj')).toHaveValue('OBJET-DATE-1');
  await expect(m(page).locator('#ml-body')).toContainText('TEXTE-DATE-1');
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);   // aucun envoi, aucun brouillon Gmail
  expectClean(ctx);
});

test('v1.68.3 « Sur quel compte ce paiement est-il arrivé ? » : compte abandonné → revient sur le même paiement, jamais présélectionné sur un autre', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  const payer = (id, d) => page.evaluate(async ([i, d]) => { const { ACTIONS } = await import('./js/actions.js');
    ACTIONS['change:show_payments.paid_at']({ dataset: { id: i } }, d); }, [id, d]);
  await payer('pf-1', `${Y}-01-10`);
  await expect(m(page)).toBeVisible();
  await expect(m(page)).toContainText('Sur quel compte');
  await page.waitForTimeout(SUIVI);
  await m(page).locator('select[name=payee]').selectOption('artbo');
  await fermer(page);
  await ancienBrouillon(page, 'Sur quel compte ce paiement est-il arrivé ?', { f: { payee: 'artiste' }, h: {} });
  await payer('pf-2', `${Y}-01-11`);
  await expect(m(page)).toBeVisible();
  await expect(m(page)).toContainText('Sur quel compte');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('select[name=payee]')).toHaveValue('');   // aucun compte supposé
  await expect(m(page).locator('.draft-bar')).toHaveCount(0);
  await fermer(page);
  // même paiement (toujours sans compte) : le choix abandonné revient, signalé
  await payer('pf-1', `${Y}-01-12`);
  // date de paiement déjà notée : sa modification est confirmée d'abord (règle existante)
  const ask = page.locator('dialog.ask[open]', { hasText: 'Modifier la date' });
  await expect(ask).toBeVisible();
  await ask.locator('button.primary, button.btn-primary').last().click();
  await expect(m(page)).toBeVisible();
  await expect(m(page)).toContainText('Sur quel compte');
  await page.waitForTimeout(REAPPLIQUE);
  await expect(m(page).locator('select[name=payee]')).toHaveValue('artbo');
  await expect(m(page).locator('.draft-bar')).toBeVisible();
  await fermer(page);
  const payees = await page.evaluate(() => window.__DB.show_payments.filter(p => p.id.startsWith('pf-')).map(p => p.payee ?? null));
  expect(payees).toEqual([null, null]);   // rien enregistré sans « Enregistrer le compte »
  expectClean(ctx);
});
