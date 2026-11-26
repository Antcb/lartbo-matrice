// (v1.66 : le texte intégral remplace l'extrait affiché : boutons « Lire en entier » visés par l'identifiant de l'entrée)
// v1.65 — journal d'un suivi : « Lire en entier » (message de la messagerie ou .eml joint, jamais de copie du corps), chronologie réelle
// (occurred_at, ordre stable, repli explicite), .eml affichés avec leur mail (cas de référence : suivi Ressins Folies du 17/11/2026,
// données FICTIVES de même forme) ; dépôt hors zone dit et noté ; issue de l'import d'un mail notée sans contenu ni adresse ;
// champ « Artiste » de Nouveau mail / Répondre classé par utilisation. Réseau bloqué, Gmail et stockage simulés.
import { test, expect } from '@playwright/test';
import { openApp, expectClean as clean } from './helpers.js';

// v1.66.1 : « Lire en entier » est masqué quand le texte intégral est déjà affiché dans le journal ; la lecture à la source (v1.65)
// reste la même action (data-act=readLog), essayée ici directement sur ces entrées
async function lire(page, id){
  // attendre la fin de la lecture des textes intégraux (le bouton peut disparaître au rendu suivant)
  await page.waitForFunction(() => ![...document.querySelectorAll('.log-extrait')].some(e => /lecture du texte complet/.test(e.textContent)));
  const b = page.locator(`[data-act=readLog][data-id="${id}"]`);
  if (await b.count()) return b.click();
  await page.evaluate(i => { const x = Object.assign(document.createElement('button'), { type: 'button' }); x.dataset.act = 'readLog'; x.dataset.id = i;
    (document.querySelector('main') || document.body).appendChild(x); x.click(); x.remove(); }, id);
}

// le cadre de lecture isolé (sandbox) signale le blocage de ses ressources : effet voulu (comme messagerie-v161)
const expectClean = ctx => clean({ ...ctx, errors: ctx.errors.filter(e => !/about:srcdoc|context is sandboxed|violates the following Content Security Policy/.test(e)) });
const D = '2026-11-17';
const LOGS = [
  { id: 'lr-a', prospect_id: 'pr-1', date: D, kind: 'Mail', author: 'Messagerie', contact_name: null, created_at: '2026-11-17T10:20:06.072651+00:00',
    occurred_at: '2026-11-17T10:08:56+00:00', gmail_message_id: 'g01', import_key: 'msgid:<a1@exemple.test>', body: 'Mail envoyé à prog@example.com — « Re: Proposition 2028 »\nPREMIER message envoyé' },
  { id: 'lr-b', prospect_id: 'pr-1', date: D, kind: 'Mail', author: 'Messagerie', contact_name: 'prog@example.com', created_at: '2026-11-17T10:20:06.072651+00:00',
    occurred_at: '2026-11-17T10:16:18+00:00', gmail_message_id: 'g02', import_key: 'msgid:<a2@exemple.test>', body: 'Mail reçu de prog@example.com — « RE: Proposition 2028 »\nDEUXIÈME message reçu' },
  { id: 'lr-0', prospect_id: 'pr-1', date: D, kind: 'Mail', author: 'Messagerie', contact_name: null, created_at: '2026-11-17T10:25:07+00:00',
    occurred_at: '2026-11-17T10:21:47+00:00', gmail_message_id: 'g03', import_key: 'msgid:<a3@exemple.test>', body: 'Mail envoyé à prog@example.com — « Re: Proposition 2028 »\nTROISIÈME message envoyé' },
];
const at = '2026-11-20T14:31:0';
const FILES = [
  { id: 'pf-1', prospect_id: 'pr-1', name: 'Re Proposition 2028.eml', path: 'pr-1/1_Re_1.eml', size: 16144, mime: 'message/rfc822', import_key: 'msgid:<a1@exemple.test>', created_at: at + '6.6Z' },
  { id: 'pf-2', prospect_id: 'pr-1', name: 'RE Proposition 2028.eml', path: 'pr-1/2_RE.eml', size: 366743, mime: 'message/rfc822', import_key: 'msgid:<a2@exemple.test>', created_at: at + '7.0Z' },
  { id: 'pf-2b', prospect_id: 'pr-1', name: 'devis-fictif.pdf', path: 'pr-1/2_devis.pdf', size: 1000, mime: 'application/pdf', import_key: 'msgid:<a2@exemple.test>:pj:1', created_at: at + '7.1Z' },
  { id: 'pf-3', prospect_id: 'pr-1', name: 'Re Proposition 2028 (3).eml', path: 'pr-1/3_Re.eml', size: 32255, mime: 'message/rfc822', import_key: 'msgid:<a3@exemple.test>', created_at: at + '7.3Z' },
  { id: 'pf-x', prospect_id: 'pr-1', name: 'Plaquette-fictive.pdf', path: 'pr-1/plaquette.pdf', size: 352109, mime: 'application/pdf', import_key: null, created_at: '2026-10-07T20:37:31Z' },
];
const LONG = Array.from({ length: 160 }, (_, i) => `<p>Ligne ${i + 1} du mail reçu, assez longue pour occuper toute la largeur du cadre de lecture.</p>`).join('') + '<p id="fin">DERNIÈRE LIGNE DU MAIL</p>';
const GMSG = (id, html) => ({ id, from: { name: 'Prog Fictive', email: 'prog@example.com' }, reply_to: [], to: [{ email: 'anthony@lartboristerie.com' }], cc: [],
  subject: 'RE: Proposition 2028', date: '2026-11-17T10:16:18Z', snippet: 'x', direction: 'in', attachments: [], html });
/** Mail .eml fictif : texte de plus de 6 000 caractères, historique cité, dernière ligne repérable (le journal n'en garde qu'une partie) */
const EML = ['From: Prog Fictive <prog@example.com>', 'To: anthony-fictif@example.com', 'Subject: RE: Proposition 2028', 'Message-ID: <a2@exemple.test>',
  'Date: Tue, 17 Nov 2026 11:16:18 +0100', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '',
  ...Array.from({ length: 90 }, (_, i) => `Paragraphe ${i + 1} : texte fictif du mail, assez long pour dépasser la limite de six mille caractères du journal.`),
  '', 'Le lun. 16 nov. 2026, anthony-fictif@example.com a écrit :', '> Message cité, gardé dans le mail complet', '> FIN DU MAIL CITÉ', ''].join('\r\n');
/** Octets UTF-8 du mail, un caractère par octet (forme lue par l'application et par la fausse base) */
const bin = s => Buffer.from(s, 'utf8').toString('latin1');

/** Suivi pr-1 ouvert avec le journal de référence ; opts : messages synchronisés, conversation Gmail, fichiers stockés, propriétaire de la boîte */
async function ouvrir(page, { logs = LOGS, files = FILES, msgs = [], gmail = null, stored = {}, owner = true } = {}){
  await page.evaluate(async ([logs, files, msgs, gmail, stored, owner]) => {
    const { S, touch } = await import('./js/state.js');
    const thread = { id: 'mt-r', mailbox: 'anthony', gmail_thread_id: 'thr1', subject: 'Re: Proposition 2028', snippet: 'x', participants: ['prog@example.com'],
      last_message_at: '2026-11-17T10:21:47Z', message_count: 3, unread: false, labels: ['INBOX'], structure_id: 'st-1', prospect_id: 'pr-1', link_status: 'auto', link_reason: '-' };
    for (const db of [S.db, window.__DB]){
      db.prospect_logs.push(...JSON.parse(JSON.stringify(logs))); db.prospect_files.push(...JSON.parse(JSON.stringify(files)));
      db.mail_threads = [JSON.parse(JSON.stringify(thread))]; db.mail_messages = JSON.parse(JSON.stringify(msgs));
      db.mail_sync_state = [{ mailbox: 'anthony', last_run_at: '2026-11-17T10:30:00Z', last_ok_at: '2026-11-17T10:30:00Z', last_error: null }];
      db.settings.push({ key: 'prospect_script_url', value: 'https://script.google.com/macros/s/FICTIF/exec' }, { key: 'prospect_from', value: 'anthony@lartboristerie.com' });
    }
    for (const t of ['prospect_logs', 'prospect_files', 'mail_threads', 'mail_sync_state', 'settings']) touch(t);
    window.__STORED = stored; window.__MAILBOX_OWNER = owner; window.__script = [];
    window.__FN_REPLY = { 'script-google': b => { window.__script.push(b);
      if (b.action === 'labels') return { ok: true, labels: [] };
      if (b.action === 'thread') return gmail ? { ok: true, thread: { id: 'thr1', subject: 'Re: Proposition 2028', messages: gmail } } : { ok: false, error: 'Conversation introuvable dans Gmail' };
      return { ok: true }; } };
    const app = await import('./js/app.js'); app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  }, [logs, files, msgs, gmail, stored, owner]);
  await expect(page.locator('.log-attach [data-drop]')).toBeVisible();
}
const journal = page => page.locator('.log-attach').locator('xpath=..');
const entrees = page => journal(page).locator(':scope > .log').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
const dlg = page => page.locator('dialog.ask[open]');

test('v1.65 chronologie (cas Ressin) : heure réelle, ordre stable, .eml et leurs pièces avec leur mail, autres fichiers à leur date', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page);
  const e = (await entrees(page)).filter(t => /message|Plaquette/.test(t));
  expect(e.map(t => (t.match(/(PREMIER|DEUXIÈME|TROISIÈME)|Plaquette/) || [])[0])).toEqual(['TROISIÈME', 'DEUXIÈME', 'PREMIER', 'Plaquette']);
  // heure réelle affichée (Paris) ; le reçu de 11:16 entre les deux envois, même enregistrés à la même seconde
  expect(e[0]).toContain('17/11/2026 11:21'); expect(e[1]).toContain('17/11/2026 11:16'); expect(e[2]).toContain('17/11/2026 11:08');
  // chaque .eml (et la pièce du mail) est DANS son entrée ; aucun ne s'affiche à part au 20/11
  const recu = journal(page).locator(':scope > .log', { hasText: 'DEUXIÈME' });
  await expect(recu.locator('.file-row')).toHaveCount(2);
  await expect(recu).toContainText('RE Proposition 2028.eml'); await expect(recu).toContainText('devis-fictif.pdf');
  await expect(journal(page).locator(':scope > .log.log-file')).toHaveCount(1);
  await expect(journal(page).locator(':scope > .log.log-file')).toContainText('07/10/2026');
  // ordre identique après un nouvel affichage (aucun ordre de chargement)
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.db.prospect_logs.reverse(); const app = await import('./js/app.js'); app.render(); });
  expect((await entrees(page)).filter(t => /message|Plaquette/.test(t))).toEqual(e);
  expectClean(ctx);
});

test('v1.65 chronologie avant la reprise (occurred_at vide) : repli explicite et ordre stable', async ({ page }) => {
  const ctx = await openApp(page);
  const logs = LOGS.map(({ occurred_at, ...l }) => l)
    // note du 17/11 saisie le lendemain : heure inconnue → en tête de son jour (fin du jour)
    .concat({ id: 'lr-n', prospect_id: 'pr-1', date: D, kind: 'Note', author: 'testeur@example.com', created_at: '2026-11-18T09:00:00Z', body: 'NOTE saisie après coup' });
  await ouvrir(page, { logs });
  const ordre = async () => (await entrees(page)).filter(t => /message|NOTE/.test(t)).map(t => (t.match(/PREMIER|DEUXIÈME|TROISIÈME|NOTE/) || [])[0]);
  const avant = await ordre();
  expect(avant[0]).toBe('NOTE'); expect(avant[1]).toBe('TROISIÈME');            // 11:25 enregistré : avant les deux enregistrés à 11:20
  expect(avant.slice(2).sort()).toEqual(['DEUXIÈME', 'PREMIER']);
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); S.db.prospect_logs.reverse(); const app = await import('./js/app.js'); app.render(); });
  expect(await ordre()).toEqual(avant);                                           // même seconde : départage par identifiant, stable
  // aucune heure affichée sans heure réelle
  expect((await entrees(page)).find(t => t.includes('TROISIÈME'))).not.toMatch(/17\/11\/2026 \d\d:\d\d/);
  expectClean(ctx);
});

test('v1.65 « Lire en entier » d’un mail synchronisé : conversation ouverte sur CE message, lisible jusqu’à la dernière ligne', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { msgs: [{ id: 'mm-2', thread_id: 'mt-r', gmail_message_id: 'g02', prospect_log_id: 'lr-b', sent_at: '2026-11-17T10:16:18Z' }],
    gmail: [GMSG('g01', '<p>premier</p>'), GMSG('g02', LONG), GMSG('g03', '<p>troisième</p>')] });
  // entrée sans source complète (note) : pas de bouton
  await expect(journal(page).locator(':scope > .log', { hasText: 'Note de test' }).locator('[data-act=readLog]')).toHaveCount(0);
  await lire(page, 'lr-b');
  const msg = page.locator('.mail-msg.focus[data-msg="g02"]');
  await expect(msg).toBeVisible();
  await expect(page.locator('.mail-msg')).toHaveCount(3);
  // (v1.66) le journal lit aussi la conversation pour le texte intégral : toutes les lectures visent cette conversation
  const lus = await page.evaluate(() => (window.__script || []).filter(b => b.action === 'thread').map(b => b.payload.thread_id));
  expect(lus.length).toBeGreaterThan(0); expect([...new Set(lus)]).toEqual(['thr1']);
  const fin = msg.frameLocator('iframe.mail-frame').locator('#fin');
  await fin.scrollIntoViewIfNeeded();
  await expect(fin).toBeInViewport();
  expectClean(ctx);
});

test('v1.65 « Lire en entier » sur iPhone (390 px) : le cadre tient dans l’écran et défile jusqu’à la dernière ligne', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ctx = await openApp(page);
  await ouvrir(page, { msgs: [{ id: 'mm-2', thread_id: 'mt-r', gmail_message_id: 'g02', prospect_log_id: 'lr-b' }], gmail: [GMSG('g02', LONG)] });
  await lire(page, 'lr-b');
  const frame = page.locator('.mail-msg.focus iframe.mail-frame');
  await frame.scrollIntoViewIfNeeded();
  const box = await frame.boundingBox();
  expect(box.height).toBeLessThanOrEqual(844); expect(box.width).toBeLessThanOrEqual(390);
  const fin = page.frameLocator('.mail-msg.focus iframe.mail-frame').locator('#fin');
  await fin.scrollIntoViewIfNeeded();
  await expect(fin).toBeInViewport();
  // aucun défilement horizontal de la page
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expectClean(ctx);
});

test('v1.65 « Lire en entier » : message retiré de la conversation, ou introuvable dans la messagerie → dit clairement', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { msgs: [{ id: 'mm-2', thread_id: 'mt-r', gmail_message_id: 'g02', prospect_log_id: 'lr-b' }], gmail: [GMSG('g01', '<p>premier</p>')], files: [] });
  await lire(page, 'lr-b');
  await expect(page.locator('main .mail-err[role=alert]')).toContainText('n’est plus dans cette conversation Gmail');
  // entrée dont le message n'est pas dans la messagerie synchronisée, sans .eml : fenêtre d'explication, rien d'autre
  await page.evaluate(async () => { const app = await import('./js/app.js'); const { S } = await import('./js/state.js'); app.go('prospects'); S.suiviPage = 'pr-1'; app.render(); });
  await lire(page, 'lr-a');
  await expect(dlg(page)).toContainText('Mail complet inaccessible');
  await expect(dlg(page)).toContainText('n’est pas (ou plus) dans la messagerie synchronisée');
  await dlg(page).locator('button', { hasText: 'Fermer' }).click();
  expectClean(ctx);
});

test('v1.65 « Lire en entier » d’un mail importé : le .eml complet (au-delà de 6 000 caractères, historique cité compris) ; .eml absent → dit', async ({ page }) => {
  const ctx = await openApp(page);
  const logs = [{ ...LOGS[1], author: 'testeur@example.com', gmail_message_id: null, body: 'Reçu — **RE: Proposition 2028**\n\nDEUXIÈME message reçu (texte coupé)' }];
  await ouvrir(page, { logs, files: [FILES[1]], stored: { 'suivi/pr-1/2_RE.eml': bin(EML) } });
  await lire(page, 'lr-b');
  const d = page.locator('dialog.ask.read[open]');
  await expect(d).toContainText('De : Prog Fictive <prog@example.com>');
  await expect(d).toContainText('Date : 17/11/2026 11:16');
  const fin = d.frameLocator('iframe.mail-frame').locator('text=FIN DU MAIL CITÉ');
  await fin.scrollIntoViewIfNeeded();
  await expect(fin).toBeInViewport();
  await expect(d.locator('button', { hasText: 'Télécharger le .eml' })).toBeVisible();
  await d.locator('button', { hasText: 'Fermer' }).click();
  // fichier absent du stockage
  await page.evaluate(() => { window.__STORED = {}; });
  await lire(page, 'lr-b');
  await expect(dlg(page)).toContainText('introuvable dans le stockage');
  await expect(dlg(page)).toContainText('Rien n’a été modifié');
  expectClean(ctx);
});

test('v1.65 « Lire en entier » hors du compte d’Anthony : .eml joint lu ; sans .eml, la raison est donnée (boîte réservée)', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { owner: false, files: [FILES[1]], stored: { 'suivi/pr-1/2_RE.eml': bin(EML) } });
  await lire(page, 'lr-b');
  await expect(page.locator('dialog.ask.read[open]')).toContainText('RE: Proposition 2028');
  await page.locator('dialog.ask.read[open] button', { hasText: 'Fermer' }).click();
  await lire(page, 'lr-0');
  await expect(dlg(page)).toContainText('réservée au compte d’Anthony');
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'mail_messages').length)).toBe(0);   // aucune lecture de la boîte
  expectClean(ctx);
});

test('v1.65 mail importé : l’heure réelle (en-tête Date) est enregistrée ; base sans la colonne → même ligne, sans elle', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [], files: [] });
  const deposer = () => page.evaluate(eml => {
    const f = new File([Uint8Array.from(eml, c => c.charCodeAt(0) & 255)], 'mail.eml', { type: 'message/rfc822' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, bin(EML));
  await deposer();
  await expect.poll(() => page.evaluate(() => window.__DB.prospect_logs.filter(l => l.import_key === 'msgid:<a2@exemple.test>').map(l => [l.date, l.occurred_at])))
    .toEqual([['2026-11-17', '2026-11-17T10:16:18.000Z']]);
  // migration v1.65 pas encore appliquée : colonne refusée par la base → ligne enregistrée sans elle
  await page.evaluate(async () => { window.__MISSING_COL = { prospect_logs: 'occurred_at' };
    for (const t of ['prospect_logs', 'prospect_files']){ window.__DB[t].length = 0; const { S, touch } = await import('./js/state.js'); S.db[t] = S.db[t].filter(r => r.prospect_id !== 'pr-1'); touch(t); } });
  await deposer();
  await expect.poll(() => page.evaluate(() => window.__DB.prospect_logs.filter(l => l.import_key === 'msgid:<a2@exemple.test>').map(l => [l.date, 'occurred_at' in l])))
    .toEqual([['2026-11-17', false]]);
  expectClean(ctx);
});

test('v1.65 dépôt hors zone : mail ou fichier lâché à côté → message clair et diagnostic ; lien ordinaire, champ de saisie, glisser interne → rien', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [], files: [] });
  const lacher = (sel, data) => page.evaluate(([sel, data]) => {
    const dt = new DataTransfer(); for (const [k, v] of Object.entries(data)) dt.setData(k, v);
    const el = document.querySelector(sel);
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }); el.dispatchEvent(over);
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return over.defaultPrevented;
  }, [sel, data]);
  const lien = { 'text/uri-list': 'message:%3Cpopup-fictif@example.com%3E', 'text/plain': 'Release fictive' };
  expect(await lacher('.suivi-head', lien)).toBe(true);                         // accepté pour pouvoir répondre
  await expect(page.locator('.toast').last()).toContainText('dépose le mail (ou le fichier) sur la zone « Pièces jointes » d’un suivi');
  const diag = () => page.evaluate(() => window.__DB.client_errors.filter(r => r.message === 'dépôt : hors zone').map(r => r.stack));
  await expect.poll(diag).toHaveLength(1);
  const st = (await diag())[0];
  expect(st).toContain('"Message-ID présent":"oui"'); expect(st).not.toContain('popup-fictif'); expect(st).not.toContain('Release fictive');
  // lien ordinaire : rien à dire
  await lacher('.suivi-head', { 'text/uri-list': 'https://example.com/page' });
  // texte glissé dans un champ de saisie : comportement normal du navigateur, aucun message
  expect(await lacher('.log-form textarea', lien)).toBe(false);
  // glisser commencé dans la page : jamais traité comme un dépôt
  await page.evaluate(() => document.querySelector('.suivi-head').dispatchEvent(new DragEvent('dragstart', { bubbles: true })));
  await lacher('.suivi-head', lien);
  await page.evaluate(() => document.querySelector('.suivi-head').dispatchEvent(new DragEvent('dragend', { bubbles: true })));
  await page.waitForTimeout(300);
  expect(await diag()).toHaveLength(1);
  expect(await page.locator('.toast', { hasText: 'Pièces jointes' }).count()).toBe(1);
  expectClean(ctx);
});

test('v1.65 issue de l’import d’un mail glissé notée avec le suivi visé, sans contenu ni adresse (importé ; joint à un autre suivi)', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [], files: [] });
  const raw = bin(EML);
  await page.evaluate(raw => {
    window.__FN_REPLY['script-google'] = b => { (window.__script ||= []).push(b);
      if (b.action !== 'thread_by_msgid') return { ok: true };
      const m = { gmail_id: 'abc123def456', message_id: '<a2@exemple.test>', subject: 'RE: Proposition 2028', from: 'prog@example.com', to: 'anthony-fictif@example.com', date: '2026-11-17T10:16:18Z', att: 0 };
      return { ok: true, found: true, thread_id: 'thr1', total: 1, messages: [b.payload.want ? { ...m, raw } : m], rest: [] }; };
    window.__DB.settings.push({ key: 'drive_webhook_url', value: 'https://script.google.com/macros/s/fictif-production/exec' });
  }, raw);
  const lacher = () => page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/uri-list', 'message:%3Ca2@exemple.test%3E');
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); });
  await lacher();
  const issues = () => page.evaluate(() => window.__DB.client_errors.filter(r => r.message.startsWith('import mail : ')).map(r => [r.message, JSON.parse(r.stack)]));
  await expect.poll(issues).toEqual([['import mail : importé', { suivi: 'pr-1', ajoutés: 1, complétés: 0, présents: 0, fichiers: 1, erreurs: 0, motifs: [], tronquée: false }]]);
  // même message déposé dans un autre suivi : refusé, noté avec ce suivi
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); const p2 = { id: 'pr-2', name: 'Suivi 2', project_id: 'art-a', structure_id: 'st-2', status: 'Interest' };
    window.__DB.prospects.push({ ...p2 }); S.db.prospects.push({ ...p2 }); touch('prospects'); const app = await import('./js/app.js'); S.suiviPage = 'pr-2'; app.render(); });
  await lacher();
  await expect.poll(async () => (await issues()).map(([m, d]) => [m, d.suivi])).toEqual([['import mail : importé', 'pr-1'], ['import mail : joint à un autre suivi', 'pr-2']]);
  const tout = JSON.stringify(await issues());
  for (const interdit of ['a2@exemple.test', 'prog@example.com', 'Proposition', 'Paragraphe']) expect(tout).not.toContain(interdit);
  expectClean(ctx);
});

test('v1.65 champ « Artiste » de Nouveau mail et Répondre : les plus utilisés d’abord (projUsage), inactifs exclus sauf l’artiste du mail', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { gmail: [GMSG('g02', '<p>x</p>')] });
  // Artiste Bêta devient le plus utilisé (ordre différent de l'ordre alphabétique et de l'ordre de la base)
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    for (let i = 0; i < 8; i++) S.db.tasks.push({ id: 'tb-' + i, title: 'Tâche Bêta ' + i, status: 'To Do', project_id: 'art-b', tags: [], created_at: new Date().toISOString() });   // (v1.66.3) activité récente
    touch('tasks'); const app = await import('./js/app.js'); app.go('mails'); app.render(); });
  const options = () => page.locator('#mc-proj option').evaluateAll(o => o.map(x => x.value));
  await page.locator('[data-act=mailCompose][data-mode=new]').click();
  await expect(page.locator('#mc-proj')).toBeVisible();
  expect(await options()).toEqual(['', 'art-b', 'art-a']);
  await page.locator('#modal [data-act=closeModal]').first().click();
  // réponse dans une conversation dont l'artiste est inactif : gardé (choisi), après les actifs
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); S.db.mail_threads[0].project_id = 'art-c'; touch('mail_threads'); });
  await page.locator('.mail-row').first().click();
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply]').first().click();
  expect(await options()).toEqual(['', 'art-b', 'art-a', 'art-c']);
  await expect(page.locator('#mc-proj')).toHaveValue('art-c');
  expectClean(ctx);
});

test('v1.65 « Lire en entier » d’un .eml sur iPhone (390 px) : fenêtre plein écran, dernière ligne atteinte (relecture v1.65)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ctx = await openApp(page);
  const logs = [{ ...LOGS[1], author: 'testeur@example.com', gmail_message_id: null, body: 'Reçu — **RE: Proposition 2028**\n\nDEUXIÈME message reçu' }];
  await ouvrir(page, { logs, files: [FILES[1]], stored: { 'suivi/pr-1/2_RE.eml': bin(EML) } });
  await lire(page, 'lr-b');
  const d = page.locator('dialog.ask.read[open]');
  const box = await d.boundingBox();
  expect(Math.round(box.width)).toBe(390); expect(Math.round(box.x)).toBe(0);
  const frame = await d.locator('iframe.mail-frame').boundingBox();
  expect(frame.y + frame.height).toBeLessThanOrEqual(844);
  const fin = d.frameLocator('iframe.mail-frame').locator('text=FIN DU MAIL CITÉ');
  await fin.scrollIntoViewIfNeeded();
  await expect(fin).toBeInViewport();
  await expect(d.locator('button', { hasText: 'Fermer' })).toBeInViewport();
  expectClean(ctx);
});

test('v1.65.2 date changée à la main : heure d’origine gardée en historique, ni affichée ni utilisée hors de son jour (repli)', async ({ page }) => {
  const ctx = await openApp(page);
  // le reçu de 11:16 (17/11) est daté à la main du 18/11 ; une note du 18/11 saisie à 09:00 ce jour-là
  const logs = LOGS.map(l => l.id === 'lr-b' ? { ...l, date: '2026-11-18' } : l)
    .concat({ id: 'lr-n', prospect_id: 'pr-1', date: '2026-11-18', kind: 'Note', author: 'testeur@example.com', created_at: '2026-11-18T08:00:00Z', body: 'NOTE du 18' });
  await ouvrir(page, { logs });
  const e = (await entrees(page)).filter(t => /message|NOTE/.test(t));
  // 18/11 : le reçu sans heure valable passe en fin de jour (en tête), avant la note de 09:00 ; puis le 17/11 dans l'ordre réel
  expect(e.map(t => (t.match(/PREMIER|DEUXIÈME|TROISIÈME|NOTE/) || [])[0])).toEqual(['DEUXIÈME', 'NOTE', 'TROISIÈME', 'PREMIER']);
  expect(e[0]).toContain('18/11/2026'); expect(e[0]).not.toMatch(/18\/11\/2026 \d\d:\d\d/); expect(e[0]).not.toContain('11:16');
  // modifier l'entrée (date, texte) n'efface pas l'horodatage d'origine
  await journal(page).locator(':scope > .log', { hasText: 'DEUXIÈME' }).locator('[data-act=editLog]').click();
  await page.locator('#modal textarea[name=body]').fill('DEUXIÈME message reçu (corrigé)');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('#modal[open]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lr-b').occurred_at)).toBe('2026-11-17T10:16:18+00:00');
  expectClean(ctx);
});

test('v1.65.2 source dont la boîte n’est pas établie (identifiant Gmail seul), hors du compte titulaire : « Message inaccessible depuis ce compte »', async ({ page }) => {
  const ctx = await openApp(page);
  const logs = [{ ...LOGS[1], author: 'testeur@example.com', import_key: null, body: 'Reçu — **RE: Proposition 2028**\n\nDEUXIÈME message reçu' }];
  await ouvrir(page, { owner: false, logs, files: [] });
  await lire(page, 'lr-b');
  await expect(dlg(page)).toContainText('Message inaccessible depuis ce compte.');
  await expect(dlg(page)).not.toContainText('anthony@');
  expectClean(ctx);
});

// v1.68.1 — point n°9 (décision d'Anthony du 26/11/2026) : dans le cadre de lecture, le texte SANS police déclarée s'affiche en
// Helvetica Neue (puis Helvetica, Arial, sans-serif) au lieu de la police par défaut du navigateur (Times sur Safari iPhone) ;
// les polices écrites dans le message ou la signature sont gardées. Cas de référence : réponse citée sans police + signature
// Helvetica Neue (mail de Rienzo, capture d'Anthony du 26/11/2026).
const fontOf = (frame, sel) => frame.locator(sel).evaluate(e => getComputedStyle(e).fontFamily);
const DEFAUT = /^"?Helvetica Neue"?, Helvetica, Arial, sans-serif$/;
const RIENZO = '<div dir="ltr"><div id="plain">Hello Rienzo,</div><div>Tout est bon.</div></div>'
  + '<div id="sig" style="font-family:&quot;Helvetica Neue&quot;, sans-serif">Antho</div>'
  + '<blockquote><p id="geo" style="font-family:Georgia, serif">Message cité en Georgia</p><font id="ff" face="Courier New">ancienne balise</font><p id="cite">cité sans police</p></blockquote>';

test('v1.68.1 police du cadre de lecture (Mails) : texte sans police en Helvetica Neue, polices explicites gardées', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { msgs: [{ id: 'mm-2', thread_id: 'mt-r', gmail_message_id: 'g02', prospect_log_id: 'lr-b', sent_at: '2026-11-17T10:16:18Z' }],
    gmail: [GMSG('g01', '<p>premier</p>'), GMSG('g02', RIENZO), GMSG('g03', '<p>troisième</p>')] });
  await lire(page, 'lr-b');
  const f = page.locator('.mail-msg.focus[data-msg="g02"]').frameLocator('iframe.mail-frame');
  await expect(f.locator('#plain')).toBeVisible();
  expect(await fontOf(f, '#plain')).toMatch(DEFAUT);
  expect(await fontOf(f, '#cite')).toMatch(DEFAUT);
  expect(await fontOf(f, '#sig')).toMatch(/^"?Helvetica Neue"?, sans-serif$/);   // signature : sa propre déclaration
  expect(await fontOf(f, '#geo')).toMatch(/^Georgia, serif$/);
  expect(await fontOf(f, '#ff')).toMatch(/Courier New/);
  expectClean(ctx);
});

test('v1.68.1 police du cadre (relecture) : une police déclarée par le mail sur html, :root ou body l’emporte', async ({ page }) => {
  const ctx = await openApp(page);
  const cas = ['<style>html{font-family:Georgia}</style><p id="t">x</p>', '<style>:root{font-family:Georgia}</style><p id="t">x</p>',
    '<html style="font-family:Georgia"><body><p id="t">x</p></body></html>', '<style>body{font-family:Georgia}</style><p id="t">x</p>'];
  for (const html of cas){
    await page.evaluate(async h => { const { mailFrame } = await import('./js/views/mails.js');
      document.querySelector('#zz-cadre')?.remove(); const d = Object.assign(document.createElement('div'), { id: 'zz-cadre' });
      d.innerHTML = mailFrame(h, 'essai'); document.body.appendChild(d); }, html);
    const f = page.frameLocator('#zz-cadre iframe.mail-frame');
    await expect(f.locator('#t')).toBeAttached();
    expect(await fontOf(f, '#t'), html).toBe('Georgia');
  }
  expectClean(ctx);
});

test('v1.68.1 police du cadre de lecture (.eml ouvert depuis un suivi, iPhone 390 px) : texte brut en Helvetica Neue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ctx = await openApp(page);
  const logs = [{ ...LOGS[1], author: 'testeur@example.com', gmail_message_id: null, body: 'Reçu — **RE: Proposition 2028**\n\nDEUXIÈME message reçu (texte coupé)' }];
  await ouvrir(page, { logs, files: [FILES[1]], stored: { 'suivi/pr-1/2_RE.eml': bin(EML) } });
  await lire(page, 'lr-b');
  const f = page.locator('dialog.ask.read[open]').frameLocator('iframe.mail-frame');
  await expect(f.locator('pre')).toBeVisible();
  expect(await fontOf(f, 'pre')).toMatch(DEFAUT);
  expect(await f.locator('pre').evaluate(e => getComputedStyle(e).whiteSpace)).toBe('pre-wrap');   // retours à la ligne gardés
  expectClean(ctx);
});
