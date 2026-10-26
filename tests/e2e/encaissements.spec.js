// V1-A lot A2 : encaissements et compte dédié.
// Règles : CONVENTIONS §6.6 (Q6, compte d'encaissement jamais supposé), §6.4 (facture émise), décisions d'Anthony du 24/10/2026
// (lignes booking jamais facturées masquées et hors totaux ; factures émises sur une date booking visibles et signalées ;
// « Non renseigné » hors solde des comptes mais compté dans la date et l'artiste). Constats d'audit A-03, A-05.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear();
const PROD = { id: 'e-1', project_id: 'art-a', venue: 'Salle Encaissement', date: `${Y}-11-05`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 10000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15 };
const ANNULEE = { id: 'e-2', project_id: 'art-a', venue: 'Salle Annulée', date: `${Y}-11-12`, status: 'Annulée',
  contract_type: 'Cession', fee_ht: 4000, vat_rate: 5.5, prod_mode: 'production', artbo_pct: 15 };
const BOOKING = { id: 'e-3', project_id: 'art-b', venue: 'Salle Booking', date: `${Y}-11-20`, status: 'Confirmée Salle',
  contract_type: 'Cession', fee_ht: 8000, vat_rate: 5.5, prod_mode: 'booking', artbo_pct: 15 };

/** Ajoute des lignes à la fois dans la fausse base et dans l'état de l'application */
async function seed(page, tables) {
  await page.evaluate(async t => {
    const { S, touch } = await import('./js/state.js');
    for (const [table, rows] of Object.entries(t)) {
      for (const r of rows) { window.__DB[table].push({ ...r }); S.db[table].push({ ...r }); }
      touch(table);
    }
  }, tables);
}
const dbPay = (page, id) => page.evaluate(i => ({ ...window.__DB.show_payments.find(p => p.id === i) }), id);
const account = page => page.evaluate(async () => {
  const b = await import('./js/budget.js');
  const a = b.accountOf('art-a');
  return { inDone: a.inDone, inTodo: a.inTodo, outDone: a.outDone, outTodo: a.outTodo, real: a.real, end: a.end,
    unDone: a.unassignedDone, unTodo: a.unassignedTodo, commission: a.byCat.Commission || 0,
    moves: b.accountMoves('art-a').map(m => m.label + ' ' + m.amount) };
});
const openFactures = (page, showId) => page.evaluate(async id => {
  const { S } = await import('./js/state.js'); S.year = new Date().getFullYear();
  S.openProd.add(id); S.tab['prod:' + id] = 'factures'; (await import('./js/app.js')).go('production');
}, showId);
const indicateur = async (page, label) => {
  const t = await page.locator('.stat', { hasText: label }).locator('b').textContent();
  return Number(t.replace(/[^\d,-]/g, '').replace(',', '.'));
};
const resteAEncaisser = async page => {
  const t = await page.locator('.stat', { hasText: 'Reste à encaisser' }).locator('b').textContent();
  return Number(t.replace(/[^\d,-]/g, '').replace(',', '.'));
};

test('A2-C : un encaissement sans compte reste « Non renseigné » : hors solde du compte, réintégré dès que le compte est choisi', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await account(page);
  await seed(page, { shows: [PROD], show_payments: [
    { id: 'c-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 50, payee: 'compte', paid_at: `${Y}-10-01`, sort: 1 },
    { id: 'c-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, paid_at: `${Y}-10-15`, sort: 2 },            // payé, compte vide
    { id: 'c-o', show_id: 'e-1', kind: 'autre', label: 'Défraiement', amount: 300, sort: 3 },                            // à recevoir, compte vide
    { id: 'c-x', show_id: 'e-1', kind: 'autre', label: 'Reçu par L’ArtBo', amount: 200, payee: 'artbo', paid_at: `${Y}-10-15`, sort: 4 },
  ] });
  const a = await account(page);
  expect(a.inDone - avant.inDone, 'seul l’acompte arrivé sur le compte entre dans le compte').toBe(5000);
  expect(a.inTodo - avant.inTodo).toBe(0);
  expect(a.unDone - avant.unDone, 'solde payé sans compte : montré à part').toBe(5000);
  expect(a.unTodo - avant.unTodo, 'défraiement à recevoir sans compte : montré à part').toBe(300);
  expect(a.moves.some(m => m.startsWith('Solde')), 'pas de mouvement du compte pour un encaissement sans compte').toBe(false);
  expect(a.moves.some(m => m.startsWith('Acompte — Salle Encaissement'))).toBe(true);
  // le compte est choisi : le solde rejoint le compte et ses mouvements
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'c-s', { payee: 'compte' }));
  const b = await account(page);
  expect(b.inDone - avant.inDone).toBe(10000);
  expect(b.unDone - avant.unDone).toBe(0);
  expect(b.real - a.real, 'le solde réel du compte augmente du solde').toBe(5000);
  expect(b.moves.some(m => m.startsWith('Solde — Salle Encaissement'))).toBe(true);
  // aucune valeur supposée écrite en base pour les autres lignes
  expect((await dbPay(page, 'c-o')).payee ?? null).toBeNull();
  // tableau Factures : « Non renseigné » affiché, et signalé une fois payé
  await openFactures(page, 'e-1');
  await expect(page.locator('select[data-id="c-o"][data-f="payee"]')).toHaveValue('');
  await expect(page.locator('select[data-id="c-o"][data-f="payee"] option:checked')).toHaveText('Non renseigné');
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'c-o', { paid_at: `${new Date().getFullYear()}-10-20` }));
  await expect(page.locator('tr', { has: page.locator('select[data-id="c-o"]') }).locator('.warn-badge', { hasText: 'compte à choisir' })).toBeVisible();
  // budget de l'artiste : le montant non renseigné est montré à part
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); (S.openBudget ||= new Set()).add('art-a');
    document.body.insertAdjacentHTML('beforeend', '<div id="essai-budget">' + (await import('./js/views/budget.js')).projectBudgetHTML('art-a') + '</div>'); });
  await expect(page.locator('#essai-budget .stat', { hasText: 'Compte non renseigné' })).toBeVisible();
  expectClean(ctx);
});

test('A2-E (A-05) : une date annulée garde ses mouvements faits dans le compte, pas ses montants prévus', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await account(page);
  await seed(page, { shows: [ANNULEE], show_payments: [
    { id: 'x-a', show_id: 'e-2', kind: 'acompte', label: 'Acompte', amount: 2000, payee: 'compte', paid_at: `${Y}-09-01`, sort: 1 },
    { id: 'x-s', show_id: 'e-2', kind: 'solde', label: 'Solde', amount: 2000, payee: 'compte', sort: 2 },
  ], budget_lines: [
    { id: 'x-l1', project_id: 'art-a', show_id: 'e-2', category: 'Transport', label: 'Train déjà payé', amount: 500, payer: 'compte', paid_at: `${Y}-09-02` },
    { id: 'x-l2', project_id: 'art-a', show_id: 'e-2', category: 'Transport', label: 'Hôtel prévu', amount: 300, payer: 'compte' },
  ] });
  const a = await account(page);
  expect(a.inDone - avant.inDone, 'acompte reçu sur une date annulée : toujours dans le compte').toBe(2000);
  expect(a.inTodo - avant.inTodo, 'solde jamais reçu : plus attendu').toBe(0);
  expect(a.outDone - avant.outDone, 'dépense payée : toujours sortie du compte').toBe(500);
  expect(a.outTodo - avant.outTodo, 'dépense prévue : plus attendue').toBe(0);
  expect(a.commission - avant.commission, 'pas de commission sur une date annulée').toBe(0);
  expect(a.moves.some(m => m.startsWith('Acompte — Salle Annulée'))).toBe(true);
  expectClean(ctx);
});

test('C1 booking : seules la commission et la part partenaire sont suivies ; les factures de l’artiste n’entrent dans aucun indicateur', async ({ page }) => {
  const ctx = await openApp(page);
  await openFactures(page, 'sh-1');
  const avant = { reste: await resteAEncaisser(page), impayes: await indicateur(page, 'Factures émises impayées'), commissions: await indicateur(page, 'Commissions à encaisser') };
  await seed(page, { shows: [BOOKING], show_payments: [
    { id: 'b-a', show_id: 'e-3', kind: 'acompte', label: 'Acompte de l’artiste', pct: 50, sort: 1 },
    { id: 'b-s', show_id: 'e-3', kind: 'solde', label: 'Solde de l’artiste (émis)', pct: 50, invoice_number: 'F-77', sent_at: '2026-01-05', sort: 2 },
    { id: 'b-c', show_id: 'e-3', kind: 'artbo', label: "Commission L'ArtBo", invoice_number: 'F-AB-1', sent_at: '2026-01-06', sort: 3 },
    { id: 'b-p', show_id: 'e-3', kind: 'partner', label: 'Part partenaire', sort: 4 },
  ] });
  await openFactures(page, 'e-3');
  // acompte et solde de l'artiste : ni affichés, ni comptés ; commission émise impayée = « Commissions à encaisser — booking »
  await expect(page.locator('[data-id="b-a"]')).toHaveCount(0);
  await expect(page.locator('[data-id="b-s"]')).toHaveCount(0);
  await expect(page.locator('[data-id="b-c"][data-f="invoice_number"]')).toBeVisible();
  await expect(page.locator('[data-id="b-p"][data-f="label"]')).toBeVisible();
  expect(await resteAEncaisser(page) - avant.reste, 'aucune cession booking dans le reste à encaisser').toBe(0);
  expect(await indicateur(page, 'Factures émises impayées') - avant.impayes, 'facture de l’artiste hors des impayés').toBe(0);
  expect(await indicateur(page, 'Commissions à encaisser') - avant.commissions, 'commission 15 % de 8 000 €').toBe(1200);
  // pas de devis de cession ni « autre ligne » sur une date booking ; aucune relance d'acompte / de solde
  const prod = page.locator('.prod-bill', { has: page.locator('[data-id="b-c"]') });
  await expect(prod.locator('[data-act="pennylaneQuote"]')).toHaveCount(0);
  await expect(prod.locator('[data-act="addPay"]')).toHaveCount(0);
  const r = await page.evaluate(async () => (await import('./js/reminders.js')).remindersOf((await import('./js/selectors.js')).byId('shows', 'e-3')).map(x => x.step));
  expect(r.filter(x => ['acompte', 'solde'].includes(x))).toEqual([]);
  // historique conservé en base, rien modifié
  expect(await dbPay(page, 'b-s')).toMatchObject({ invoice_number: 'F-77', pct: 50 });
  expect(await dbPay(page, 'b-a')).toMatchObject({ pct: 50 });
  expectClean(ctx);
});

test('A2-D (A-03) : rattacher la pièce d’une facture émise ne la marque pas payée', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [PROD], show_payments: [
    { id: 'p-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
    { id: 'p-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },
  ] });
  await page.evaluate(async () => (await import('./js/budget-actions.js')).applyPiece({
    doc: { type: 'facture_emise', numero: 'F-55', montant_ht: 5000, acompte_ou_solde: 'acompte', date: `${new Date().getFullYear()}-10-01` },
    path: 'essai/f-55.pdf', name: 'f-55.pdf', show_id: 'e-1', project_id: 'art-a', line: null }));
  const p = await dbPay(page, 'p-a');
  expect(p.invoice_number).toBe('F-55');
  expect(p.file_name).toBe('f-55.pdf');
  expect(p.paid_at ?? null, 'pas de date de paiement inventée').toBeNull();
  expect(p.amount ?? null, 'montant inchangé').toBeNull();
  expectClean(ctx);
});

test('A2-D : deux pièces d’acompte successives ne réécrivent jamais une facture déjà rattachée ; sans ligne libre, rien n’est écrit', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [PROD], show_payments: [
    { id: 'q-1', show_id: 'e-1', kind: 'acompte', label: 'Acompte 1', pct: 25, sort: 1 },
    { id: 'q-2', show_id: 'e-1', kind: 'acompte', label: 'Acompte 2', pct: 25, sort: 2 },
    { id: 'q-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, sort: 3 },
  ] });
  const piece = (numero, ht, quoi) => page.evaluate(async ([n, h, k]) => (await import('./js/budget-actions.js')).applyPiece({
    doc: { type: 'facture_emise', numero: n, montant_ht: h, acompte_ou_solde: k }, path: `essai/${n}.pdf`, name: `${n}.pdf`, show_id: 'e-1', project_id: 'art-a', line: null }),
    [numero, ht, quoi]);
  await piece('F-001', 2500, 'acompte');
  await piece('F-002', 2500, 'acompte');
  expect(await dbPay(page, 'q-1')).toMatchObject({ invoice_number: 'F-001', file_name: 'F-001.pdf' });
  expect(await dbPay(page, 'q-2')).toMatchObject({ invoice_number: 'F-002', file_name: 'F-002.pdf' });
  // le solde est ensuite facturé dans Pennylane (lot C1 : avant, les acomptes non facturés seraient caducs et ne se rattacheraient plus)
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'q-s', { invoice_number: 'F-PL', pennylane_id: '77' }));
  expect((await dbPay(page, 'q-s')).amount, 'solde figé : cession − acomptes facturés').toBe(5000);
  // 3e pièce d'acompte, et une pièce de solde dont le numéro diffère de la facture Pennylane : aucune ligne libre
  const lignes = await page.evaluate(() => window.__DB.budget_lines.length);
  expect(await piece('F-003', 2500, 'acompte')).toBeNull();
  expect(await piece('F-004', 5000, 'solde')).toBeNull();
  expect(await dbPay(page, 'q-1')).toMatchObject({ invoice_number: 'F-001' });
  expect(await dbPay(page, 'q-2')).toMatchObject({ invoice_number: 'F-002' });
  expect(await dbPay(page, 'q-s')).toMatchObject({ invoice_number: 'F-PL' });
  expect(await page.evaluate(() => window.__DB.budget_lines.length), 'jamais enregistrée comme une dépense').toBe(lignes);
  expect(await page.evaluate(() => window.__DB.attachments.map(a => a.name)), 'pièces gardées « à rattacher »').toEqual(['F-003.pdf', 'F-004.pdf']);
  expectClean(ctx);
});

test('A2 point 6 : un montant seul ne rattache jamais à une ligne d’un autre type ; pièce gardée, listée, rattachée à la main', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [PROD], show_payments: [
    { id: 'm-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 30, sort: 1 },     // 3 000 €
    { id: 'm-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },         // à facturer : 10 000 € (aucun acompte facturé, lot C1)
    { id: 'm-o', show_id: 'e-1', kind: 'autre', label: 'Défraiement', amount: 10000, sort: 3 },
  ] });
  const piece = (doc, n) => page.evaluate(async ([d, nom]) => (await import('./js/budget-actions.js')).applyPiece({
    doc: { type: 'facture_emise', ...d }, path: `budget/e-1/${nom}`, name: nom, show_id: 'e-1', project_id: 'art-a', line: null }), [doc, n]);
  // pièce « acompte » de 10 000 € : le solde de 10 000 € n'est pas une correspondance sûre
  expect(await piece({ numero: 'F-10', montant_ht: 10000, acompte_ou_solde: 'acompte' }, 'F-10.pdf')).toBeNull();
  // sans type lu : deux lignes libres de 10 000 € → ambigu
  expect(await piece({ numero: 'F-11', montant_ht: 10000 }, 'F-11.pdf')).toBeNull();
  // sans type lu : une seule ligne libre de 3 000 € → sûre
  expect(await piece({ numero: 'F-12', montant_ht: 3000 }, 'F-12.pdf')).toEqual({ table: 'show_payments', id: 'm-a' });
  for (const id of ['m-s', 'm-o']) expect((await dbPay(page, id)).file_path ?? null, id).toBeNull();
  expect(await dbPay(page, 'm-a')).toMatchObject({ invoice_number: 'F-12', file_name: 'F-12.pdf' });
  // les deux pièces non rattachées sont listées dans l'onglet Factures et signalées dans l'en-tête de la date
  await openFactures(page, 'e-1');
  await expect(page.locator('.warn-badge', { hasText: '2 pièces à rattacher' })).toBeVisible();
  await expect(page.locator('[data-act="attachPiece"]')).toHaveCount(2);
  // rattachement à la main : seulement les lignes sans pièce ; aucun paiement ; le solde devient émis : montant figé (lot C1)
  await page.locator('.file-row', { hasText: 'F-10.pdf' }).locator('[data-act="attachPiece"]').click();
  await expect(page.locator('#modal select[name="pay"] option')).toHaveCount(3);   // « — » + les 2 lignes sans pièce
  await page.locator('#modal select[name="pay"]').selectOption('m-s');
  await page.locator('#modal input[name="invoice_number"]').fill('F-10');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await dbPay(page, 'm-s')).toMatchObject({ file_path: 'budget/e-1/F-10.pdf', file_name: 'F-10.pdf', invoice_number: 'F-10', pct: 50 });
  expect((await dbPay(page, 'm-s')).paid_at ?? null).toBeNull();
  // F-12 (acompte de 3 000 €) est émis : solde figé à 10 000 − 3 000
  expect((await dbPay(page, 'm-s')).amount).toBe(7000);
  await expect(page.locator('.warn-badge', { hasText: '1 pièce à rattacher' })).toBeVisible();
  // aucune pièce supprimée : l'enregistrement reste, il n'est plus listé
  expect(await page.evaluate(() => window.__DB.attachments.length)).toBe(2);
  expectClean(ctx);
});

test('C1 relances : jamais d’acompte ni de solde booking ; la commission booking reste relancée ; acompte caduc plus réclamé', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [BOOKING, { ...PROD, contract_sent: '2026-01-02' }], show_payments: [
    { id: 'r-a', show_id: 'e-3', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
    { id: 'r-s', show_id: 'e-3', kind: 'solde', label: 'Solde', pct: 50, invoice_number: 'F-90', sent_at: '2026-01-05', sort: 2 },
    { id: 'r-c', show_id: 'e-3', kind: 'artbo', label: 'Commission', invoice_number: 'F-AB-9', sent_at: '2026-01-06', sort: 3 },
    { id: 'q-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte prévu', pct: 30, sort: 1 },
    { id: 'q-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 70, sort: 2 },
  ] });
  const rel = id => page.evaluate(async i => (await import('./js/reminders.js')).remindersOf((await import('./js/selectors.js')).byId('shows', i)).map(x => [x.step, x.title]), id);
  expect(await rel('e-3')).toEqual([['artbo', 'Vérifier le paiement de la facture de commission']]);
  // production : contrat envoyé, acompte prévu pas envoyé → « Facture d'acompte à envoyer »… jusqu'à ce que le solde soit facturé
  expect((await rel('e-1')).some(([k, t]) => k === 'acompte' && t === 'Facture d’acompte à envoyer')).toBe(true);
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'q-s', { invoice_number: 'F-SOLDE', sent_at: '2026-01-10' }));
  expect((await rel('e-1')).some(([k, t]) => k === 'acompte' && t === 'Facture d’acompte à envoyer'), 'acompte caduc : plus réclamé').toBe(false);
  expect(await page.evaluate(async () => (await import('./js/calc.js')).acompteState((await import('./js/selectors.js')).byId('show_payments', 'q-a')))).toBe('caduc');
  expect(await dbPay(page, 'q-a')).toMatchObject({ pct: 30 });   // historique conservé
  expect((await dbPay(page, 'q-s')).amount, 'solde intégral figé : 10 000 €').toBe(10000);
  expectClean(ctx);
});

test('A2 points 4 et 5 : date annulée, avance L’ArtBo à rembourser ; budget de la date : « dont X € — compte non renseigné »', async ({ page }) => {
  const ctx = await openApp(page);
  const avant = await page.evaluate(async () => { const a = (await import('./js/budget.js')).accountOf('art-a'); return { outTodo: a.outTodo, adv: a.artboAdvance }; });
  await seed(page, { shows: [PROD, ANNULEE], show_payments: [
    { id: 'u-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 30, payee: 'compte', paid_at: `${Y}-10-01`, sort: 1 },
    { id: 'u-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 70, paid_at: `${Y}-10-05`, sort: 2 },
  ], budget_lines: [
    { id: 'u-l', project_id: 'art-a', show_id: 'e-2', category: 'Transport', label: 'Train avancé', amount: 700, payer: 'artbo', paid_at: `${Y}-09-02` },
  ] });
  const a = await page.evaluate(async () => { const a = (await import('./js/budget.js')).accountOf('art-a'); return { outTodo: a.outTodo, adv: a.artboAdvance }; });
  expect(a.outTodo - avant.outTodo, 'avance non remboursée : toujours à rembourser').toBe(700);
  expect(a.adv - avant.adv).toBe(700);
  const html = await page.evaluate(async () => (await import('./js/views/budget.js')).showBudgetHTML((await import('./js/selectors.js')).byId('shows', 'e-1')));
  expect(html.replace(/\s+/g, ' ')).toMatch(/entièrement encaissé · dont 7 000,00 € — compte non renseigné/);
  expectClean(ctx);
});

test('C1 rattachement : une date booking ne rattache aucune pièce aux acomptes / soldes de l’artiste ; une facture qui a sa pièce ne la perd jamais', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [BOOKING, PROD], show_payments: [
    { id: 'k-a', show_id: 'e-3', kind: 'acompte', label: 'Acompte de l’artiste', pct: 50, sort: 1 },
    { id: 'k-s', show_id: 'e-3', kind: 'solde', label: 'Solde de l’artiste', pct: 50, invoice_number: 'F-70', sort: 2 },
    { id: 'k-x', show_id: 'e-1', kind: 'solde', label: 'Solde émis avec pièce', pct: 100, invoice_number: 'F-71', file_path: 'budget/e-1/ancienne.pdf', file_name: 'ancienne.pdf', sort: 3 },
  ], attachments: [{ id: 'att-1', project_id: 'art-b', name: 'V-1.pdf', path: 'budget/e-3/V-1.pdf' }] });
  const piece = (show, doc, n) => page.evaluate(async ([sh, d, nom]) => (await import('./js/budget-actions.js')).applyPiece({
    doc: { type: 'facture_emise', ...d }, path: `budget/${sh}/${nom}`, name: nom, show_id: sh, project_id: 'art-a', line: null }), [show, doc, n]);
  // booking : même avec le numéro exact du solde de l'artiste, rien n'est rattaché (pièce gardée à part)
  expect(await piece('e-3', { numero: 'F-70', montant_ht: 4000, acompte_ou_solde: 'solde' }, 'b.pdf')).toBeNull();
  expect((await dbPay(page, 'k-s')).file_path ?? null).toBeNull();
  // même numéro qu'une facture qui a déjà sa pièce : rien n'est remplacé, la nouvelle pièce est gardée à part
  expect(await piece('e-1', { numero: 'F-71', montant_ht: 0 }, 'nouvelle.pdf')).toBeNull();
  expect(await dbPay(page, 'k-x')).toMatchObject({ file_path: 'budget/e-1/ancienne.pdf', file_name: 'ancienne.pdf' });
  // « Rattacher » sur une date booking : aucune ligne proposée, message, pas de fenêtre
  await page.evaluate(async () => (await import('./js/actions.js')).ACTIONS.attachPiece({ dataset: { id: 'att-1', show: 'e-3' } }));
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(e => e.textContent).join(' '))).toMatch(/factures d’acompte et de solde sont celles de l’artiste/);
  expectClean(ctx);
});

test('A2 point 1 : une date avec des pièces à rattacher ne se supprime pas ; les pièces d’une date absente restent listées et ouvrables', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [PROD, ANNULEE], show_payments: [{ id: 'z-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 }],
    attachments: [
      { id: 'att-p', project_id: 'art-a', name: 'garde.pdf', path: 'budget/e-1/garde.pdf' },
      { id: 'att-x', project_id: 'art-a', name: 'annulee.pdf', path: 'budget/e-2/annulee.pdf' },          // date annulée : hors liste Production
      { id: 'att-o', project_id: 'art-a', name: 'orpheline.pdf', path: 'budget/disparue/orpheline.pdf' }, // date supprimée hors Matrice
    ] });
  // suppression refusée, rien n'est effacé
  expect(await page.evaluate(async () => (await import('./js/data.js')).remove('shows', 'e-1'))).toBeFalsy();
  expect(await page.evaluate(() => window.__DB.shows.some(s => s.id === 'e-1'))).toBe(true);
  expect(await page.evaluate(() => [...document.querySelectorAll('.toast, #toast')].map(e => e.textContent).join(' '))).toMatch(/1 pièce à rattacher/);
  // une fois la pièce rattachée, la date redevient supprimable (garde levée)
  await page.evaluate(async () => (await import('./js/data.js')).save('show_payments', 'z-a', { file_path: 'budget/e-1/garde.pdf', file_name: 'garde.pdf' }));
  expect(await page.evaluate(async () => (await import('./js/calc.js')).changeBlocked('shows', 'e-1', null))).toBe('');
  // vue Production : les pièces des dates absentes sont listées avec leur date, et s'ouvrent
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.year = new Date().getFullYear(); (await import('./js/app.js')).go('production'); });
  const bloc = page.locator('.panel', { hasText: 'Pièces à rattacher hors de cette liste' });
  await expect(bloc.locator('.file-row')).toHaveCount(2);
  await expect(bloc.locator('.file-row', { hasText: 'annulee.pdf' })).toContainText('Annulée');
  await expect(bloc.locator('.file-row', { hasText: 'orpheline.pdf' })).toContainText('date supprimée · Artiste Alpha');
  await expect(bloc.locator('[data-act="openAttachment"][data-id="att-o"]')).toBeVisible();
  expectClean(ctx);
});

test('A2-F : marquer payé un encaissement sans compte demande le compte ; « Annuler » le laisse « Non renseigné »', async ({ page }) => {
  const ctx = await openApp(page);
  await seed(page, { shows: [PROD, BOOKING], show_payments: [
    { id: 'f-a', show_id: 'e-1', kind: 'acompte', label: 'Acompte', pct: 50, sort: 1 },
    { id: 'f-s', show_id: 'e-1', kind: 'solde', label: 'Solde', pct: 50, sort: 2 },
    { id: 'f-c', show_id: 'e-1', kind: 'autre', label: 'Avec compte', amount: 100, payee: 'artiste', sort: 3 },
    { id: 'f-b', show_id: 'e-3', kind: 'solde', label: 'Solde booking', pct: 50, invoice_number: 'F-88', sort: 2 },
  ] });
  const jour = `${Y}-10-21`;
  // 1. choix du compte
  let fin = page.evaluate(async d => (await import('./js/actions.js')).ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-a' } }, d), jour);
  await expect(page.locator('#modal h2')).toHaveText('Sur quel compte ce paiement est-il arrivé ?');
  await expect(page.locator('#modal select[name="payee"]'), 'aucun compte présélectionné').toHaveValue('');
  await page.locator('#modal select[name="payee"]').selectOption('compte');
  await page.locator('#modal button[type=submit]').click();
  await fin;
  expect(await dbPay(page, 'f-a')).toMatchObject({ paid_at: jour, payee: 'compte' });
  // 2. « Annuler » : payé, compte toujours vide
  fin = page.evaluate(async d => (await import('./js/actions.js')).ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-s' } }, d), jour);
  await expect(page.locator('#modal h2')).toHaveText('Sur quel compte ce paiement est-il arrivé ?');
  await page.locator('#modal .modal-foot button', { hasText: 'Annuler' }).click();
  await fin;
  const s = await dbPay(page, 'f-s');
  expect(s.paid_at).toBe(jour);
  expect(s.payee ?? null).toBeNull();
  // 3. compte déjà renseigné, ou date en booking : aucune question
  await page.evaluate(async d => {
    const { ACTIONS } = await import('./js/actions.js');
    await ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-c' } }, d);
    await ACTIONS['change:show_payments.paid_at']({ dataset: { id: 'f-b' } }, d);
  }, jour);
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(await dbPay(page, 'f-c')).toMatchObject({ paid_at: jour, payee: 'artiste' });
  expect((await dbPay(page, 'f-b')).payee ?? null).toBeNull();
  expectClean(ctx);
});
