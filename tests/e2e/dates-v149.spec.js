// Lot Dates et formats v1.49 (CONVENTIONS §1.2, §1.6, §2.2–2.4, Q12) : jour de Paris partout (même si l'ordinateur est réglé
// sur un autre fuseau), fonctions officielles d'ajout de jours / mois, boucle accueil à 4 mois calendaires (vendredi si week-end),
// pourcentages « 33,33 % » avec espace insécable.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const utils = (page, fn) => page.evaluate(fn);

test.describe('ordinateur réglé en UTC, 00 h 30 à Paris', () => {
  test.use({ timezoneId: 'UTC' });
  test('v1.49 aujourd’hui et jour d’un horodatage : celui de Paris, jamais la veille (UTC)', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-03-10T23:30:00Z'));   // 00 h 30 le 11/03 à Paris
    const ctx = await openApp(page);
    const r = await utils(page, async () => { const u = await import('./js/utils.js');
      return [u.today(), u.dayOf('2026-03-10T23:30:00Z'), u.fmtDate('2026-03-10T23:30:00+00:00'), u.fmtDate('2026-03-10'), u.dayOf('2026-07-01')]; });
    expect(r).toEqual(['2026-03-11', '2026-03-11', '11/03/2026', '10/03/2026', '2026-07-01']);
    expectClean(ctx);
  });
});

test('v1.49 ajout de jours et de mois : une seule fonction, fins de mois et années bissextiles justes', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await utils(page, async () => { const u = await import('./js/utils.js');
    return [u.addDays('2026-02-27', 2), u.addDays('2026-03-01', -1), u.addMonths('2028-02-29', 12), u.addMonths('2027-05-31', -4), u.addMonths('2026-11-15', 3),
      u.workDayBefore('2026-11-14'), u.workDayBefore('2026-11-15'), u.workDayBefore('2026-11-16'), u.r2('12.345'), u.r2('x')]; });
  expect(r).toEqual(['2026-03-01', '2026-02-28', '2029-02-28', '2027-01-31', '2027-02-15', '2026-11-13', '2026-11-13', '2026-11-16', 12.35, 0]);
  expectClean(ctx);
});

test('v1.49 boucle accueil & technique : 4 mois calendaires avant le concert, week-end → vendredi précédent (Q12)', async ({ page }) => {
  const ctx = await openApp(page);
  const Y = new Date().getFullYear() + 1;
  // concert le 15/03 → 15/11 de l'année d'avant ; selon le jour de la semaine, recul au vendredi
  const r = await page.evaluate(async y => {
    const { S, touch } = await import('./js/state.js'); const u = await import('./js/utils.js');
    const s = { id: 'b-1', project_id: 'art-a', venue: 'Salle B', date: `${y}-03-15`, status: 'Confirmée Salle', contract_type: 'Cession', fee_ht: 1000, prod_mode: 'production' };
    window.__DB.shows.push({ ...s }); S.db.shows.push({ ...s }); touch('shows');
    const rem = (await import('./js/reminders.js')).remindersOf(s).find(x => x.step === 'boucle_tech');
    return { due: rem?.due, attendu: u.workDayBefore(`${y - 1}-11-15`) };
  }, Y);
  expect(r.due).toBe(r.attendu);
  expectClean(ctx);
});

test('v1.49 pourcentages : « 33,33 % » avec espace insécable, sans zéro inutile', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await utils(page, async () => { const u = await import('./js/utils.js'); return [u.pct(15), u.pct(33.3333), u.pct(5.5), u.pct('50'), u.pct(null)]; });
  expect(r).toEqual(['15 %', '33,33 %', '5,5 %', '50 %', '—']);
  expectClean(ctx);
});
