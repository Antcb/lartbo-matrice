// v1.60.4 — retours d'Anthony du 08/11/2026 après essai de la v1.60.3. Données FICTIVES ; aucun envoi.
//  - Éditeurs de mail (prospection, relance, mails des dates dont la confirmation) : une ligne lisible par champ ; libellé à gauche et
//    champ à droite sur ordinateur (1 280 / 1 440 px), libellé au-dessus sur téléphone (390 px) ; menus, saisies, date et destinataires
//    à la même hauteur et alignés ; pastilles, recherche dans le champ et saisie libre conservées.
//  - Budget « Payé par » : le nom du compte choisi se lit en entier (deux lignes au plus, nom complet en info-bulle et nom accessible),
//    sans élargir le tableau ni couper les montants.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
async function seed(page, tables) {
  await page.evaluate(async t => { const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) { for (const r of rows) { (window.__DB[table] ||= []).push(structuredClone(r)); (S.db[table] ||= []).push(structuredClone(r)); } touch(table); } }, tables);
}
const DATA = {
  structures: [{ id: 'sz-1', name: 'Salle Zéphyr', city: 'Ville' }],
  contacts: [{ id: 'cz-a', display_name: 'Alice Zéphyr', email: 'alice@exemple.invalid', email_2: 'alice.perso@exemple.invalid' }, { id: 'cz-b', display_name: 'Bruno Zéphyr', email: 'bruno@exemple.invalid' }],
  contact_structures: [{ contact_id: 'cz-a', structure_id: 'sz-1' }, { contact_id: 'cz-b', structure_id: 'sz-1' }],
  prospects: [{ id: 'pz-1', name: 'Suivi', structure_id: 'sz-1', contact_id: 'cz-a', project_ids: ['art-a'], status: 'Mailed',
    mail_thread_id: 'th-1', mail_sent_at: `${Y}-01-05T10:00:00Z`, mail_to: 'alice@exemple.invalid', mail_subject: 'Proposition' }],
  shows: [{ id: 'sz-show', project_id: 'art-a', structure_id: 'sz-1', venue: 'Salle Zéphyr', city: 'Ville', status: 'Confirmée Salle', contract_type: 'Cession', fee_ht: 1000, prod_mode: 'production', date: `${Y}-12-03` }],
  mail_templates: ['boucle_tech', 'prospection', 'relance'].map(kind => ({ id: 'mz-' + kind, project_id: 'art-a', project_ids: ['art-a'], kind, name: 'Modèle ' + kind, subject: 'Objet', html: '<div>Bonjour</div>', attachments: [] })),
};
const ouverte = async page => { await expect(page.locator('#modal')).toBeVisible(); await page.evaluate(() => new Promise(r => setTimeout(r, 120))); };
const open = (page, kind) => page.evaluate(async k => {
  if (k === 'prospection') return void (await import('./js/prospection.js')).openProspection('sz-1');
  if (k === 'relance') return void (await import('./js/prospection.js')).openProspection('sz-1', { prospectId: 'pz-1' });
  return void (await import('./js/mail.js')).prepareMail('sz-show', k);
}, kind);
// libellé → son champ (élément suivant dans la grille) : boîte du champ visible (menu, saisie, cadre des destinataires, date)
const rows = page => page.evaluate(() => [...document.querySelectorAll('#modal .mail-grid > label:not([hidden])')].map(l => {
  const box = l.nextElementSibling, R = e => e.getBoundingClientRect();
  const ctrl = box.matches('select,input') ? box : box.querySelector(':scope > select, .dt, .tagpick') || box;
  const c = R(ctrl), lb = R(l), span = document.createRange(); span.selectNodeContents(l); const t = span.getBoundingClientRect();
  return { label: l.textContent.trim(), lLeft: lb.left, lRight: t.right, lMid: (t.top + t.bottom) / 2, lBottom: t.bottom,
    cLeft: c.left, cRight: c.right, cTop: c.top, cH: c.height, chips: ctrl.querySelectorAll?.('.rcpt-chip').length || 0, tag: ctrl.tagName + '.' + ctrl.className };
}));

for (const [w, h, opts] of [[1440, 900, {}], [1280, 800, {}], [390, 844, { hasTouch: true, isMobile: true }]]) test.describe(`${w} px`, () => {
  test.use({ viewport: { width: w, height: h }, ...opts });
  for (const kind of ['prospection', 'relance', 'boucle_tech', 'confirmation']) test(`v1.60.4 éditeur ${kind} : une ligne par champ, libellés et champs alignés (${w} px)`, async ({ page }) => {
    const ctx = await openApp(page);
    await seed(page, DATA);
    await open(page, kind);
    await ouverte(page);
    const r = await rows(page);
    const want = kind === 'prospection' ? ['Interlocuteur', 'Destinataire', 'Copie', 'Objet', 'Date proposée'] : kind === 'relance' ? ['Interlocuteur', 'Destinataire', 'Copie'] : ['Interlocuteur', 'Destinataire', 'Copie', 'Objet'];
    for (const n of want) expect(r.map(x => x.label), `ligne « ${n} »`).toContain(n);
    const H = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(matchMedia('(pointer:coarse)').matches ? '--h-touch' : '--h')));
    const left0 = Math.min(...r.map(x => x.lLeft)), cLeft0 = r[0].cLeft, cRight0 = Math.max(...r.map(x => x.cRight));
    for (const x of r) {
      const m = JSON.stringify(x);
      expect(Math.abs(x.lLeft - left0), `libellés alignés à gauche ${m}`).toBeLessThanOrEqual(1);
      if (w > 760) {
        // ordinateur : libellé à gauche, champ à droite, sur la même ligne (libellé centré sur la hauteur d'un champ)
        expect(Math.abs(x.cLeft - cLeft0), `champs alignés à gauche ${m}`).toBeLessThanOrEqual(1);
        expect(x.lRight, `libellé à gauche de son champ ${m}`).toBeLessThan(x.cLeft);
        expect(Math.abs(x.lMid - (x.cTop + Math.min(x.cH, H) / 2)), `libellé sur la ligne de son champ ${m}`).toBeLessThanOrEqual(3);
      } else {
        // téléphone : libellé au-dessus du champ, même bord gauche
        expect(x.lBottom, `libellé au-dessus ${m}`).toBeLessThanOrEqual(x.cTop + 1);
        expect(Math.abs(x.cLeft - x.lLeft), `champ sous son libellé ${m}`).toBeLessThanOrEqual(1);
      }
      // Interlocuteur, Destinataire, Copie, Objet : pleine largeur, même bord droit ; tous les champs à la hauteur standard
      if (['Interlocuteur', 'Destinataire', 'Copie', 'Objet'].includes(x.label)) expect(Math.abs(x.cRight - cRight0), `même bord droit ${m}`).toBeLessThanOrEqual(1);
      // un cadre de destinataires qui porte des pastilles grandit d'une ligne par rangée de pastilles : au moins la hauteur d'un champ
      if (x.chips) expect(x.cH, `hauteur d'un champ au moins ${m}`).toBeGreaterThanOrEqual(H - 1);
      else if (!/^(Artiste|Envoyé par)/.test(x.label)) expect(Math.abs(Math.round(x.cH) - H), `hauteur d'un champ ${m}`).toBeLessThanOrEqual(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await page.screenshot({ path: test.info().outputPath(`${kind}-${w}.png`) });
    // pastilles, recherche dans le champ et saisie libre : inchangées
    const cc = page.locator('[id$="-cc-q"]');
    await cc.fill('bruno');
    await expect(page.locator('.ac-list .ac-item').first()).toContainText('Bruno Zéphyr');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-rcpt$="-cc"] .rcpt-chip')).toHaveCount(1);
    await cc.fill('libre@exemple.invalid'); await page.keyboard.press('Enter');
    await expect(page.locator('[data-rcpt$="-cc"] .rcpt-chip')).toHaveCount(2);
    expect(await page.locator('[id$="-cc"].rcpt-src').inputValue()).toBe('bruno@exemple.invalid, libre@exemple.invalid');
    await expect(page.locator('#modal')).toBeVisible();
    expectClean(ctx);
  });
});

test.describe('« Payé par »', () => {
  const LONG = 'Qonto Artiste Alpha Production';
  for (const w of [1440, 1280]) test(`v1.60.4 budget : nom du compte lisible en entier, tableau sans défilement, montants entiers (${w} px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    const ctx = await openApp(page);
    await page.evaluate(async long => { const { S, touch } = await import('./js/state.js');
      for (const db of [S.db, window.__DB]) { db.projects.find(p => p.id === 'art-a').account_name = long;
        db.budget_lines.push({ id: 'bl-1', show_id: 'sh-1', project_id: 'art-a', category: 'Transport', label: 'Train', supplier: 'Transporteur', payer: 'compte', forecast: 1234567.89, amount: 1234567.89, sort: 1 },
          { id: 'bl-2', show_id: 'sh-1', project_id: 'art-a', category: 'Transport', label: 'Location', supplier: 'Loueur', payer: 'artbo', forecast: 50, sort: 2 }); }
      touch('projects'); touch('budget_lines');
      const a = await import('./js/app.js'); a.go('production'); S.openProd.add('sh-1'); S.tab['prod:sh-1'] = 'budget'; a.render(); }, LONG);
    const cell = page.locator('tr[data-budget-line="bl-1"] .sel-text');
    await expect(cell.locator('.sel-text-lab')).toHaveText(LONG);
    const m = await page.evaluate(() => { const t = document.querySelector('tr[data-budget-line="bl-1"]').closest('table'), w = t.closest('.tbl-wrap');
      const lab = document.querySelector('tr[data-budget-line="bl-1"] .sel-text-lab');
      const nums = [...document.querySelectorAll('tr[data-budget-line="bl-1"] input[type=number]')].map(i => i.scrollWidth - i.clientWidth);
      return { over: w.scrollWidth - w.clientWidth, clipped: lab.scrollHeight - lab.clientHeight, lines: Math.round(lab.clientHeight / parseFloat(getComputedStyle(lab).lineHeight)), nums,
        width: lab.closest('.sel-text').getBoundingClientRect().width }; });
    expect(m.over, `tableau sans défilement ${JSON.stringify(m)}`).toBeLessThanOrEqual(0);
    expect(m.clipped, `nom entier, rien de caché ${JSON.stringify(m)}`).toBeLessThanOrEqual(1);
    expect(m.width, 'colonne pas élargie (170 px au plus, comme avant)').toBeLessThanOrEqual(170);
    expect(m.nums.every(d => d <= 0), `montants entiers ${JSON.stringify(m)}`).toBe(true);
    // nom complet aussi en info-bulle et dans le nom accessible du choix
    await expect(cell).toHaveAttribute('title', `Payé par : ${LONG}`);
    await expect(cell.locator('select')).toHaveAttribute('aria-label', `Payé par : ${LONG}`);
    // le choix reste une liste ordinaire : changer de payeur enregistre et réaffiche le nom
    await cell.locator('select').selectOption('artbo');
    await expect.poll(() => page.evaluate(() => window.__DB.budget_lines.find(l => l.id === 'bl-1').payer)).toBe('artbo');
    await expect(page.locator('tr[data-budget-line="bl-1"] .sel-text-lab')).toHaveText('L\'ArtBo');
    // clavier : le choix reçoit le focus (cadre visible)
    await page.locator('tr[data-budget-line="bl-2"] .sel-text select').focus();
    await expect(page.locator('tr[data-budget-line="bl-2"] .sel-text')).toHaveCSS('border-top-color', 'rgb(58, 84, 136)');
    expectClean(ctx);
  });
});
