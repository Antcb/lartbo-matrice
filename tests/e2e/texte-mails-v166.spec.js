// v1.66 — texte intégral de chaque mail dans son entrée du journal d'un suivi, sans clic ni limite, sans l'historique cité
// (js/texte-mail.js ownText, js/textes-journal.js) ; droits inchangés (boîte anthony@ réservée à son titulaire) ; extrait signalé
// quand la source complète est introuvable. Données FICTIVES ; Gmail et stockage simulés, réseau bloqué.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const bin = s => Buffer.from(s, 'utf8').toString('latin1');
const LIGNES = n => Array.from({ length: n }, (_, i) => `Ligne ${i + 1} de la réponse, propre à ce message, assez longue pour remplir la largeur.`);
const SIGNATURE = ['--', 'Prog Fictive', 'Programmation · Festival Fictif', '06 00 00 00 00'];
// réponse Gmail (HTML) : texte long + signature, puis bloc cité (attribution + blockquote)
const GMAIL = `<div dir="ltr">Bonjour Anthony,<br><br>${LIGNES(150).join('<br>')}<br>DERNIÈRE LIGNE DU MESSAGE<br><br>${SIGNATURE.join('<br>')}</div><br>
<div class="gmail_quote"><div dir="ltr" class="gmail_attr">Le lun. 16 nov. 2026 à 10:00, Anthony &lt;anthony-fictif@example.com&gt; a écrit :<br></div>
<blockquote class="gmail_quote" style="margin:0 0 0 .8ex">PREMIER MESSAGE CITÉ, déjà au journal<br>Seconde ligne citée</blockquote></div>`;

/** Suivi pr-1 ouvert avec des entrées ; opts : messages synchronisés, conversation Gmail, fichiers, stockage, titulaire */
async function ouvrir(page, { logs = [], files = [], msgs = [], gmail = [], stored = {}, owner = true } = {}){
  await page.evaluate(async ([logs, files, msgs, gmail, stored, owner]) => {
    const { S, touch } = await import('./js/state.js');
    const thread = { id: 'mt-1', mailbox: 'anthony', gmail_thread_id: 'thr1', subject: 'Re: Proposition', participants: ['prog@example.com'], labels: ['INBOX'], prospect_id: 'pr-1' };
    for (const db of [S.db, window.__DB]){
      db.prospect_logs.push(...JSON.parse(JSON.stringify(logs))); db.prospect_files.push(...JSON.parse(JSON.stringify(files)));
      db.mail_threads = [JSON.parse(JSON.stringify(thread))]; db.mail_messages = JSON.parse(JSON.stringify(msgs));
      db.settings.push({ key: 'prospect_script_url', value: 'https://script.google.com/macros/s/FICTIF/exec' });
    }
    for (const t of ['prospect_logs', 'prospect_files', 'mail_threads', 'settings']) touch(t);
    window.__STORED = stored; window.__MAILBOX_OWNER = owner; window.__script = [];
    window.__FN_REPLY = { 'script-google': b => { window.__script.push(b);
      if (b.action === 'thread') return { ok: true, thread: { id: 'thr1', messages: gmail } };
      return { ok: true }; } };
    const app = await import('./js/app.js'); app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  }, [logs, files, msgs, gmail, stored, owner]);
  await expect(page.locator('.log-attach [data-drop]')).toBeVisible();
}
const journal = page => page.locator('.log-attach').locator('xpath=..');
const entree = (page, txt) => journal(page).locator(':scope > .log', { hasText: txt });
const LOG = (id, extra = {}) => ({ id, prospect_id: 'pr-1', date: '2026-11-17', kind: 'Mail', author: 'Messagerie', created_at: '2026-11-17T10:20:00Z', ...extra });

test('v1.66 règle : réponse et signature entières, historique cité retiré (Gmail, Apple Mail, Outlook, texte brut) ; en cas de doute, gardé', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const { ownText } = await import('./js/texte-mail.js');
    const out = {};
    out.apple = ownText({ html: '<div>Réponse Apple<br>--<br>Signature A</div><div><br><blockquote type="cite"><div>Le 16 nov. 2026 à 10:00, X &lt;x@example.com&gt; a écrit :</div><div>CITÉ APPLE</div></blockquote></div>' });
    out.outlook = ownText({ html: '<p>Réponse Outlook</p><p>Cordialement,<br>Signature O</p><div style="border:none;border-top:solid #E1E1E1 1.0pt"><p><b>De :</b> X &lt;x@example.com&gt;<br><b>Envoyé :</b> lundi 16 novembre 2026 10:00<br><b>À :</b> Y<br><b>Objet :</b> RE: Proposition</p></div><p>CITÉ OUTLOOK</p>' });
    out.owa = ownText({ html: '<div>Réponse OWA</div><hr><div id="divRplyFwdMsg"><b>From:</b> X<br><b>Sent:</b> Monday</div><div>CITÉ OWA</div>' });
    out.brut = ownText({ plain: 'Réponse brute\n\nSignature B\n\nLe lun. 16 nov. 2026 à 10:00, X <x@example.com>\na écrit :\n> CITÉ BRUT\n> suite' });
    out.original = ownText({ plain: 'Réponse\n\n-----Original Message-----\nFrom: X\nCITÉ ORIGINAL' });
    out.finale = ownText({ plain: 'Réponse en haut\n\n> CITÉ EN BAS\n> encore' });
    // doutes : gardés
    out.intercale = ownText({ plain: 'Le lun. 16 nov. 2026 à 10:00, X a écrit :\n> Question ?\nRéponse INTERCALÉE gardée\n> Autre question ?\nAutre réponse' });
    out.transfert = ownText({ plain: 'Pour info.\n\n---------- Forwarded message ---------\nDe : X <x@example.com>\nDate: lun. 16 nov. 2026\nSubject: Devis\nTo: Y\n\nCONTENU TRANSFÉRÉ' });
    out.horaires = ownText({ plain: 'Ouverture des portes\nDe : 14h à 18h\nÀ : la salle B\nMerci' });
    out.blockquote = ownText({ html: '<p>Comme disait l’affiche :</p><blockquote>CITATION VOLONTAIRE</blockquote><p>Fin</p>' });
    out.vide = ownText({ plain: '> seulement une citation' });
    return out;
  });
  expect(r.apple).toBe('Réponse Apple\n--\nSignature A');
  expect(r.outlook).toBe('Réponse Outlook\n\nCordialement,\nSignature O');
  expect(r.owa).toBe('Réponse OWA');
  expect(r.brut).toBe('Réponse brute\n\nSignature B');
  expect(r.original).toBe('Réponse');
  expect(r.finale).toBe('Réponse en haut');
  expect(r.intercale).toContain('Réponse INTERCALÉE gardée'); expect(r.intercale).toContain('Autre réponse');
  expect(r.transfert).toContain('CONTENU TRANSFÉRÉ');
  expect(r.horaires).toBe('Ouverture des portes\nDe : 14h à 18h\nÀ : la salle B\nMerci');
  expect(r.blockquote).toContain('CITATION VOLONTAIRE');
  expect(r.vide).toBe('> seulement une citation');
  expectClean(ctx);
});

test('v1.66 mail synchronisé (compte titulaire) : texte intégral sans clic jusqu’à la dernière ligne, signature entière, historique jamais répété', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, {
    logs: [LOG('lg-a', { body: 'Mail envoyé à prog@example.com — « Proposition »\nPREMIER MESSAGE CITÉ, déjà au journal', created_at: '2026-11-17T09:00:00Z' }),
           LOG('lg-b', { body: 'Mail reçu de prog@example.com — « Re: Proposition »\nBonjour Anthony, Ligne 1 de la réponse…' })],
    msgs: [{ id: 'mm-a', thread_id: 'mt-1', gmail_message_id: 'g01', prospect_log_id: 'lg-a', body_text: null },
           { id: 'mm-b', thread_id: 'mt-1', gmail_message_id: 'g02', prospect_log_id: 'lg-b', body_text: null }],
    gmail: [{ id: 'g01', html: '<div>PREMIER MESSAGE CITÉ, déjà au journal<br>Seconde ligne citée</div>' }, { id: 'g02', html: GMAIL }],
  });
  const b = entree(page, 'Mail reçu de');
  await expect(b.locator('.mail-text')).toContainText('DERNIÈRE LIGNE DU MESSAGE');
  const texte = await b.locator('.mail-text').innerText();
  expect(texte).toContain('Ligne 150 de la réponse');
  expect(texte.endsWith('06 00 00 00 00')).toBe(true);                         // signature entière, en dernier
  expect(texte).not.toContain('CITÉ'); expect(texte).not.toContain('a écrit');  // historique cité retiré
  await expect(b).not.toContainText('Extrait');
  // dans tout le journal, le premier message n'apparaît qu'une fois (dans sa propre entrée)
  expect(((await journal(page).innerText()).match(/PREMIER MESSAGE CITÉ/g) || []).length).toBe(1);
  // dernière ligne atteignable à l'écran ; texte enregistré dans la boîte (mêmes droits que les messages), une seule lecture Gmail
  await b.locator('.mail-text').evaluate(el => el.scrollIntoView({ block: 'end' }));
  await expect(b.getByText('06 00 00 00 00')).toBeInViewport();
  expect(await page.evaluate(() => window.__DB.mail_messages.map(m => [m.id, (m.body_text || '').slice(-14)]))).toEqual([['mm-a', 'Seconde ligne citée'.slice(-14)], ['mm-b', '06 00 00 00 00']]);
  expect(await page.evaluate(() => window.__DB.prospect_logs.filter(l => l.id.startsWith('lg-')).map(l => l.mail_text || null))).toEqual([null, null, null, null]);
  expect(await page.evaluate(() => window.__script.filter(s => s.action === 'thread').length)).toBe(1);
  expectClean(ctx);
});

test('v1.66 mail synchronisé, autre compte que le titulaire : aucun accès à la boîte, texte actuel signalé « Extrait » avec la raison', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { owner: false, logs: [LOG('lg-b', { body: 'Mail reçu de prog@example.com — « Re: Proposition »\nBonjour Anthony, Ligne 1…' })],
    msgs: [{ id: 'mm-b', thread_id: 'mt-1', gmail_message_id: 'g02', prospect_log_id: 'lg-b', body_text: 'TEXTE DE LA BOÎTE' }], gmail: [{ id: 'g02', html: GMAIL }] });
  await expect(entree(page, 'Mail reçu de').locator('.log-extrait')).toHaveText('Extrait — texte complet réservé au compte d’Anthony (boîte anthony@)');
  await expect(entree(page, 'Mail reçu de')).toContainText('Bonjour Anthony, Ligne 1…');
  await expect(journal(page)).not.toContainText('TEXTE DE LA BOÎTE');
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'mail_messages').length)).toBe(0);
  expect(await page.evaluate(() => window.__script.length)).toBe(0);
  expectClean(ctx);
});

const EML = (corps, { id = 'a2' } = {}) => ['From: Prog Fictive <prog@example.com>', 'To: anthony-fictif@example.com', 'Subject: RE: Proposition',
  `Message-ID: <${id}@exemple.test>`, 'Date: Tue, 17 Nov 2026 11:16:18 +0100', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', corps, ''].join('\r\n');
const LONG = [...LIGNES(90), 'DERNIÈRE LIGNE DU MESSAGE', '', ...SIGNATURE, '', 'Le lun. 16 nov. 2026 à 10:00, anthony-fictif@example.com a écrit :', '> MESSAGE PRÉCÉDENT CITÉ', '> fin'].join('\r\n');

test('v1.66 mail importé existant (reprise) : texte intégral lu dans le .eml, au-delà de 6 000 caractères, pour toute l’équipe ; enregistré', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { owner: false,
    logs: [LOG('lg-i', { author: 'testeur@example.com', import_key: 'msgid:<a2@exemple.test>', body: 'Reçu — **RE: Proposition**\n**De :** Prog Fictive <prog@example.com>\n\nLigne 1 de la réponse (texte coupé à l’import)' })],
    files: [{ id: 'pf-i', prospect_id: 'pr-1', name: 'RE Proposition.eml', path: 'pr-1/re.eml', size: 9000, mime: 'message/rfc822', import_key: 'msgid:<a2@exemple.test>', created_at: '2026-11-20T14:31:00Z' }],
    stored: { 'suivi/pr-1/re.eml': bin(EML(LONG)) } });
  const e = entree(page, 'RE: Proposition');
  await expect(e.locator('.mail-text')).toContainText('DERNIÈRE LIGNE DU MESSAGE');
  const texte = await e.locator('.mail-text').innerText();
  expect(texte.length).toBeGreaterThan(6000);
  expect(texte.endsWith('06 00 00 00 00')).toBe(true);
  expect(texte).not.toContain('CITÉ');
  await expect(e).toContainText('De : Prog Fictive');                                   // en-tête gardé
  const saved = await page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-i').mail_text);
  expect(saved).toBe(texte);
  expect(await page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-i').body)).toContain('texte coupé à l’import');   // texte actuel jamais touché
  expectClean(ctx);
});

test('v1.66 nouveau mail importé (.eml déposé) : texte intégral enregistré au dépôt et affiché ; source introuvable → extrait signalé', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [LOG('lg-x', { author: 'testeur@example.com', date: '2026-11-10', import_key: 'msgid:<perdu@exemple.test>', body: 'Reçu — **Ancien mail**\n\nTexte court' })],
    files: [{ id: 'pf-x', prospect_id: 'pr-1', name: 'Ancien.eml', path: 'pr-1/ancien.eml', size: 10, mime: 'message/rfc822', import_key: 'msgid:<perdu@exemple.test>', created_at: '2026-11-10T10:00:00Z' }] });
  await expect(entree(page, 'Ancien mail').locator('.log-extrait')).toHaveText('Extrait — texte complet introuvable');
  await expect(entree(page, 'Ancien mail')).toContainText('Texte court');
  await page.evaluate(eml => { const f = new File([Uint8Array.from(eml, c => c.charCodeAt(0) & 255)], 'mail.eml', { type: 'message/rfc822' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, bin(EML(LONG, { id: 'neuf' })));
  await expect(entree(page, 'RE: Proposition').locator('.mail-text')).toContainText('DERNIÈRE LIGNE DU MESSAGE');
  const t = await page.evaluate(() => window.__DB.prospect_logs.find(l => l.import_key === 'msgid:<neuf@exemple.test>').mail_text);
  expect(t.endsWith('06 00 00 00 00')).toBe(true); expect(t).not.toContain('CITÉ');
  expectClean(ctx);
});

test('v1.66 iPhone (390 px) : mail long lisible jusqu’à la dernière ligne, sans défilement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [LOG('lg-b', { body: 'Mail reçu de prog@example.com — « Re: Proposition »\nBonjour…' })],
    msgs: [{ id: 'mm-b', thread_id: 'mt-1', gmail_message_id: 'g02', prospect_log_id: 'lg-b', body_text: null }], gmail: [{ id: 'g02', html: GMAIL }] });
  const b = entree(page, 'Mail reçu de');
  await expect(b.locator('.mail-text')).toContainText('DERNIÈRE LIGNE DU MESSAGE');
  await b.getByText('06 00 00 00 00').scrollIntoViewIfNeeded();
  await expect(b.getByText('06 00 00 00 00')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expectClean(ctx);
});

test('v1.66 reprise d’un coup (« Compléter les textes du journal », compte titulaire) : tous les suivis, rien d’écrasé', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [LOG('lg-b', { body: 'Mail reçu — « Re: Proposition »\nBonjour…' })],
    msgs: [{ id: 'mm-b', thread_id: 'mt-1', gmail_message_id: 'g02', prospect_log_id: 'lg-b', body_text: null },
           { id: 'mm-z', thread_id: 'mt-1', gmail_message_id: 'g09', prospect_log_id: 'lg-z', body_text: 'DÉJÀ LU, GARDÉ' }],
    gmail: [{ id: 'g02', html: GMAIL }, { id: 'g09', html: '<p>autre</p>' }] });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    const p2 = { id: 'pr-2', name: 'Suivi 2', project_id: 'art-a', structure_id: 'st-2', status: 'Interest' };
    const l = { id: 'lg-z', prospect_id: 'pr-2', date: '2026-11-18', kind: 'Mail', author: 'Messagerie', body: 'Mail reçu — « Autre »\nx' };
    for (const db of [S.db, window.__DB]){ db.prospects.push({ ...p2 }); db.prospect_logs.push({ ...l }); }
    touch('prospects'); touch('prospect_logs'); const app = await import('./js/app.js'); app.go('mails'); app.render(); });
  await page.locator('[data-act=mailTexts]').click();
  await expect(page.locator('.toast').last()).toContainText('Textes des mails complétés');
  expect(await page.evaluate(() => window.__DB.mail_messages.map(m => [m.id, m.body_text.slice(-14)]))).toEqual([['mm-b', '06 00 00 00 00'], ['mm-z', 'DÉJÀ LU, GARDÉ'.slice(-14)]]);
  expectClean(ctx);
});
