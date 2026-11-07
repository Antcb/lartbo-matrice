// v1.60.3 — Destinataire et Copie en champ unique (retours d'Anthony du 07/11/2026). Données FICTIVES ; aucun envoi réel.
//  - recherche dans le champ lui-même : pastilles des adresses choisies, suggestions au fil de la saisie, ajout libre ;
//  - suggestions lisibles : nom, adresse et structure ; plus de champ de recherche séparé ni de rangée de pastilles « + » ;
//  - clavier : ↑ ↓ Entrée, virgule / point-virgule / Entrée valident une adresse tapée, Retour arrière retire la dernière pastille,
//    adresse invalide jamais ajoutée et signalée ; même composant dans toutes les fenêtres de mail (dates et prospection / relance).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { window.__DB[table].push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const DATA = {
  structures: [{ id: 'sz-1', name: 'Salle Zéphyr', city: 'Ville' }, { id: 'sz-2', name: 'Festival Ailleurs', city: 'Loin' }],
  contacts: [{ id: 'cz-a', display_name: 'Alice Zéphyr', email: 'alice@exemple.invalid', email_2: 'alice.perso@exemple.invalid' },
    { id: 'cz-b', display_name: 'Bruno Ailleurs', email: 'bruno@exemple.invalid' }],
  contact_structures: [{ contact_id: 'cz-a', structure_id: 'sz-1' }, { contact_id: 'cz-b', structure_id: 'sz-2' }],
  prospects: [{ id: 'pz-1', name: 'Suivi', structure_id: 'sz-1', contact_id: 'cz-a', project_ids: ['art-a'], status: 'Mailed',
    mail_thread_id: 'th-1', mail_sent_at: `${Y}-01-05T10:00:00Z`, mail_to: 'alice@exemple.invalid, Régie <regie@exemple.invalid>', mail_subject: 'Proposition' }],
  shows: [{ id: 'sz-show', project_id: 'art-a', structure_id: 'sz-1', prospect_id: 'pz-1', venue: 'Salle Zéphyr', city: 'Ville', status: 'Confirmée Salle',
    contract_type: 'Cession', fee_ht: 1000, prod_mode: 'production', date: `${Y}-12-03` }],
  mail_templates: ['boucle_tech', 'boucle_com', 'prospection', 'relance'].map(kind => ({ id: 'mz-' + kind, project_id: 'art-a', project_ids: ['art-a'], kind,
    name: 'Modèle ' + kind, subject: 'Objet', html: '<div>Bonjour</div>', attachments: [] })),
};
const sugg = page => page.locator('.ac-list .ac-item');
const chips = (page, id) => page.locator(`[data-rcpt="${id}"] .rcpt-chip`);
// openModal donne le focus à son premier champ 30 ms après l'ouverture : on l'attend avant de taper, sinon (machine lente) ce focus
// arrive pendant la frappe et une partie du texte part ailleurs (test instable sur GitHub)
const ouverte = async page => { await expect(page.locator('#modal')).toBeVisible(); await page.evaluate(() => new Promise(r => setTimeout(r, 100))); };
const scriptCalls = page => page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length);

test('v1.60.3 champ unique : recherche dans le champ, suggestions lisibles, clavier, ajout libre, adresse invalide signalée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  await page.evaluate(async () => { (await import('./js/mail.js')).prepareMail('sz-show', 'boucle_tech'); });
  await ouverte(page);
  const to = page.locator('#ml-to'), q = page.locator('#ml-to-q');
  // plus de champ de recherche séparé ni de rangée de pastilles sous le champ ; une seule saisie par ligne
  await expect(page.locator('#modal .rcpt-sug, #modal [data-rcpt-add], #modal [data-rcpt-box]')).toHaveCount(0);
  await expect(page.locator('[data-rcpt="ml-to"] input:visible')).toHaveCount(1);
  await expect(page.locator('[data-rcpt="ml-cc"] input:visible')).toHaveCount(1);
  await expect(page.locator('label[for="ml-to-q"]')).toHaveText('Destinataire');
  while (await chips(page, 'ml-to').count()) await chips(page, 'ml-to').first().locator('.rcpt-rm').click();   // adresse du contact présélectionné
  await expect(to).toHaveValue('');
  // suggestions lisibles : nom, adresse, structure ; une ligne par adresse
  await q.fill('alice');
  await page.waitForTimeout(250);   // la recherche part 60 ms après la frappe (js/ui/autocomplete.js) : liste du texte tapé
  await expect(sugg(page)).toHaveCount(2);
  await expect(sugg(page).first().locator('span')).toHaveText('Alice Zéphyr');
  await expect(sugg(page).first().locator('small')).toContainText('alice@exemple.invalid · Salle Zéphyr');
  // ↓ puis Entrée : la 2e adresse
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(to).toHaveValue('alice.perso@exemple.invalid');
  await expect(q).toHaveValue('');
  await expect(page.locator('#modal')).toBeVisible();   // Entrée n'envoie jamais le formulaire
  // contact d'une autre structure, trouvé dans toute la base, structure affichée
  await q.fill('bruno');
  await expect(sugg(page).first().locator('small')).toContainText('Festival Ailleurs');
  await page.keyboard.press('Enter');
  await expect(chips(page, 'ml-to')).toHaveCount(2);
  await expect(chips(page, 'ml-to').last()).toContainText('Bruno Ailleurs');
  // adresse libre : Entrée (ligne « Ajouter … »), virgule, point-virgule, « Nom <adresse> »
  await q.fill('libre@exemple.invalid');
  await expect(sugg(page).first()).toContainText('Ajouter « libre@exemple.invalid »');
  await page.keyboard.press('Enter');
  await q.pressSequentially('deux@exemple.invalid,');
  await q.pressSequentially('Régie <regie@exemple.invalid>;');
  await expect(to).toHaveValue('alice.perso@exemple.invalid, bruno@exemple.invalid, libre@exemple.invalid, deux@exemple.invalid, Régie <regie@exemple.invalid>');
  await expect(chips(page, 'ml-to').last()).toContainText('Régie');
  // doublon (majuscules) : rien n'est ajouté
  await q.pressSequentially('LIBRE@exemple.invalid;');
  await expect(chips(page, 'ml-to')).toHaveCount(5);
  // adresse invalide : jamais ajoutée, message sous le champ, et l'envoi est bloqué
  await q.pressSequentially('pas-une-adresse,');
  await expect(chips(page, 'ml-to')).toHaveCount(5);
  await expect(q).toHaveValue('pas-une-adresse');
  await expect(page.locator('[data-rcpt="ml-to"] .help.err')).toHaveText('Adresse mail invalide : vérifie le @ et le domaine');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal')).toBeVisible();
  expect(await scriptCalls(page)).toBe(0);
  // Retour arrière : d'abord la saisie, puis la dernière pastille
  await q.fill(''); await q.press('Backspace');
  await expect(chips(page, 'ml-to')).toHaveCount(4);
  await expect(to).not.toHaveValue(/regie/);
  await expect(page.locator('[data-rcpt="ml-to"] .help.err')).toHaveCount(0);
  // retour dans le champ vide : adresses de la structure du mail non encore choisies
  await page.locator('#ml-subj').focus(); await page.waitForTimeout(300);   // fermeture différée de la liste en quittant le champ
  await q.focus();
  await expect(sugg(page)).toHaveCount(1);
  await expect(sugg(page).first()).toContainText('alice@exemple.invalid');
  await page.keyboard.press('Escape');
  expectClean(ctx);
});

test('v1.60.3 même composant partout : confirmation, boucles, prospection, relance ; adresse tapée prise à l’envoi', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, DATA);
  const check = async (ids) => { for (const id of ids) {
    await expect(page.locator(`[data-rcpt="${id}"].tagpick.rcpt-field`)).toHaveCount(1);
    await expect(page.locator(`#${id}-q.ac-input`)).toBeVisible();
    await expect(page.locator(`#${id}`)).toBeHidden();
  } };
  for (const kind of ['confirmation', 'boucle_tech', 'boucle_com']) {
    await page.evaluate(async k => { (await import('./js/mail.js')).prepareMail('sz-show', k); }, kind);
    await check(['ml-to', 'ml-cc']);
    await page.locator('#modal [data-act=closeModal]').first().click();
  }
  // relance : les adresses du mail de prospection reviennent en pastilles (nom repris de la base ou de « Nom <adresse> »)
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('sz-1', {prospectId: 'pz-1'}); });
  await expect(page.locator('#modal')).toBeVisible();
  await check(['pr-to', 'pr-cc']);
  await page.locator('#modal [data-act=closeModal]').first().click();
  // prospection : adresse tapée sans validation → ajoutée au moment d'envoyer (puis les contrôles suivants de la fenêtre)
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('sz-1'); });
  await ouverte(page);
  await check(['pr-to', 'pr-cc']);
  await page.locator('#pr-cc-q').fill('copie@exemple.invalid');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#pr-cc')).toHaveValue('copie@exemple.invalid');
  await expect(chips(page, 'pr-cc')).toHaveCount(1);
  await expect(page.locator('.toast').last()).toContainText('Coche au moins un artiste');
  expect(await scriptCalls(page)).toBe(0);
  expectClean(ctx);
});

// Décision d'Anthony du 07/11 : ligne « Interlocuteur » distincte ; jamais déduit de la première pastille ; une adresse qui identifie
// un seul contact propose « Utiliser X comme interlocuteur », sans jamais écraser un choix existant.
test('v1.60.3 interlocuteur : proposé depuis une adresse sans ambiguïté, jamais pris ni écrasé d’office', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { ...DATA,
    contacts: [...DATA.contacts, { id: 'cz-c', display_name: 'Chloé Zéphyr', email: 'chloe@exemple.invalid' },
      { id: 'cz-d1', display_name: 'Doublon Un', email: 'partage@exemple.invalid' }, { id: 'cz-d2', display_name: 'Doublon Deux', email: 'partage@exemple.invalid' }],
    contact_structures: [...DATA.contact_structures, { contact_id: 'cz-c', structure_id: 'sz-1' }, { contact_id: 'cz-d1', structure_id: 'sz-1' }, { contact_id: 'cz-d2', structure_id: 'sz-1' }],
    shows: [...DATA.shows, { ...DATA.shows[0], id: 'sz-show2', prospect_id: null, date: `${Y}-12-04` }] });
  await page.evaluate(async () => { (await import('./js/mail.js')).prepareMail('sz-show2', 'confirmation'); });
  await ouverte(page);
  const who = page.locator('#ml-contact'), to = page.locator('#ml-to'), q = page.locator('#ml-to-q'), use = page.locator('#modal [data-rcpt-use]');
  await expect(page.locator('label[for="ml-contact"]')).toHaveText('Interlocuteur');
  await expect(who).toHaveValue('');
  // adresse ambiguë (deux contacts) : rien n'est proposé ; puis une adresse d'Alice : proposée, pas appliquée
  await q.pressSequentially('partage@exemple.invalid;');
  await expect(use).toHaveCount(0);
  await q.pressSequentially('alice.perso@exemple.invalid;');
  await expect(use).toHaveText('Utiliser Alice Zéphyr comme interlocuteur');
  await expect(who).toHaveValue('');
  // clic : interlocuteur choisi, destinataires inchangés (ordre compris)
  await use.click();
  await expect(who).toHaveValue('cz-a');
  await expect(to).toHaveValue('partage@exemple.invalid, alice.perso@exemple.invalid');
  await expect(use).toHaveCount(0);
  await expect(page.locator('#modal .rcpt-note')).toHaveCount(0);
  // une autre personne ajoutée : proposée, mais l'interlocuteur choisi reste ; retirée : la proposition disparaît
  await q.pressSequentially('chloe@exemple.invalid;');
  await expect(use).toHaveText('Utiliser Chloé Zéphyr comme interlocuteur');
  await expect(who).toHaveValue('cz-a');
  await chips(page, 'ml-to').filter({ hasText: 'chloe@' }).locator('.rcpt-rm').click();
  await expect(use).toHaveCount(0);
  await expect(who).toHaveValue('cz-a');
  expect(await scriptCalls(page)).toBe(0);
  expectClean(ctx);
});
