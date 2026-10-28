// Lot V1.52 — délivrabilité des e-mails (décisions d'Anthony du 27/10/2026) : circuits Gmail / scripts Google inchangés.
//  - premier mail de prospection : pièces jointes du modèle non cochées d'office ; taille affichée ; avertissement au-delà de 5 Mo ;
//  - zones « [… à compléter] » contrôlées aussi en prospection ;
//  - scripts Google (fonctions pures, rejouées ici) : version texte qui garde les liens ; relances qui gardent tout l’historique cité (décision du 27/10 au soir).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, expectClean } from './helpers.js';

const TPL = { id: 'mt-p', kind: 'prospection', name: 'Prospection (test)', subject: 'Proposition {{artistes}}', html: '<div>Bonjour</div>',
  attachments: [{ path: 'mails/modeles/dossier.pdf', name: 'Dossier.pdf', size: 4 * 1048576 }, { id: 'drive-1', url: 'https://exemple.invalid/d', name: 'Fiche technique' }] };
async function seedTpl(page) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js'); window.__DB.mail_templates.push(structuredClone(t)); S.db.mail_templates.push(structuredClone(t)); touch('mail_templates'); }, TPL);
}

test('v1.52 premier mail de prospection : pièces jointes du modèle non cochées ; taille affichée ; lourd → question avant l’envoi', async ({ page }) => {
  const ctx = await openApp(page);
  await seedTpl(page);
  await page.evaluate(async () => { (await import('./js/prospection.js')).openProspection('st-1'); });
  await page.locator('#pr-tpl').selectOption('mt-p');
  const boxes = page.locator('#pr-files input[type=checkbox]');
  await expect(boxes).toHaveCount(2);
  for (const b of await boxes.all()) await expect(b).not.toBeChecked();
  await expect(page.locator('#pr-files')).not.toContainText('Mo');
  // on coche les deux : 4 Mo connus + un fichier Drive de taille inconnue
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await expect(page.locator('#pr-files')).toContainText(/2 cochées · 4 Mo \(\+ 1 de taille inconnue\)/);
  const r = await page.evaluate(async () => { const m = await import('./js/mail.js');
    return [m.attSize([{ on: true, size: 6 * 1048576 }, { on: false, size: 9e9 }]).mb, m.todoLeft({ html: '<span>[date à compléter]</span>' }), m.todoLeft({ html: 'ok', subject: 'Objet' })]; });
  expect(r).toEqual([6, true, false]);
  expectClean(ctx);
});

test('v1.52 prospection : zones à compléter et pièces jointes lourdes → question ; « Annuler » n’envoie rien', async ({ page }) => {
  const ctx = await openApp(page);
  await seedTpl(page);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    const t = S.db.mail_templates.find(x => x.id === 'mt-p'); t.attachments = [t.attachments[0], { path: 'mails/modeles/photos.zip', name: 'Photos.zip', size: 2 * 1048576 }]; touch('mail_templates');
    (await import('./js/prospection.js')).openProspection('st-1'); });
  await page.locator('#pr-tpl').selectOption('mt-p');
  await page.locator('#modal [data-pr-art]').first().evaluate(c => { if (!c.checked) c.click(); });
  await page.locator('#pr-subj').fill('Proposition [artistes à compléter]');
  await page.locator('#modal button[type=submit]').first().click();
  await expect(page.locator('dialog.ask')).toContainText('Il reste des zones à compléter');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  // pièces jointes lourdes : 4 Mo + 2 Mo cochés → question
  await page.locator('#pr-subj').fill('Proposition');
  for (const b of await page.locator('#pr-files input[type=checkbox]').all()) await b.check();
  await expect(page.locator('#pr-files')).toContainText('6 Mo : lourd pour un mail');
  await page.locator('#modal button[type=submit]').first().click();
  await expect(page.locator('dialog.ask')).toContainText('Les pièces jointes cochées pèsent 6 Mo');
  await page.locator('dialog.ask button', { hasText: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'script-google').length)).toBe(0);
  expectClean(ctx);
});

test('v1.52 scripts Google : version texte avec les liens ; relance qui garde tout l’historique', async ({ page }) => {
  const ctx = await openApp(page);
  const src = ['Prospection.gs', 'Code.gs'].map(f => readFileSync(new URL(`../../apps-script/${f}`, import.meta.url), 'utf8'));
  const pick = (s, name) => { const i = s.indexOf(`function ${name}(`); let d = 0, j = s.indexOf('{', i);
    for (; j < s.length; j++){ if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } return s.slice(i, j + 1); };
  for (const s of src) {
    const out = await page.evaluate(code => { const f = new Function(code + '; return {plain_};')();
      const extra = [f.plain_('<a href="">rien</a> &#99999999; &#0; &#128512;')];
      return [
        f.plain_('<div>Bonjour&nbsp;Camille,</div><p>Voir <a href="https://exemple.fr/dossier">le dossier</a> et <a href="mailto:a@b.fr">a@b.fr</a>.</p><ul><li>Un</li><li>Deux &amp; trois</li></ul><style>.x{}</style>'),
      ].concat(extra); }, pick(s, 'cp_') + '\n' + pick(s, 'plain_'));
    expect(out[0]).toBe('Bonjour Camille,\nVoir le dossier (https://exemple.fr/dossier) et a@b.fr.\n\n- Un\n- Deux & trois');
    // lien sans adresse : le texte seul ; entité invalide gardée telle quelle, jamais d'erreur
    expect(out[1]).toBe('rien &#99999999; &#0; 😀');
    // relances : l'historique cité reste entier (27/10 au soir)
    expect(s).toContain("+ last.getBody() + '</blockquote></div>'");
    expect(s).not.toContain('lastOnly_');
  }
  expectClean(ctx);
});
