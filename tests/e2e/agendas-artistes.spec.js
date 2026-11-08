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
  // en-têtes de mois : indisponibilités comptées à part, jamais « 0 date » (relecture F9)
  await expect(page.locator('h2.month small', { hasText: /indisponibilités? Google/ }).first()).toBeVisible();
  await expect(page.locator('h2.month small', { hasText: /^0 date/ })).toHaveCount(0);
  // fuseau lu dans Google échappé (relecture F1)
  await page.evaluate(async Y => { const { S, touch } = await import('./js/state.js');
    S.db.artist_calendar_events.push({ id: 'e-tz', calendar_ref: 'cal-1', project_id: S.db.projects[0].id, gcal_event_id: 'e-tz', busy: true, all_day: false, deleted_at: null,
      start_at: `${Y}-05-20T18:00:00Z`, end_at: `${Y}-05-20T19:00:00Z`, time_zone: 'Mars/<img src=x id=piege>', title: 'Fuseau piégé' });
    touch('artist_calendar_events'); (await import('./js/app.js')).render(); }, Y);
  await expect(page.locator('.gig.cal-unav', { hasText: 'Fuseau piégé' })).toContainText('<img src=x id=piege>');
  await expect(page.locator('#piege')).toHaveCount(0);
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
  await expect(page.locator('dialog[open]')).toContainText(/\((chevauchement horaire|événement artiste le même jour)\)/);   // raison affichée
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

test('agendas : jour local de l’événement affiché ; conflit = horaires réels OU même jour local, avec la raison ; journée entière sans décalage', async ({ page }) => {
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
    const ov = d => calOverlaps({ project_id: ART, date: d, status: 'Option Salle' }).map(e => `${e.id}:${e.why}`);
    // même jour ET même horaire : une seule entrée, raison « chevauchement horaire »
    const both = { id: 'e-b', calendar_ref: 'cal-1', project_id: ART, gcal_event_id: 'e-b', busy: true, all_day: false, deleted_at: null,
      start_at: `${Y}-08-02T18:00:00Z`, end_at: `${Y}-08-02T20:00:00Z`, time_zone: 'Europe/Paris', title: 'Répétition' };
    // « Disponible » (busy false) le même jour : jamais d'alerte
    const dispo = { ...both, id: 'e-d', gcal_event_id: 'e-d', busy: false, title: 'Disponible' };
    S.db.artist_calendar_events.push(both, dispo); touch('artist_calendar_events');
    return { span: evSpan(ny), le10: ov(`${Y}-06-10`), le11: ov(`${Y}-06-11`), jour: evSpan(jour), j14: ov(`${Y}-07-14`), j15: ov(`${Y}-07-15`), a02: ov(`${Y}-08-02`) };
  }, Y);
  expect(r.span).toEqual([`${Y}-06-10`, `${Y}-06-10`]);   // affiché le 10/06, jour local à New York
  expect(r.le10).toEqual(['e-ny:événement artiste le même jour']);   // pas d'horaire commun à Paris, mais jour local à New York
  expect(r.le11).toEqual(['e-ny:chevauchement horaire']);            // l'instant réel tombe le 11/06 à Paris
  expect(r.jour).toEqual([`${Y}-07-14`, `${Y}-07-14`]);     // journée entière : dates calendaires, sans décalage
  expect(r.j14).toEqual(['e-j:événement artiste le même jour']); expect(r.j15).toEqual([]);
  expect(r.a02).toEqual(['e-b:chevauchement horaire']);              // une seule alerte ; « Disponible » ignoré
  expectClean(ctx);
});

// ── v1.62 : fiche artiste (choix, état, actions), perte d'accès, dates archivées, aucune incidence financière ──
const invokes = page => page.evaluate(() => window.__calls.filter(c => c.fn === 'cal-sync').map(c => c.body));
async function ficheArtiste(page) {
  await page.evaluate(async () => { const { editProject } = await import('./js/forms.js'); const { S } = await import('./js/state.js'); editProject(S.db.projects[0].id); });
  return page.locator('#modal .cal-panel');
}

test('fiche artiste : choix explicite parmi les agendas partagés avec production@ (principal exclu, « disponibilités seulement » signalé)', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => {
    window.__FN_DATA = { 'cal-sync': b => b.mode === 'calendars'
      ? { ok: true, calendars: [{ id: 'production@x', name: 'production@', access: 'owner', primary: true },
        { id: 'a@group', name: 'Artiste essai A', access: 'reader' }, { id: 'b@group', name: 'Artiste essai B', access: 'freeBusyReader' }] }
      : { ok: true, results: [] } };
    for (const db of [window.__DB]) { db.artist_calendars = []; db.artist_calendar_events = []; }
  });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.artist_calendars = []; S.db.artist_calendar_events = []; touch('artist_calendars'); });
  const panel = await ficheArtiste(page);
  await expect(panel).toContainText('Aucun agenda relié');
  await panel.locator('[data-act=calConnect]').click();
  const dlg = page.locator('dialog[open]', { hasText: 'Agendas partagés avec production@' });
  await expect(dlg).toContainText('Artiste essai A');
  await expect(dlg).toContainText('Artiste essai B (disponibilités seulement)');
  await expect(dlg.locator('button', { hasText: /^production@$/ })).toHaveCount(0);   // agenda principal de production@ jamais proposé
  await dlg.locator('button', { hasText: 'Artiste essai B' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.table === 'artist_calendars' && c.op === 'insert').map(c => [c.patch.calendar_id, c.patch.access, c.patch.status]))).toEqual([['b@group', 'freeBusyReader', 'actif']]);
  await expect.poll(() => invokes(page)).toEqual([{ mode: 'calendars' }, { mode: 'sync', project_id: await page.evaluate(async () => (await import('./js/state.js')).S.db.projects[0].id) }]);
  // rien n'est jamais écrit dans Google : seules les actions « calendars » et « sync » (lecture) sont demandées au serveur
  expect((await invokes(page)).every(b => ['calendars', 'sync'].includes(b.mode))).toBe(true);
  expectClean(ctx);
});

test('fiche artiste : état, dernière synchronisation, erreur ; Actualiser, Suspendre, Reprendre, Déconnecter (avec confirmation)', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.evaluate(() => { window.__FN_DATA = { 'cal-sync': { ok: true, results: [] } }; });
  let panel = await ficheArtiste(page);
  await expect(panel).toContainText('Agenda fictif');
  await expect(panel).toContainText('✓ à jour');
  await expect(panel).toContainText('Dernière synchronisation réussie :');
  await expect(panel.locator('select[data-f=default_country]')).toHaveValue('FR');   // France par défaut, visible et modifiable
  await panel.locator('[data-act=calRefresh]').click();
  await expect.poll(() => invokes(page)).toEqual([{ mode: 'sync', project_id: await page.evaluate(async () => (await import('./js/state.js')).S.db.projects[0].id) }]);
  await panel.locator('[data-act=calPause]').click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.table === 'artist_calendars' && c.op === 'update').map(c => c.patch.status))).toEqual(['pause']);
  await page.locator('#modal').evaluate(d => d.close());
  panel = await ficheArtiste(page);
  await expect(panel).toContainText('Synchronisation suspendue.');
  await panel.locator('[data-act=calResume]').click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.table === 'artist_calendars' && c.op === 'update').map(c => c.patch.status))).toEqual(['pause', 'actif']);
  await expect.poll(async () => (await invokes(page)).length).toBe(2);   // reprise = relecture immédiate
  // erreur affichée telle quelle ; « disponibilités plus à jour », jamais « à jour »
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); Object.assign(S.db.artist_calendars[0], { status: 'actif', last_error: 'Agenda inaccessible (partage retiré ?) : notFound' }); touch('artist_calendars'); });
  await page.locator('#modal').evaluate(d => d.close());
  panel = await ficheArtiste(page);
  await expect(panel).toContainText('Erreur : Agenda inaccessible (partage retiré ?)');
  await expect(panel).toContainText('disponibilités plus à jour');
  await panel.locator('[data-act=calDisconnect]').click();
  await page.locator('dialog[open] button[data-ask]', { hasText: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'artist_calendars' && c.op === 'update' && c.patch.status === 'deconnecte').length)).toBe(0);
  await panel.locator('[data-act=calDisconnect]').click();
  await page.locator('dialog[open] button[data-ask]', { hasText: 'Déconnecter' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.table === 'artist_calendars' && c.op === 'update' && c.patch.status === 'deconnecte').length)).toBe(1);
  // déconnecté : plus aucun événement affiché ni bloquant
  await page.locator('#modal').evaluate(d => d.close());
  await page.evaluate(async () => (await import('./js/app.js')).render());
  await expect(page.locator('.gig.cal-unav')).toHaveCount(0);
  expectClean(ctx);
});

test('perte d’accès : avis visible dans Booking, jamais présenté comme libre ; une nouvelle date avertit même sans événement', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    Object.assign(S.db.artist_calendars[0], { last_error: 'Agenda inaccessible (partage retiré ?) : notFound' }); S.db.artist_calendar_events = []; touch('artist_calendars'); touch('artist_calendar_events');
    (await import('./js/app.js')).render(); });
  await expect(page.locator('.cal-stale')).toContainText('Disponibilités plus à jour');
  await expect(page.locator('.cal-stale')).toContainText('partage retiré');
  await expect(page.locator('.cal-stale')).toContainText('ne veut pas dire « libre »');
  const ok = page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    return calCheckBeforeSave({ project_id: S.db.projects[0].id, date: `${Y}-09-01`, status: 'Option Salle' }); }, Y);
  await expect(page.locator('dialog[open]', { hasText: 'Agenda pas à jour' })).toContainText('partage retiré');
  await page.locator('dialog[open] button', { hasText: 'Annuler' }).click();
  expect(await ok).toBe(false);
  expectClean(ctx);
});

test('dates archivées : jamais proposées à l’association, hors conflits ; l’événement associé à une date archivée redevient visible', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.evaluate(async Y => { const { S, touch } = await import('./js/state.js'); const ART = S.db.projects[0].id;
    for (const db of [S.db, window.__DB]) db.shows.push({ id: 'sh-arch', project_id: ART, venue: 'Salle archivée', city: 'Lyon', date: `${Y}-04-02`, status: 'Confirmée Artiste', archived_at: '2026-11-07T10:00:00Z' });
    touch('shows'); (await import('./js/app.js')).render(); }, Y);
  // association : la date archivée n'est pas proposée
  await page.locator('.gig.cal-unav', { hasText: 'SHOW Lyon' }).locator('[data-act=calAssociate]').click();
  await expect(page.locator('.toast').filter({ hasText: 'Aucune date « Option / Confirmée Artiste »' }).first()).toBeVisible();
  // événement déjà associé à une date ensuite archivée : il réapparaît (liste, carte), sans double affichage avec la date archivée
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.artist_calendar_events.find(e => e.id === 'e-show').show_id = 'sh-arch'; touch('artist_calendar_events'); (await import('./js/app.js')).render(); });
  await expect(page.locator('.gig.cal-unav', { hasText: 'SHOW Lyon' })).toContainText('Date artiste — calendrier Google');
  await expect(page.locator('.gig:not(.cal-unav)', { hasText: 'Salle archivée' })).toHaveCount(0);
  expect(await page.evaluate(async Y => (await import('./js/calendars.js')).calMapPoints(null, Y).points.length, Y)).toBe(1);
  // une date archivée n'entre dans aucun conflit (aucune question)
  expect(await page.evaluate(async Y => { const { calCheckBeforeSave } = await import('./js/calendars.js'); const { S } = await import('./js/state.js');
    return calCheckBeforeSave({ project_id: S.db.projects[0].id, date: `${Y}-03-11`, status: 'Option Salle', archived_at: '2026-11-07T10:00:00Z' }); }, Y)).toBe(true);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expectClean(ctx);
});

test('aucune incidence financière : chiffres de Booking identiques avec ou sans agenda ; aucune écriture sur les dates, factures ou budgets', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.year = new Date().getFullYear() + 1; S.db.artist_calendars = []; S.db.artist_calendar_events = []; touch('artist_calendars'); const app = await import('./js/app.js'); app.go('booking'); app.render(); });
  const avant = await page.locator('.view-head .vh-title .sub').textContent();
  await preparer(page);
  const apres = await page.locator('.view-head .vh-title .sub').textContent();
  expect(apres).toBe(avant);
  expect(await page.evaluate(() => window.__calls.filter(c => ['shows', 'show_payments', 'budget_lines', 'commission_transfers'].includes(c.table) && c.op !== 'select').length)).toBe(0);
  expectClean(ctx);
});
