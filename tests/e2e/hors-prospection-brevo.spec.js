// Décision d'Anthony du 08/11/2026 (option B) — contact devenu « sans structure » après le retrait de sa dernière structure inactive :
// marqué par la base (contacts.hors_prospection_at), il reste HORS PROSPECTION (proposé seulement sur demande dans la recherche de
// destinataires d'une prospection), comme un contact lié uniquement à des structures inactives ; un contact créé sans structure
// (non marqué) reste proposé normalement. Données FICTIVES ; aucun envoi, aucune écriture.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

async function seed(page, tables) {
  await page.waitForFunction(() => import('./js/state.js').then(m => m.S.dataLoaded === true));
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const writes = page => page.evaluate(() => window.__calls.filter(c => ['tasks', 'prospects', 'contacts', 'contact_structures'].includes(c.table) && c.op !== 'select').length);
const DATA = {
  structures: [{ id: 'hp-o', name: 'Hp Salle ouverte', city: 'Ville' }],
  contacts: [
    { id: 'hp-m', display_name: 'Mona Marquée', email: 'mona@exemple.invalid', hors_prospection_at: '2026-11-08T10:00:00Z' },
    { id: 'hp-s', display_name: 'Sam Sansstructure', email: 'sam@exemple.invalid' },
    { id: 'hp-r', display_name: 'Rita Rattachée', email: 'rita@exemple.invalid', hors_prospection_at: '2026-11-08T10:00:00Z' },
  ],
  contact_structures: [{ contact_id: 'hp-r', structure_id: 'hp-o' }],
};

test('option B : contact sans structure marqué hors prospection proposé seulement sur demande ; créé sans structure et rattaché à une structure active : proposés', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  // règle JS = règle de brevo-sync (regles.ts) : marqué et sans structure → hors prospection ; une structure active l'emporte
  expect(await page.evaluate(async () => { const { horsProspection } = await import('./js/selectors.js'); const { S } = await import('./js/state.js');
    return ['hp-m', 'hp-s', 'hp-r'].map(id => horsProspection(S.db.contacts.find(c => c.id === id))); })).toEqual([true, false, false]);
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('hp-o'); });
  const search = page.locator('#pr-cc-q');
  await expect(search).toBeVisible(); await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
  await search.fill('exemple.invalid');
  await expect(page.locator('.ac-item', { hasText: 'sam@exemple.invalid' })).toHaveCount(1);
  await expect(page.locator('.ac-item', { hasText: 'rita@exemple.invalid' })).toHaveCount(1);
  await expect(page.locator('.ac-item', { hasText: 'mona@exemple.invalid' })).toHaveCount(0);
  await expect(page.locator('.ac-item', { hasText: 'Afficher aussi 1 adresse de contacts hors prospection' })).toHaveCount(1);
  await page.locator('.ac-item', { hasText: 'Afficher aussi' }).dispatchEvent('mousedown');
  await expect(page.locator('.ac-item', { hasText: 'mona@exemple.invalid' })).toContainText('hors prospection (structure inactive retirée)');
  await page.locator('#modal [data-act=closeModal]').first().click();
  expect(await writes(page)).toBe(0);
  expectClean(ctx);
});

// Décisions d'Anthony du 09/11/2026 : exclusion MANUELLE, explicite et tracée, sur la fiche contact ; un rattachement actif ne la lève pas.
test('fiche contact : « Exclure de la prospection » / « Remettre en prospection » avec motif, état affiché, un seul chemin d’écriture', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await page.evaluate(async () => { (await import('./js/forms.js')).editContact('hp-s'); });
  const bloc = page.locator('#ct-prosp');
  await expect(bloc).toContainText('Prospection : En prospection.');
  await expect(bloc).toContainText('Le désabonnement Brevo n’est jamais modifié');
  await expect(bloc.locator('button', { hasText: 'Remettre en prospection' })).toHaveCount(0);
  // exclusion : motif obligatoire (fenêtre de l'application, jamais une fenêtre native)
  await bloc.locator('button', { hasText: 'Exclure de la prospection' }).click();
  const dlg = page.locator('dialog.ask[open]');
  await expect(dlg).toContainText('Un rattachement à une structure ne le remet pas en prospection');
  await dlg.locator('button', { hasText: 'Exclure de la prospection' }).click();
  await expect(dlg.locator('.help.err')).toHaveText('À remplir');
  await dlg.locator('#ask-input').fill('A demandé à ne plus être sollicité');
  await dlg.locator('button', { hasText: 'Exclure de la prospection' }).click();
  await expect(bloc).toContainText('Exclu de la prospection par l’équipe depuis le');
  await expect(bloc).toContainText('par testeur@example.com : « A demandé à ne plus être sollicité »');
  await expect(bloc.locator('button', { hasText: 'Exclure de la prospection' })).toHaveCount(0);
  const calls = await page.evaluate(() => window.__calls.filter(c => c.rpc === 'set_prospection').map(c => c.args));
  expect(calls).toEqual([{ p_contact: 'hp-s', p_exclure: true, p_motif: 'A demandé à ne plus être sollicité' }]);
  // exclu manuellement : hors prospection même rattaché à une structure active (le rattachement ne lève que l'exclusion automatique)
  expect(await page.evaluate(async () => { const { S } = await import('./js/state.js'); const { horsProspection } = await import('./js/selectors.js');
    S.db.contact_structures.push({ contact_id: 'hp-s', structure_id: 'hp-o' }); (await import('./js/state.js')).touch('contact_structures');
    return horsProspection(S.db.contacts.find(c => c.id === 'hp-s')); })).toBe(true);
  // remise en prospection : motif, tracée
  await bloc.locator('button', { hasText: 'Remettre en prospection' }).click();
  await expect(dlg).toContainText('Un désabonnement Brevo reste toujours en place');
  await dlg.locator('#ask-input').fill('Erreur de saisie');
  await dlg.locator('button', { hasText: 'Remettre en prospection' }).click();
  await expect(bloc).toContainText('Prospection : En prospection.');
  const hist = await page.evaluate(async () => { const { S } = await import('./js/state.js'); return S.db.contacts.find(c => c.id === 'hp-s').prospection_history.map(e => [e.action, e.origine, e.par, e.motif]); });
  expect(hist).toEqual([['exclusion', 'manuelle', 'testeur@example.com', 'A demandé à ne plus être sollicité'], ['remise', 'manuelle', 'testeur@example.com', 'Erreur de saisie']]);
  // aucune écriture directe des colonnes de prospection : seulement la fonction serveur
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'contacts' && c.op !== 'select').length)).toBe(0);
  await page.locator('#modal [data-act=closeModal]').first().click();
  expectClean(ctx);
});

test('fiche contact : exclusion automatique (structure) affichée avec son motif ; « Remettre en prospection » proposé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { contacts: [{ id: 'hp-a', display_name: 'Ali Auto', email: 'ali@exemple.invalid', hors_prospection_at: '2026-11-08T10:00:00Z',
    prospection_history: [{ at: '2026-11-08T10:00:00Z', action: 'exclusion', origine: 'structure', par: 'automatique', motif: 'Structure inactive supprimée : Salle Z' }] }] });
  await page.evaluate(async () => { (await import('./js/forms.js')).editContact('hp-a'); });
  const bloc = page.locator('#ct-prosp');
  await expect(bloc).toContainText('Hors prospection depuis le 08/11/2026 : Structure inactive supprimée : Salle Z. Il y revient s’il est rattaché à une structure active.');
  await expect(bloc.locator('button', { hasText: 'Remettre en prospection' })).toHaveCount(1);
  await expect(bloc.locator('button', { hasText: 'Exclure de la prospection' })).toHaveCount(1);
  await page.locator('#modal [data-act=closeModal]').first().click();
  expectClean(ctx);
});

// Marche d'essai Brevo réel (09/11/2026) : le mode essai (réglage brevo_essai_emails) est visible dans Réglages › Brevo
test('Réglages › Brevo : mode essai signalé avec ses adresses ; absent sans le réglage', async ({ page }) => {
  const ctx = await openApp(page);
  await page.waitForFunction(() => import('./js/state.js').then(m => m.S.dataLoaded === true));
  await page.evaluate(async () => (await import('./js/app.js')).go('settings'));
  await expect(page.locator('#main')).not.toContainText('Mode essai Brevo actif');
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    S.db.settings.push({ key: 'brevo_essai_emails', value: 'prenom+essai@exemple.invalid' }); touch('settings'); (await import('./js/app.js')).render(); });
  await expect(page.locator('#main')).toContainText('Mode essai Brevo actif');
  await expect(page.locator('#main')).toContainText('seules ces adresses sont synchronisées : prenom+essai@exemple.invalid');
  // relecture B2 : rempli sans adresse valide → tout est bloqué, annoncé ; adresses retenues nettoyées (nom, chevrons)
  const poser = v => page.evaluate(async v => { const { S, touch } = await import('./js/state.js');
    S.db.settings.find(x => x.key === 'brevo_essai_emails').value = v; touch('settings'); (await import('./js/app.js')).render(); }, v);
  for (const v of ['ADRESSE+essai@DOMAINE', 'prenom+essai@gmail,com', { a: 1 }]) {
    await poser(v);
    await expect(page.locator('#main')).toContainText('Mode essai Brevo actif');
    await expect(page.locator('#main')).toContainText('aucune adresse valide : tout est bloqué, aucun contact n’est synchronisé');
  }
  await poser('Prénom <Prenom+Essai@Exemple.fr>');
  await expect(page.locator('#main')).toContainText('seules ces adresses sont synchronisées : prenom+essai@exemple.fr.');
  // même règle que brevo-sync (regles.ts) : listeEssaiBrevo
  expect(await page.evaluate(async () => { const { listeEssaiBrevo } = await import('./js/selectors.js');
    return [listeEssaiBrevo(''), listeEssaiBrevo(null), listeEssaiBrevo('ADRESSE+essai@DOMAINE'), listeEssaiBrevo(' A+essai@X.fr ; b@y.org')]; }))
    .toEqual([null, null, [], ['a+essai@x.fr', 'b@y.org']]);
  expectClean(ctx);
});
