// Agendas Google des artistes (lecture seule) — données FICTIVES, aucune connexion à Google.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const Y = new Date().getFullYear() + 1;   // année à venir : dates et événements jamais « passés »
async function preparer(page, { fresh = true } = {}) {
  await page.evaluate(async ([Y, fresh]) => {
    const { S, touch } = await import('./js/state.js');
    const ART = S.db.projects[0].id;
    const cal = { id: 'cal-1', project_id: ART, calendar_id: 'agenda-fictif@group.calendar.google.com', calendar_name: 'Agenda fictif', status: 'actif',
      last_ok_at: fresh ? new Date().toISOString() : '2020-01-01T00:00:00Z', last_error: null, mode: 'details' };
    const ev = (id, o) => ({ id, calendar_ref: 'cal-1', project_id: ART, gcal_event_id: id, busy: true, private: false, all_day: true, is_show: false, geo_status: 'sans_lieu', deleted_at: null, ...o });
    const events = [
      ev('e-vac', { title: 'Vacances', start_date: `${Y}-03-10`, end_date: `${Y}-03-13` }),                       // 10 → 12 mars (fin exclue)
      ev('e-priv', { title: null, private: true, all_day: false, start_at: `${Y}-03-20T18:00:00Z`, end_at: `${Y}-03-20T22:00:00Z` }),
      ev('e-dispo', { title: 'Libre', busy: false, start_date: `${Y}-03-25`, end_date: `${Y}-03-26` }),             // « Disponible » : ne bloque pas
      ev('e-supp', { title: 'Annulé dans Google', start_date: `${Y}-03-27`, end_date: `${Y}-03-28`, deleted_at: '2026-11-06T10:00:00Z' }),
      ev('e-show', { title: 'SHOW Lyon', is_show: true, location: 'Le Transbordeur, Lyon', city: 'Lyon', lat: 45.78, lng: 4.86, geo_status: 'ok', start_date: `${Y}-04-02`, end_date: `${Y}-04-03` }),
      ev('e-show2', { title: 'show privé chez des amis', is_show: true, location: 'chez Paul', geo_status: 'a_preciser', start_date: `${Y}-04-09`, end_date: `${Y}-04-10` }),
      ev('e-nuit', { title: 'Session studio', all_day: false, start_at: `${Y}-05-04T21:00:00Z`, end_at: `${Y}-05-05T01:00:00Z` }),   // 23 h → 3 h à Paris
    ];
    for (const db of [S.db, window.__DB]) { db.artist_calendars = [cal]; db.artist_calendar_events = JSON.parse(JSON.stringify(events)); }
    touch('artist_calendars'); touch('artist_calendar_events');
    S.year = Y; const app = await import('./js/app.js'); app.go('booking'); app.render();
  }, [Y, fresh]);
}

test('agendas : indisponibilités dans Booking (origine Google), privé = « Indisponible », « Disponible » et supprimé non affichés', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  const rows = page.locator('.gig.cal-unav');
  await expect(rows.filter({ hasText: 'Vacances' })).toContainText('jusqu’au 12/03');
  await expect(rows.filter({ hasText: 'Indisponible' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Libre' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Annulé dans Google' })).toHaveCount(0);
  await expect(rows.first()).toContainText('Google');
  // les indisponibilités ne comptent jamais dans les chiffres de Booking
  const nDates = await page.evaluate(async Y => { const { S } = await import('./js/state.js'); return S.db.shows.filter(s => (s.date || '').startsWith(String(Y))).length; }, Y);
  await expect(page.locator('.gig:not(.cal-unav)')).toHaveCount(nDates);   // ce ne sont pas des dates : rien n'est compté en plus
  // séance de nuit : 23 h → 3 h à Paris = deux jours
  const span = await page.evaluate(async () => { const { evSpan } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    return evSpan(S.db.artist_calendar_events.find(e => e.id === 'e-nuit')); });
  expect(span).toEqual([`${Y}-05-04`, `${Y}-05-05`]);
  expectClean(ctx);
});

test('agendas : nouvelle date sur une indisponibilité → avertissement, rien sans confirmation, enregistrée après confirmation', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  const ok = page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    return calCheckBeforeSave({ project_id: S.db.projects[0].id, date: `${Y}-03-11`, status: 'Option Salle' }); }, Y);
  await expect(page.locator('dialog[open]', { hasText: 'Artiste indisponible ?' })).toContainText('Vacances');
  await page.locator('dialog[open] button', { hasText: 'Annuler' }).click();
  expect(await ok).toBe(false);
  const ok2 = page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    return calCheckBeforeSave({ project_id: S.db.projects[0].id, date: `${Y}-03-11`, status: 'Option Salle' }); }, Y);
  await page.locator('dialog[open] button', { hasText: 'Enregistrer quand même' }).click();
  expect(await ok2).toBe(true);
  // « Disponible » ne bloque pas : aucune question
  expect(await page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    return calCheckBeforeSave({ project_id: S.db.projects[0].id, date: `${Y}-03-25`, status: 'Option Salle' }); }, Y)).toBe(true);
  expectClean(ctx);
});

test('agendas : synchronisation trop ancienne → « disponibilités plus à jour », jamais « libre »', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { fresh: false });
  await expect(page.locator('.gig.cal-unav').first()).toContainText('disponibilités plus à jour');
  const ok = page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    return calCheckBeforeSave({ project_id: S.db.projects[0].id, date: `${Y}-06-01`, status: 'Option Salle' }); }, Y);
  await expect(page.locator('dialog[open]', { hasText: 'Agenda pas à jour' })).toBeVisible();
  await page.locator('dialog[open] button', { hasText: 'Enregistrer quand même' }).click();
  expect(await ok).toBe(true);
  await page.evaluate(async () => { const { editProject } = await import('./js/forms.js'); const { S } = await import('./js/state.js'); editProject(S.db.projects[0].id); });
  await expect(page.locator('#modal .cal-panel')).toContainText('disponibilités plus à jour');
  expectClean(ctx);
});

test('agendas : « Show » avec ville sur la carte (repère distinct), sinon « localisation à préciser » ; association explicite', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  const r = await page.evaluate(async Y => { const { calMapPoints } = await import('./js/calendars.js'); const m = calMapPoints(null, Y);
    return { pts: m.points.map(p => p.label), loc: m.toLocate.map(e => e.id) }; }, Y);
  expect(r.pts).toHaveLength(1);
  expect(r.pts[0]).toContain('Date artiste — calendrier Google');
  expect(r.loc).toEqual(['e-show2']);
  await expect(page.locator('.cal-legend')).toContainText('Localisation à préciser');
  // association avec une date « Confirmée Artiste » existante : la date reste telle quelle, l'événement n'est plus affiché en double
  await page.evaluate(async Y => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.shows.push({ id: 'sh-art', project_id: S.db.projects[0].id, venue: 'Transbordeur', city: 'Lyon', date: `${Y}-04-02`, status: 'Confirmée Artiste' });
    touch('shows'); (await import('./js/app.js')).render(); }, Y);
  await page.locator('.gig.cal-unav', { hasText: 'SHOW Lyon' }).locator('[data-act=calAssociate]').click();
  await page.locator('dialog[open] button', { hasText: 'Transbordeur' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.table === 'artist_calendar_events' && c.op === 'update').map(c => c.patch))).toEqual([{ show_id: 'sh-art' }]);
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'shows' && c.op !== 'select').length)).toBe(0);   // date existante jamais modifiée
  expectClean(ctx);
});

test('agendas : même avertissement sur tous les chemins — intérêt → option sur un jour indisponible, statut changé dans la liste', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  // date existante en « Intérêt » sur un jour indisponible : la passer en option (même jour) avertit
  const r = page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    const before = { project_id: S.db.projects[0].id, date: `${Y}-03-11`, status: 'Intérêt Salle' };
    return calCheckBeforeSave({ ...before, status: 'Option Salle' }, before); }, Y);
  await expect(page.locator('dialog[open]', { hasText: 'Artiste indisponible ?' })).toBeVisible();
  await page.locator('dialog[open] button', { hasText: 'Annuler' }).click();
  expect(await r).toBe(false);
  // option → intérêt (moins engagée), même jour : rien à redemander
  expect(await page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    const before = { project_id: S.db.projects[0].id, date: `${Y}-03-11`, status: 'Option Salle' };
    return calCheckBeforeSave({ ...before, status: 'Intérêt Salle' }, before); }, Y)).toBe(true);
  // statut changé dans la liste Booking : avertissement, et rien d'enregistré si on annule
  await page.evaluate(async Y => { const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) db.shows.push({ id: 'sh-v', project_id: S.db.projects[0].id, venue: 'Salle Témoin', city: 'Testville', date: `${Y}-03-11`, status: 'Intérêt Salle' });
    touch('shows'); (await import('./js/app.js')).render(); }, Y);
  const sel = page.locator('.gig', { hasText: 'Salle Témoin' }).locator('select');
  await sel.selectOption('Option Salle');
  await expect(page.locator('dialog[open]', { hasText: 'Artiste indisponible ?' })).toBeVisible();
  await page.locator('dialog[open] button', { hasText: 'Annuler' }).click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'shows' && c.op === 'update').length)).toBe(0);
  expectClean(ctx);
});

test('agendas : jour local de l’événement affiché ; conflit comparé sur les instants réels (fuseaux) ; journée entière sans décalage', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  const r = await page.evaluate(async Y => {
    const { evSpan, calOverlaps } = await import('./js/calendars.js'); const { S, touch } = await import('./js/state.js');
    const ART = S.db.projects[0].id;
    // concert à New York le 10/06 à 20 h (heure locale) = 11/06 à 2 h à Paris
    const ny = { id: 'e-ny', calendar_ref: 'cal-1', project_id: ART, gcal_event_id: 'e-ny', busy: true, all_day: false, deleted_at: null,
      start_at: `${Y}-06-11T00:00:00Z`, end_at: `${Y}-06-11T03:00:00Z`, time_zone: 'America/New_York', title: 'Show New York', is_show: true };
    const jour = { id: 'e-j', calendar_ref: 'cal-1', project_id: ART, gcal_event_id: 'e-j', busy: true, all_day: true, start_date: `${Y}-07-14`, end_date: `${Y}-07-15`, deleted_at: null, title: 'Fête' };
    S.db.artist_calendar_events.push(ny, jour); touch('artist_calendar_events');
    const ov = d => calOverlaps({ project_id: ART, date: d, status: 'Option Salle' }).map(e => e.id);
    return { span: evSpan(ny), le10: ov(`${Y}-06-10`), le11: ov(`${Y}-06-11`), jour: evSpan(jour), j14: ov(`${Y}-07-14`), j15: ov(`${Y}-07-15`) };
  }, Y);
  expect(r.span).toEqual([`${Y}-06-10`, `${Y}-06-10`]);   // affiché le 10/06, jour local à New York
  expect(r.le10).not.toContain('e-ny');                    // à Paris, l'instant réel tombe le 11/06
  expect(r.le11).toContain('e-ny');
  expect(r.jour).toEqual([`${Y}-07-14`, `${Y}-07-14`]);     // journée entière : dates calendaires, sans décalage
  expect(r.j14).toContain('e-j'); expect(r.j15).not.toContain('e-j');
  expectClean(ctx);
});
