// v1.71 — L2b du point 02 « Rattachements manuels » (décisions d'Anthony du 27/11/2026, 11 h 55). Données FICTIVES ; écritures par
// les fonctions serveur simulées (mêmes contrôles que le SQL, essayé sur une vraie base : 2026-11-27_v1.71_rattachements_essai.sql).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;
const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

async function preparer(page, {shows, payments, avoirs = [], reglements = [], groupes = []}){
  await page.evaluate(async ([shows, payments, avoirs, reglements, groupes, Y]) => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js');
    for (const db of [S.db, window.__DB]){
      db.shows.push(...structuredClone(shows)); db.show_payments.push(...structuredClone(payments));
      db.pennylane_avoirs = [...(db.pennylane_avoirs || []), ...structuredClone(avoirs)];
      db.reglements = [...(db.reglements || []), ...structuredClone(reglements)];
      db.virements_groupes = [...(db.virements_groupes || []), ...structuredClone(groupes)];
      db.factures_remplacees ||= []; db.rattachements_journal ||= [];
    }
    for (const t of ['shows', 'show_payments', 'pennylane_avoirs', 'reglements', 'virements_groupes', 'factures_remplacees']) touch(t);
    S.year = Y; app.go('production'); S.openProd = new Set(shows.map(s => s.id)); shows.forEach(s => { S.tab['prod:' + s.id] = 'factures'; }); app.render();
  }, [shows, payments, avoirs, reglements, groupes, Y]);
}
const show = (id, venue, extra = {}) => ({ id, project_id: 'art-a', venue, city: 'Ville fictive', date: `${Y}-03-1${id.slice(-1)}`, status: 'Confirmée Salle',
  contract_type: 'Co-Réalisation', fee_ht: 3500, vat_rate: 5.5, prod_mode: 'production', ...extra });
const etat = (page, sid) => page.evaluate(async sid => {
  const calc = await import('./js/calc.js'); const { S } = await import('./js/state.js');
  const s = S.db.shows.find(x => x.id === sid), ps = S.db.show_payments.filter(p => p.show_id === sid);
  return { restes: calc.restesDate(s), lignes: ps.map(p => ({ id: p.id, kind: p.kind, invoice_number: p.invoice_number, pennylane_id: p.pennylane_id, paid_at: p.paid_at ?? null, payee: p.payee ?? null, amount: p.amount })),
    reglements: (S.db.reglements || []).filter(r => r.show_id === sid), remplacees: (S.db.factures_remplacees || []).filter(f => f.show_id === sid),
    avoirs: (S.db.pennylane_avoirs || []).map(a => ({ pennylane_id: a.pennylane_id, etat: a.etat, payment_id: a.payment_id, facture_remplacee: !!a.facture_remplacee, qualification: a.qualification ?? null, classement_motif: a.classement_motif ?? null })) };
}, sid);
const ecritures = (page, t) => page.evaluate(t => window.__calls.filter(c => c.table === t && c.op !== 'select'), t);

test('v1.71 — Champs des Notes (fictif), option B : la ligne suit F-120 ; F-77 et l’avoir restent visibles ; un seul encaissement d’octobre, aucun reste', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('rt-d1', 'Salle Réémise')],
    payments: [{ id: 'rt-p1', show_id: 'rt-d1', kind: 'acompte', label: 'Acompte', pct: 50, amount: 1750, vat_rate: 5.5, sort: 1, invoice_number: 'F-TEST-77', pennylane_id: 'pl-77', pennylane_url: 'https://exemple.test/77', sent_at: `${Y - 1}-06-10`, paid_at: `${Y - 1}-10-30`, payee: 'compte' }],
    avoirs: [{ id: 'rt-a1', pennylane_id: 'pl-117', invoice_number: 'AV-TEST-117', amount_ht: 1750, amount_ttc: 1846.25, credited_pennylane_id: 'pl-77', credited_invoice_number: 'F-TEST-77', etat: 'rattache', payment_id: 'rt-p1', show_id: 'rt-d1', rattache_origine: 'pl-77', rattache_mode: 'auto' }],
  });
  // avant : deux documents sur trois, l'encaissement paraît « au-delà du net facturé »
  let e = await etat(page, 'rt-d1');
  expect(e.restes).toMatchObject({ factureNet: 0, encaisse: 1846.25, trop: 1846.25 });
  // la fonction serveur simulée lit la facture réémise dans « Pennylane » puis appelle la fonction de la base
  await page.evaluate(() => { window.__FN_DATA = { pennylane: b => b.action === 'reemission'
    ? { ok: true, remplacee: window.__rpc('facture_reemise_enregistrer', { p_payment: b.payment_id, p_pennylane_id: 'pl-120', p_invoice_number: b.invoice_number, p_url: 'https://exemple.test/120', p_amount_ht: 1750, p_motif: b.motif, p_auteur: 'equipe@exemple.test' }) }
    : { ok: true } }; });
  await page.locator('[data-act="factureReemise"][data-id="rt-p1"]').click();
  await page.locator('#modal [name=numero]').fill('F-TEST-120');
  await page.locator('#modal [name=motif]').fill('Avoir F-117 émis par erreur');
  await page.locator('#modal button[type=submit]').click();
  await page.locator('dialog.ask button', { hasText: 'Rattacher' }).click();
  await expect(page.locator('body')).toContainText('la ligne suit la nouvelle facture');
  e = await etat(page, 'rt-d1');
  expect(e.lignes).toEqual([{ id: 'rt-p1', kind: 'acompte', invoice_number: 'F-TEST-120', pennylane_id: 'pl-120', paid_at: `${Y - 1}-10-30`, payee: 'compte', amount: 1750 }]);   // une seule ligne d'acompte
  expect(e.reglements).toEqual([]);                                     // aucun encaissement créé ni dupliqué
  expect(e.restes).toMatchObject({ factureNet: 1846.25, encaisse: 1846.25, resteDu: 0, aRembourser: 0, trop: 0 });   // aucun nouveau reste
  expect(e.avoirs.find(a => a.pennylane_id === 'pl-117')).toMatchObject({ etat: 'rattache', payment_id: 'rt-p1', facture_remplacee: true });
  // trois documents visibles : F-120 (ligne), F-77 (facture d'origine), F-117 (avoir sur la facture remplacée)
  await expect(page.locator('a', { hasText: 'Facture ↗' }).first()).toHaveAttribute('href', 'https://exemple.test/120');
  await expect(page.locator('tr[data-facture-remplacee]')).toContainText('F-TEST-77');
  await expect(page.locator('tr[data-facture-remplacee]')).toContainText('remplacée par F-TEST-120');
  await expect(page.locator('tr[data-avoir="rt-a1"]')).toContainText('sur la facture d’origine F-TEST-77 (remplacée)');
  await expect(page.locator('[data-restes="rt-d1"]')).not.toContainText('au-delà du net facturé');
  // qualification facultative : F-117 « Erreur de facturation »
  await page.locator('tr[data-avoir="rt-a1"] [data-act="avoirQualifier"]').click();
  await page.locator('#modal [name=q]').selectOption('erreur_facturation');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('tr[data-avoir="rt-a1"]')).toContainText('Erreur de facturation');
  // détacher : motif obligatoire ; la ligne revient à F-77 ; historique gardé ; paiement inchangé
  await page.locator('tr[data-facture-remplacee] [data-act="reemissionDetacher"]').click();
  await page.locator('dialog.ask button', { hasText: 'Détacher' }).click();
  await expect(page.locator('dialog.ask')).toContainText('À remplir');
  await page.locator('dialog.ask #ask-input').fill('Essai fictif');
  await page.locator('dialog.ask button', { hasText: 'Détacher' }).click();
  await expect(page.locator('tr[data-facture-remplacee].is-cancelled')).toContainText('réémission détachée');
  e = await etat(page, 'rt-d1');
  expect(e.lignes[0]).toMatchObject({ invoice_number: 'F-TEST-77', pennylane_id: 'pl-77', paid_at: `${Y - 1}-10-30` });
  expect(e.reglements).toEqual([]);
  expect(e.remplacees).toHaveLength(1);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'pennylane').map(c => c.body.action))).toEqual(['reemission']);
  expect((await ecritures(page, 'show_payments')).length).toBe(0);      // aucune écriture directe : base et fonction serveur seulement
  expectClean(ctx);
});

test('v1.71 — avoir « À rattacher » : rattaché, corrigé (motif), détaché (motif), classé « Hors MATRICE » (motif), reclassé', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('rt-d2', 'Salle Avoirs'), show('rt-d3', 'Salle Autre')],
    payments: [{ id: 'rt-p2', show_id: 'rt-d2', kind: 'solde', label: 'Solde', amount: 1750, vat_rate: 5.5, sort: 2, invoice_number: 'F-TEST-2', sent_at: iso(-20) },
      { id: 'rt-p3', show_id: 'rt-d3', kind: 'solde', label: 'Solde', amount: 1750, vat_rate: 5.5, sort: 2, invoice_number: 'F-TEST-3', sent_at: iso(-20) }],
    avoirs: [{ id: 'rt-n1', pennylane_id: 'pl-neg', invoice_number: 'NEG-15', amount_ht: 15, amount_ttc: 15, etat: 'a_rattacher', reason: 'Pennylane n’indique pas la facture d’origine', rattache_mode: 'auto' }],
  });
  const panneau = page.locator('#avoirs-a-rattacher');
  await panneau.locator('[data-act="avoirRattacher"][data-id="rt-n1"]').click();
  await page.locator('#modal [name=to]').selectOption('rt-p2');
  await page.locator('#modal button[type=submit]').click();                // premier rattachement : motif facultatif
  await expect(page.locator('tr[data-avoir="rt-n1"]')).toContainText('rattaché à la main');
  await expect(page.locator('#avoirs-a-rattacher')).toHaveCount(0);
  let e = await etat(page, 'rt-d2');
  expect(e.restes.factureNet).toBe(1831.25);                               // 1 846,25 − 15 : l'avoir réduit le net, aucun encaissement
  // correction : motif obligatoire
  await page.locator('tr[data-avoir="rt-n1"] [data-act="avoirRattacher"]').click();
  await page.locator('#modal [name=to]').selectOption('rt-p3');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('body')).toContainText('Indique le motif de la correction');
  await page.locator('#modal [name=motif]').fill('Mauvaise date');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('tr[data-avoir="rt-n1"]')).toHaveCount(1);
  e = await etat(page, 'rt-d3');
  expect(e.avoirs.find(a => a.pennylane_id === 'pl-neg')).toMatchObject({ etat: 'rattache', payment_id: 'rt-p3' });
  // détacher (motif) → revient « À rattacher »
  await page.locator('tr[data-avoir="rt-n1"] [data-act="avoirDetacher"]').click();
  await page.locator('dialog.ask #ask-input').fill('Pas pour cette date');
  await page.locator('dialog.ask button', { hasText: 'Détacher' }).click();
  await expect(page.locator('#avoirs-a-rattacher')).toContainText('Détaché à la main : Pas pour cette date');
  // classer « Hors MATRICE » (motif obligatoire) → sort de « À rattacher », reste consultable
  await page.locator('#avoirs-a-rattacher [data-act="avoirHors"]').click();
  await page.locator('dialog.ask button', { hasText: 'Classer' }).click();
  await expect(page.locator('dialog.ask')).toContainText('À remplir');
  await page.locator('dialog.ask #ask-input').fill('Frais bancaires sans lien avec une date');
  await page.locator('dialog.ask button', { hasText: 'Classer' }).click();
  await expect(page.locator('#avoirs-a-rattacher')).toHaveCount(0);
  await expect(page.locator('#avoirs-hors-matrice')).toContainText('Frais bancaires sans lien avec une date');
  // classement corrigé : rattaché (motif obligatoire)
  await page.locator('#avoirs-hors-matrice summary').click();
  await page.locator('#avoirs-hors-matrice [data-act="avoirRattacher"]').click();
  await page.locator('#modal [name=to]').selectOption('rt-p2');
  await page.locator('#modal [name=motif]').fill('Finalement lié au solde');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#avoirs-hors-matrice')).toHaveCount(0);
  const j = await page.evaluate(() => window.__DB.rattachements_journal.filter(x => x.objet_id === 'rt-n1').map(x => [x.action, x.motif, x.auteur != null]));
  expect(j).toEqual([['rattacher', null, true], ['corriger', 'Mauvaise date', true], ['detacher', 'Pas pour cette date', true],
    ['classer_hors_matrice', 'Frais bancaires sans lien avec une date', true], ['corriger', 'Finalement lié au solde', true]]);
  expect((await etat(page, 'rt-d2')).reglements).toEqual([]);             // jamais d'encaissement créé
  expectClean(ctx);
});

test('v1.71 — virement groupé sur deux dates : reste non attribué affiché, cumul jamais au-delà du virement (application et base)', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, {
    shows: [show('rt-d4', 'Salle Groupe A'), show('rt-d5', 'Salle Groupe B')],
    payments: [{ id: 'rt-p4', show_id: 'rt-d4', kind: 'autre', label: 'Facture A', amount: 500, vat_rate: 5.5, sort: 3, invoice_number: 'F-G-A', sent_at: iso(-20) },
      { id: 'rt-p5', show_id: 'rt-d5', kind: 'autre', label: 'Facture B', amount: 500, vat_rate: 5.5, sort: 3, invoice_number: 'F-G-B', sent_at: iso(-20) }],
  });
  // A : nouveau virement groupé de 1 000 € TTC, part 527,50 (facture couverte → « Payée » à la date du virement)
  await page.locator('[data-act="virementGroupe"][data-id="rt-p4"]').click();
  await page.locator('#modal [name=vg]').selectOption('');
  await page.locator('#modal [name=total]').fill('1000');
  await page.locator('#modal [name=date]').fill(iso(-3));
  await page.locator('#modal [name=reference]').fill('VIR GROUPE FICTIF');
  await page.locator('#modal [name=montant]').fill('527.50');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('body')).toContainText('reste non attribué 472,50');
  expect((await etat(page, 'rt-d4')).lignes[0].paid_at).toBe(iso(-3));
  await expect(page.locator('#virements-groupes')).toContainText('reste non attribué 472,50');
  // B : part au-delà du reste du virement → refusée par l'application, rien d'écrit
  await page.locator('[data-act="virementGroupe"][data-id="rt-p5"]').click();
  await page.locator('#modal [name=montant]').fill('500');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('body')).toContainText('Part supérieure au reste non attribué du virement (472,50');
  expect((await etat(page, 'rt-d5')).reglements).toEqual([]);
  // part de 400 : enregistrée, reste non attribué 72,50 € affiché
  await page.locator('#modal [name=montant]').fill('400');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#virements-groupes')).toContainText('reste non attribué 72,50');
  await expect(page.locator('[data-part-virement]').first()).toContainText('reste non attribué 72,50');
  const e = await etat(page, 'rt-d5');
  expect(e.lignes[0].paid_at).toBeNull();                               // 400 < 527,50 : partiel, reste dû
  expect(e.restes).toMatchObject({ encaisse: 400, resteDu: 127.5 });
  // la base refuse elle aussi un cumul au-delà du virement (appel direct)
  const refus = await page.evaluate(async () => { const { sb } = await import('./js/data.js'); const v = window.__DB.virements_groupes[0];
    const { error } = await sb.rpc('virement_groupe_affecter', { p_virement: v.id, p_payment: 'rt-p5', p_montant: 100, p_compte: null }); return error && error.message; });
  expect(refus).toMatch(/le cumul ne dépasse jamais le virement/);
  expectClean(ctx);
});
