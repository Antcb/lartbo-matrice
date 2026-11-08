// v1.63 : messagerie intégrée (boîte anthony@), suite — données et réponses Gmail FICTIVES (script et synchronisation simulés, réseau bloqué).
// Rattachement ambigu, conversation non rattachée, interlocuteur jamais arbitraire, documents des projets (vraies pièces jointes, tailles,
// droits, limite encodée), classement (libellé / archive / corbeille), brouillon Gmail, pièce reçue conservée sur action explicite.
import { test, expect } from '@playwright/test';
import { openApp, expectClean as clean } from './helpers.js';

const expectClean = ctx => clean({ ...ctx, errors: ctx.errors.filter(e => !/about:srcdoc|context is sandboxed|violates the following Content Security Policy/.test(e)) });
const Mo = 1048576;
const THREADS = [
  { id: 'mt-a', mailbox: 'anthony', gmail_thread_id: 'aaa111', subject: 'Disponibilités printemps', snippet: 'Bonjour', participants: ['inconnu@example.org'],
    last_message_at: '2026-11-05T10:00:00Z', message_count: 1, unread: false, labels: ['INBOX'], link_status: 'a_rattacher', link_reason: 'Contact inconnu : aucun contact n’a ces adresses' },
  { id: 'mt-b', mailbox: 'anthony', gmail_thread_id: 'bbb222', subject: 'Re: Proposition Artiste Alpha', snippet: 'Merci', participants: ['camille@example.com', 'prog@example.com'],
    last_message_at: '2026-11-04T09:00:00Z', message_count: 2, unread: false, labels: ['INBOX', 'Label_7'], structure_id: 'st-1', project_id: 'art-a', link_status: 'auto', link_reason: 'Contact connu d’une seule structure et d’un seul suivi ouvert' },
  { id: 'mt-c', mailbox: 'anthony', gmail_thread_id: 'ccc333', subject: 'Deux maisons', snippet: 'Question', participants: ['multi@example.net'],
    last_message_at: '2026-11-03T09:00:00Z', message_count: 1, unread: false, labels: ['INBOX'], link_status: 'a_rattacher', link_reason: 'Plusieurs structures possibles pour ces adresses : à choisir' },
  { id: 'mt-d', mailbox: 'anthony', gmail_thread_id: 'ddd444', subject: 'Archivée avec libellé', snippet: 'x', participants: ['camille@example.com'],
    last_message_at: '2026-11-02T09:00:00Z', message_count: 1, unread: false, labels: ['Label_7'], link_status: 'a_rattacher', link_reason: '-' },
  { id: 'mt-e', mailbox: 'anthony', gmail_thread_id: 'eee555', subject: 'À la corbeille', snippet: 'x', participants: ['camille@example.com'],
    last_message_at: '2026-11-01T09:00:00Z', message_count: 1, unread: false, labels: ['TRASH'], link_status: 'a_rattacher', link_reason: '-' },
];
const msg = (id, extra = {}) => ({ id, from: { name: 'Camille Exemple', email: 'camille@example.com' }, reply_to: [], to: [{ email: 'anthony@lartboristerie.com' }], cc: [],
  subject: 'Re: Proposition Artiste Alpha', date: '2026-11-04T09:00:00Z', snippet: 'Merci', direction: 'in', attachments: [], html: '<p>Merci</p>', ...extra });

async function preparer(page, { docs = null, files = {} } = {}) {
  await page.evaluate(async ([threads, msgs, docs, files]) => {
    const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) {
      db.mail_threads = JSON.parse(JSON.stringify(threads));
      db.mail_sync_state = [{ mailbox: 'anthony', last_run_at: '2026-11-08T10:05:00Z', last_ok_at: '2026-11-08T10:05:00Z', last_error: null }];
      db.settings.push({ key: 'prospect_script_url', value: 'https://script.google.com/macros/s/FICTIF/exec' }, { key: 'prospect_from', value: 'anthony@lartboristerie.com' });
      // contact présent dans deux structures ; contact SANS adresse dans la structure de Camille (jamais choisi d'office)
      db.contacts.push({ id: 'ct-multi', first_name: 'Multi', display_name: 'Multi Maisons', email: 'multi@example.net', roles: [] },
        { id: 'ct-sans', first_name: 'Sans', display_name: 'Aaa Sans Adresse', email: null, roles: [] });
      db.contact_structures.push({ contact_id: 'ct-multi', structure_id: 'st-1' }, { contact_id: 'ct-multi', structure_id: 'st-2' }, { contact_id: 'ct-sans', structure_id: 'st-1' });
      if (docs) { const p = db.projects.find(x => x.id === 'art-a'); p.artist_docs = JSON.parse(JSON.stringify(docs.artist)); db.attachments.push(...JSON.parse(JSON.stringify(docs.attachments))); }
    }
    for (const t of ['mail_threads', 'mail_sync_state', 'settings', 'contacts', 'contact_structures', 'projects', 'attachments']) touch(t);
    window.__STORAGE_LIST = { artiste: [{ name: 'dp.pdf', metadata: { size: 1500000 } }] };
    window.__script = []; window.__composeError = null;
    window.__FN_REPLY = {
      'script-google': b => { window.__script.push(b); const a = b.action, p = b.payload || {};
        if (a === 'labels') return { ok: true, labels: [{ id: 'Label_7', name: 'Booking 2027', type: 'user' }] };
        if (a === 'thread') return { ok: true, thread: { id: p.thread_id, messages: msgs[p.thread_id] || [] } };
        if (a === 'modify') return { ok: true, labels: [] };
        if (a === 'files_info') return { ok: true, files: (p.ids || []).map(id => files[id] ? { id, ok: true, ...files[id] } : { id, ok: false, error: 'Inaccessible depuis ce compte Google' }) };
        if (a === 'attachment') return { ok: true, size: 8, data: 'JVBERi0xLjQ' };
        if (a === 'compose') { if (window.__composeError) return { ok: false, error: window.__composeError };
          return p.send ? { ok: true, sent: true, thread_id: p.thread_id || 'neuf', message_id: 'm-env' } : { ok: true, sent: false, draft_id: p.draft_id || 'd-1' }; }
        return { ok: true }; },
      'mail-sync': () => ({ ok: true, threads: 1, journal: 0, remaining: 0 }),
    };
    const app = await import('./js/app.js'); app.go('mails'); app.render();
  }, [THREADS, {
    aaa111: [msg('a-1', { from: { name: '', email: 'inconnu@example.org' }, subject: 'Disponibilités printemps' })],
    bbb222: [msg('b-1', { reply_to: [{ email: 'prog@example.com', name: '' }], attachments: [{ name: 'contrat-signe.pdf', size: 120000, mime: 'application/pdf', id: 'att-1' }] })],
    ccc333: [msg('c-1', { from: { name: 'Multi', email: 'multi@example.net' }, subject: 'Deux maisons' })],
    eee555: [msg('e-1', { subject: 'À la corbeille' })],
  }, docs, files]);
}
const script = (page, action) => page.evaluate(a => window.__script.filter(b => b.action === a).map(b => b.payload), action);
const rpcs = (page, name) => page.evaluate(n => window.__calls.filter(c => c.rpc === n).map(c => c.args), name);
const ouvrir = async (page, sujet) => { await page.locator('.mail-row', { hasText: sujet }).click(); await expect(page.locator('.mail-msg').first()).toBeVisible(); };
const dlg = page => page.locator('dialog.ask[open]');

test('v1.63 : plusieurs structures possibles → choix demandé (aucun premier choix) ; Annuler ne rattache rien ; le choix fait foi', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await ouvrir(page, 'Deux maisons');
  await expect(page.locator('.mail-linkbox')).toContainText('Structures possibles : ');
  await expect(page.locator('.mail-linkbox')).toContainText('Festival Fictif');
  await page.locator('.mail-linkbox [data-act=mailLink]').click();
  await expect(dlg(page)).toContainText('Plusieurs structures possibles');
  await expect(dlg(page).locator('button', { hasText: 'Salle Exemple' })).toBeVisible();
  await dlg(page).locator('button', { hasText: 'Annuler' }).click();
  await expect(page.locator('#modal[open]')).toHaveCount(0);
  expect(await rpcs(page, 'mail_link_manual')).toEqual([]);
  await page.locator('.mail-linkbox [data-act=mailLink]').click();
  await dlg(page).locator('button', { hasText: 'Festival Fictif' }).click();
  await expect(page.locator('#modal [name=structure_id]')).toHaveValue('st-2');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => rpcs(page, 'mail_link_manual')).toEqual([{ p_thread: 'mt-c', p_structure: 'st-2', p_prospect: null, p_project: null, p_show: null }]);
  expectClean(ctx);
});

test('v1.63 : conversation non rattachée lisible, réponse possible, reste « À rattacher » (aucun rattachement implicite)', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.locator('[data-act=mailFilter][data-f=link]').click();
  await ouvrir(page, 'Disponibilités printemps');
  await expect(page.locator('.mail-linkbox')).toContainText('À rattacher');
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply]').first().click();
  await expect(page.locator('#mc-to')).toHaveValue('inconnu@example.org');
  await page.locator('#modal button[type=submit]').click();
  await dlg(page).locator('button', { hasText: 'Envoyer le mail' }).click();
  await expect.poll(async () => (await script(page, 'compose')).length).toBe(1);
  expect((await script(page, 'compose'))[0]).toMatchObject({ mode: 'reply', thread_id: 'aaa111', send: true });
  expect(await rpcs(page, 'mail_link_manual')).toEqual([]);
  expect(await page.evaluate(async () => (await import('./js/state.js')).S.db.mail_threads.find(t => t.id === 'mt-a').link_status)).toBe('a_rattacher');
  expectClean(ctx);
});

test('v1.63 : interlocuteur des balises jamais choisi d’office (adresse de réponse inconnue, contact sans adresse présent)', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await ouvrir(page, 'Proposition');
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply]').first().click();
  await expect(page.locator('#mc-to')).toHaveValue('prog@example.com');   // adresse de réponse du message
  await expect(page.locator('#mc-contact')).toHaveValue('');               // aucun contact n'a cette adresse : aucun interlocuteur
  expectClean(ctx);
});

const DOCS = {
  artist: [
    { kind: 'tech_rider', name: 'FT Alpha.pdf', path: 'art-a/ft.pdf', size: 250000 },
    { kind: 'press_kit', name: 'DP Alpha.pdf', path: 'art-a/dp.pdf' },                       // taille lue dans le stockage (1,4 Mo)
    { kind: 'logos', name: 'Logo.png', file_id: 'drive-ok-0001' },                           // Drive accessible au compte
    { kind: 'photos', name: 'Photo privée.jpg', file_id: 'drive-prive-01' },                 // Drive NON accessible : jamais joint
  ],
  attachments: [{ id: 'at-p1', project_id: 'art-a', name: 'Rider son.pdf', path: 'project/art-a/rider.pdf', size: 90000, mime: 'application/pdf' }],
};

test('v1.63 : « Ajouter depuis un projet/spectacle » — fiche technique, dossier de presse, documents ; vraies pièces jointes, noms et tailles, droits respectés', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { docs: DOCS, files: { 'drive-ok-0001': { name: 'Logo.png', size: 30000, mime: 'image/png' } } });
  await ouvrir(page, 'Proposition');
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply]').first().click();
  await page.locator('#mc-docs').click();
  const d = dlg(page);
  await expect(d).toContainText('Non joignables (Photo privée.jpg)');
  await expect(d.locator('button', { hasText: 'Fiche technique (avec le plan de scène) · FT Alpha.pdf (244 Ko)' })).toBeVisible();
  await expect(d.locator('button', { hasText: 'Dossier de presse / EPK · DP Alpha.pdf (1,4 Mo)' })).toBeVisible();
  await expect(d.locator('button', { hasText: 'Logos · Logo.png (29 Ko)' })).toBeVisible();
  await expect(d.locator('button', { hasText: 'Document du projet · Rider son.pdf (88 Ko)' })).toBeVisible();
  await expect(d.locator('button', { hasText: 'Photo privée' })).toHaveCount(0);
  await d.locator('button', { hasText: 'FT Alpha.pdf' }).click();
  await dlg(page).locator('button', { hasText: 'Logo.png' }).click();   // la question revient : plusieurs pièces
  await expect(dlg(page).locator('button', { hasText: 'FT Alpha.pdf' })).toHaveCount(0);
  await dlg(page).locator('button', { hasText: 'Terminé' }).click();
  await expect(page.locator('#mc-files')).toContainText('FT Alpha.pdf');
  await expect(page.locator('#mc-files')).toContainText('244 Ko');
  await expect(page.locator('#mc-files')).toContainText('Logo.png');
  await page.locator('#modal button[type=submit]').click();
  await dlg(page).locator('button', { hasText: 'Envoyer le mail' }).click();
  await expect.poll(async () => (await script(page, 'compose')).length).toBe(1);
  const c = (await script(page, 'compose'))[0];
  expect(c.attachments).toEqual([{ url: 'about:blank#artiste/art-a/ft.pdf', name: 'FT Alpha.pdf' }, { id: 'drive-ok-0001', name: 'Logo.png' }]);
  expect(c.html).not.toMatch(/about:blank|drive\.google|art-a\/ft\.pdf/);   // aucune pièce remplacée par un lien
  expect(await page.evaluate(() => window.__signed.filter(s => s.bucket === 'artiste'))).toEqual([{ bucket: 'artiste', path: 'art-a/ft.pdf', expires: 600 }]);
  expect((await script(page, 'files_info'))[0]).toEqual({ ids: ['drive-ok-0001', 'drive-prive-01'] });
  expectClean(ctx);
});

test('v1.63 : limite Gmail vérifiée sur le message encodé AVANT l’envoi (19 Mo bruts refusés, rien n’est envoyé)', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { docs: { artist: [{ kind: 'audio', name: 'Titre long.wav', path: 'art-a/titre.wav', size: 19 * Mo }], attachments: [] } });
  await ouvrir(page, 'Proposition');
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply]').first().click();
  await page.locator('#mc-docs').click();
  await dlg(page).locator('button', { hasText: 'Titre long.wav' }).click();
  await expect(page.locator('#mc-files')).toContainText('Titre long.wav');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast').last()).toContainText('Message trop lourd');
  await expect(page.locator('.toast').last()).toContainText('une fois encodé');
  expect(await script(page, 'compose')).toEqual([]);
  await expect(dlg(page)).toHaveCount(0);   // pas même la question d'envoi
  expectClean(ctx);
});

test('v1.63 : classement distinct — libellé (Gmail), archive, corbeille et retour ; listes Archivés et Corbeille', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await expect(page.locator('.mail-row', { hasText: 'Archivée avec libellé' })).toHaveCount(0);   // hors boîte de réception
  await expect(page.locator('.mail-row', { hasText: 'À la corbeille' })).toHaveCount(0);
  await page.locator('select[data-change=mailLabelPick]').selectOption('ARCHIVED');
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await expect(page.locator('.mail-row')).toContainText('Archivée avec libellé');
  await page.locator('select[data-change=mailLabelPick]').selectOption('Label_7');   // vrai libellé Gmail : archivée ET en boîte de réception
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await page.locator('select[data-change=mailLabelPick]').selectOption('TRASH');
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await ouvrir(page, 'À la corbeille');
  await expect(page.locator('[data-act=mailTrash]')).toHaveCount(0);
  await expect(page.locator('[data-act=mailArchive]')).toHaveCount(0);
  await page.locator('[data-act=mailUntrash]').click();
  await expect.poll(() => script(page, 'modify')).toEqual([{ thread_id: 'eee555', untrash: true }]);
  await page.locator('[data-act=mailBack]').click();
  await page.locator('select[data-change=mailLabelPick]').selectOption('');
  await ouvrir(page, 'Proposition');
  await page.locator('[data-act=mailArchive]').click();
  await page.locator('[data-act=mailLabel]').click();
  await dlg(page).locator('button', { hasText: 'Retirer « Booking 2027 »' }).click();
  await expect.poll(async () => (await script(page, 'modify')).slice(1)).toEqual([{ thread_id: 'bbb222', archive: true }, { thread_id: 'bbb222', remove: ['Label_7'] }]);
  const syncs = await page.evaluate(() => window.__calls.filter(c => c.fn === 'mail-sync').map(c => c.body));
  expect(syncs.every(b => b.mode === 'threads')).toBe(true);   // chaque rangement relu dans Gmail
  expectClean(ctx);
});

test('v1.63 : brouillon Gmail mis à jour (même identifiant) ; brouillon disparu de Gmail → rien ne part, nouveau brouillon ensuite', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await ouvrir(page, 'Proposition');
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply]').first().click();
  await page.locator('#mc-draft').click();
  await expect(page.locator('.toast').last()).toContainText('Brouillon enregistré dans Gmail');
  await page.locator('#mc-draft').click();
  await expect.poll(async () => (await script(page, 'compose')).map(c => [c.send, c.draft_id])).toEqual([[false, null], [false, 'd-1']]);
  await page.evaluate(() => { window.__composeError = 'Error: BROUILLON_ABSENT : le brouillon n’existe plus dans Gmail (envoyé ou supprimé depuis Gmail ou Apple Mail). Rien n’est parti.'; });
  await page.locator('#modal button[type=submit]').click();
  await dlg(page).locator('button', { hasText: 'Envoyer le mail' }).click();
  await expect(page.locator('.toast').last()).toContainText('Le brouillon n’existe plus dans Gmail');
  await expect(page.locator('#modal')).toBeVisible();
  await page.evaluate(() => { window.__composeError = null; });
  await page.locator('#mc-draft').click();
  await expect.poll(async () => (await script(page, 'compose')).map(c => c.draft_id)).toEqual([null, 'd-1', 'd-1', null]);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'mail-sync').length)).toBe(0);   // rien d'envoyé, rien au journal
  expectClean(ctx);
});

test('v1.63 : pièce reçue conservée dans le projet seulement sur action explicite (Annuler ne copie rien)', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await ouvrir(page, 'Proposition');
  const n0 = await page.evaluate(() => window.__DB.attachments.length);
  await page.locator('[data-act=mailAttKeep]').click();
  await expect(dlg(page)).toContainText('Conserver la pièce jointe ?');
  await expect(dlg(page).locator('button', { hasText: 'Dans les documents de Artiste Alpha' })).toBeVisible();
  await dlg(page).locator('button', { hasText: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__DB.attachments.length)).toBe(n0);
  expect(await script(page, 'attachment')).toEqual([]);
  await page.locator('[data-act=mailAttKeep]').click();
  await dlg(page).locator('button', { hasText: 'Dans les documents de Artiste Alpha' }).click();
  await expect.poll(() => page.evaluate(() => window.__DB.attachments.filter(a => a.project_id === 'art-a' && a.name === 'contrat-signe.pdf').length)).toBe(1);
  expectClean(ctx);
});

test('v1.63 : script de prospection pas à jour (action inconnue) → marche à suivre affichée, rien d’autre', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.evaluate(() => { const old = window.__FN_REPLY['script-google'];
    window.__FN_REPLY['script-google'] = b => b.action === 'thread' ? { ok: false, error: 'Action inconnue : thread' } : old(b); });
  await page.locator('.mail-row', { hasText: 'Proposition' }).click();
  await expect(page.locator('.mail-err[role=alert]')).toContainText('n’est pas à jour : Réglages › Prospection');
  expectClean(ctx);
});
