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
      // texte déjà enregistré (body_text du jeu d'essai) : dans private.mail_textes simulée, jamais dans mail_messages
      db.mail_threads = [JSON.parse(JSON.stringify(thread))]; db.mail_messages = msgs.map(({ body_text, ...m }) => ({ ...m }));
      if (db === window.__DB) db.mail_textes = msgs.filter(m => m.body_text).map(m => ({ message_id: m.id, body_text: m.body_text }));
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
    // relecture v1.66 : réponses intercalées Gmail, transferts Outlook, lignes « > » sans attribution, réponses « en rouge ci-dessous »
    out.gmailInter = ownText({ html: '<div>Voir mes réponses :</div><div class="gmail_quote"><div class="gmail_attr">Le lun. 16 nov. 2026 à 10:00, X &lt;x@example.com&gt; a écrit :</div><blockquote class="gmail_quote">Question 1 ?</blockquote><div>REPONSE1</div><blockquote class="gmail_quote">Question 2 ?</blockquote><div>REPONSE2</div></div>' });
    out.owaTr = ownText({ html: '<div>Pour info</div><hr><div id="divRplyFwdMsg"><b>De :</b> X<br><b>Envoyé :</b> lundi<br><b>À :</b> Y<br><b>Objet :</b> TR: Devis</div><div>CONTENU TRANSFERE OWA</div>' });
    out.outlookTr = ownText({ plain: 'Pour info.\n\nDe : X <x@example.com>\nEnvoyé : lundi 16 novembre 2026 10:00\nÀ : Y\nObjet : TR: Devis\n\nCONTENU TRANSFERE OUTLOOK' });
    out.puces = ownText({ plain: 'Programme :\n> 14h arrivée\n> 21h concert' });
    out.directeur = ownText({ plain: 'Pour info, voici sa réponse.\nLe directeur a écrit :\n> on valide le 12' });
    out.rouge = ownText({ plain: 'Voir mes réponses en rouge ci-dessous.\n\nDe : X\nEnvoyé : lundi\nÀ : Y\nObjet : RE: Devis\n\nQuestion ? ROUGE1' });
    // relecture v1.66 (2e passage) : transfert annoncé sans « TR: », #appendonsend vide avant #divRplyFwdMsg, feuille de route, objet « TR: »
    out.annonce = ownText({ plain: 'Je te transfère la demande.\n\nDe : Paul <p@x.fr>\nEnvoyé : lundi 16 novembre 2026 10:00\nÀ : Anthony\nObjet : Demande de date\n\nCONTENU ANNONCE' });
    out.append = ownText({ html: '<div>Pour info</div><div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>De :</b> X<br><b>Envoyé :</b> lundi<br><b>À :</b> Y<br><b>Objet :</b> TR: Contrat</div><div>CONTENU APPEND</div>' });
    out.route = ownText({ plain: 'Bonjour,\nTrajet :\nDe : Paris\nDate : 12/03\nÀ : Lyon\nObjet : transport matériel\nBonne route\nAnthony' });
    out.sujetTr = ownText({ subject: 'TR: Fiche technique', plain: 'Ci-joint.\n\nDe : Paul <p@x.fr>\nEnvoyé : lundi 16 novembre 2026 10:00\nÀ : Anthony\nObjet : Fiche technique\n\nCONTENU SUJET' });
    // relecture v1.66 (B4) : mots courants (« transfert » aéroport, « ci-dessous », « ne pas transférer », « below ») → citation marquée retirée
    const GQ = t => ({ html: '<div>' + t + '</div><div class="gmail_quote"><div class="gmail_attr">Le lun. 3 nov. 2026 à 10:00, Paul &lt;p@x.fr&gt; a écrit :</div><blockquote class="gmail_quote">HISTO_B4</blockquote></div>' });
    const AQ = t => ({ html: '<div>' + t + '</div><blockquote type="cite"><div>Le 3 nov. 2026 à 10:00, Paul &lt;p@x.fr&gt; a écrit :</div><div>HISTO_B4</div></blockquote>' });
    out.b4 = [
      ownText(GQ('OK pour le transfert aéroport-hôtel à 14h')), ownText(GQ('Vous trouverez ci-dessous le planning')),
      ownText(GQ('Merci<br>Ce message est confidentiel, merci de ne pas le transférer.')), ownText(AQ('Le virement (transfert) est parti')),
      ownText(AQ('Merci<br>See our tour dates below')),
      ownText({ plain: 'Bonjour,\nInfos ci-dessous.\nCachet 1500\n\nLe lun. 3 nov. 2026 à 10:00, Paul <p@x.fr> a écrit :\n> HISTO_B4\n' }),
      ownText({ ...GQ('Bien reçu, merci.'), subject: 'RE: TR: Contrat' }),
    ];
    const OL = t => ({ plain: t + '\n\nDe : Paul <p@x.fr>\nEnvoyé : lundi 3 novembre 2026 10:00\nÀ : M\nObjet : RE: Contrat\n\nHISTO_B4' });
    out.b4.push(ownText(OL('Je vous renvoie le contrat signé.')), ownText(OL('Merci pour vos réponses, voici ci-dessous le planning.')));
    out.trGmail = ownText({ ...GQ('Pour info'), subject: 'TR: Contrat' });
    return out;
  });
  for (const t of r.b4) expect(t).not.toContain('HISTO_B4');
  expect(r.b4[5]).toContain('Cachet 1500'); expect(r.trGmail).toContain('HISTO_B4');
  expect(r.annonce).toContain('CONTENU ANNONCE'); expect(r.append).toContain('CONTENU APPEND'); expect(r.sujetTr).toContain('CONTENU SUJET');
  expect(r.route).toBe('Bonjour,\nTrajet :\nDe : Paris\nDate : 12/03\nÀ : Lyon\nObjet : transport matériel\nBonne route\nAnthony');
  expect(r.apple).toBe('Réponse Apple\n--\nSignature A');
  expect(r.outlook).toBe('Réponse Outlook\n\nCordialement,\nSignature O');
  expect(r.owa).toBe('Réponse OWA');
  expect(r.brut).toBe('Réponse brute\n\nSignature B');
  expect(r.original).toBe('Réponse');
  expect(r.finale).toBe('Réponse en haut\n\n> CITÉ EN BAS\n> encore');            // « > » sans attribution : gardé (doute)
  expect(r.gmailInter).toContain('REPONSE1'); expect(r.gmailInter).toContain('REPONSE2'); expect(r.gmailInter).not.toContain('Question 1');
  expect(r.owaTr).toContain('CONTENU TRANSFERE OWA'); expect(r.outlookTr).toContain('CONTENU TRANSFERE OUTLOOK');
  expect(r.puces).toContain('21h concert'); expect(r.directeur).toContain('on valide le 12'); expect(r.rouge).toContain('ROUGE1');
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
  expect(await page.evaluate(() => window.__DB.mail_textes.map(t => [t.message_id, t.body_text.slice(-14)]).sort())).toEqual([['mm-a', 'Seconde ligne citée'.slice(-14)], ['mm-b', '06 00 00 00 00']]);
  expect(await page.evaluate(() => window.__DB.mail_messages.every(m => !('body_text' in m)))).toBe(true);   // jamais dans mail_messages
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
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'mail_messages' || /^mail_texte/.test(c.rpc || '')).length)).toBe(0);
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
  // mail importé seul, texte intégral affiché : ni « Lire en entier » ni lien d'origine ; le .eml reste dans l'entrée (v1.66.1)
  await expect(e.locator('[data-act=readLog]')).toHaveCount(0);
  await expect(e.getByText('RE Proposition.eml')).toBeVisible();
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

test('v1.66 note manuelle : affichée à part du texte intégral, jamais écrasée ; l’extrait automatique n’est pas répété', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [
      LOG('lg-b', { body: 'Mail reçu de prog@example.com — « Re: Proposition »\nBonjour Anthony, Ligne 1 de la réponse, propre à ce message…\nNOTE : rappeler mardi pour le cachet' }),
      LOG('lg-c', { body: 'Mail reçu de prog@example.com — « Re: Devis »\nBonjour Anthony, Ligne 1 de la réponse, propre à ce message…', created_at: '2026-11-17T11:00:00Z' })],
    msgs: [{ id: 'mm-b', thread_id: 'mt-1', gmail_message_id: 'g02', prospect_log_id: 'lg-b', body_text: null },
           { id: 'mm-c', thread_id: 'mt-1', gmail_message_id: 'g03', prospect_log_id: 'lg-c', body_text: null }],
    gmail: [{ id: 'g02', html: GMAIL }, { id: 'g03', html: GMAIL }] });
  const b = entree(page, 'Re: Proposition');
  await expect(b.locator('.mail-text')).toContainText('DERNIÈRE LIGNE DU MESSAGE');
  await expect(b.locator('.log-note')).toContainText('NOTE : rappeler mardi pour le cachet');
  await expect(b.locator('.log-note')).not.toContainText('Ligne 1');                      // extrait automatique : pas répété
  await expect(b.locator('.mail-text')).not.toContainText('NOTE : rappeler');             // note jamais mêlée au mail
  await expect(entree(page, 'Re: Devis').locator('.log-note')).toHaveCount(0);           // pas de note : rien en plus
  expect(await page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-b').body)).toContain('NOTE : rappeler mardi');   // jamais écrasée
  expect(await page.evaluate(() => window.__calls.filter(c => c.table === 'prospect_logs' && c.op !== 'select').length)).toBe(0);
  expectClean(ctx);
});

test('v1.66 changement de compte (relecture B5) : déconnexion ou autre compte connecté → page rechargée, aucun texte privé gardé en mémoire', async ({ page }) => {
  const ctx = await openApp(page);
  await ouvrir(page, { logs: [LOG('lg-b', { body: 'Mail reçu de prog@example.com — « Re: Proposition »\nBonjour…' })],
    msgs: [{ id: 'mm-b', thread_id: 'mt-1', gmail_message_id: 'g02', prospect_log_id: 'lg-b', body_text: 'TEXTE PRIVÉ DU TITULAIRE' }], gmail: [] });
  await expect(page.getByText('TEXTE PRIVÉ DU TITULAIRE')).toBeVisible();
  // 1. bouton Déconnexion : la page est rechargée (marque posée avant : disparue)
  await page.evaluate(() => { window.__marque = 1; });
  // bouton du menu du compte (créé ici si le menu est fermé : même gestionnaire de clic, js/app.js)
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => {
    const b = document.querySelector('#logout') || Object.assign(document.body.appendChild(document.createElement('button')), { id: 'logout' }); b.click(); })]);
  expect(await page.evaluate(() => window.__marque)).toBeUndefined();
  // 2. autre compte connecté (autre onglet) : SIGNED_IN d'un autre utilisateur → page rechargée ; SIGNED_OUT → page rechargée
  for (const ev of [['SIGNED_IN', { user: { id: 'autre-compte', email: 'autre@example.com' } }], ['SIGNED_OUT', null]]){
    await page.waitForFunction(() => typeof window.__AUTH_CB === 'function');
    await page.evaluate(() => { window.__marque = 2; });
    await Promise.all([page.waitForEvent('load'), page.evaluate(([e, s]) => window.__AUTH_CB(e, s), ev)]);
    expect(await page.evaluate(() => window.__marque)).toBeUndefined();
  }
  void ctx;
});

test('v1.66 note manuelle courte (relecture B6) : « OK », « lundi », « 12 », « Marie » jamais cachés, même présents dans le mail', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const { manualNote } = await import('./js/textes-journal.js');
    const full = 'Bonjour,\nOK pour le booking du 12 mars, cachet confirmé.\nOn se rappelle lundi.\nMarie';
    const imp = n => manualNote({ author: 'Anthony', body: 'Reçu — **Booking**\n**De :** Marie\n\nBonjour,\nOK pour le booking du 12 mars, cachet confirmé.' + (n ? '\n' + n : '') }, full);
    const syn = n => manualNote({ author: 'Messagerie', body: 'Mail reçu de m@example.com — « Booking »\nBonjour, OK pour le booking du 12 mars, cachet confirmé. On se…' + (n ? '\n' + n : '') }, full);
    return { vide: imp(''), ok: imp('OK'), lundi: imp('lundi'), douze: imp('12'), marie: imp('Marie'), confirme: imp('Confirmé'), synVide: syn(''), synOk: syn('OK'),
      remplace: manualNote({ author: 'Messagerie', body: 'Mail reçu — « Booking »\nlundi' }, full),
      // puces : « - balances 16h » dans le texte intégral, « balances 16h » dans l'ancien résumé → pas de note fantôme
      puces: manualNote({ author: 'Anthony', body: 'Reçu — **Planning**\n\nProgramme :\nbalances 16h\nconcert 21h\nBien à toi,\nMarie' }, 'Programme :\n- balances 16h\n- concert 21h\nBien à toi,\nMarie') };
  });
  expect(r).toEqual({ vide: '', ok: 'OK', lundi: 'lundi', douze: '12', marie: 'Marie', confirme: 'Confirmé', synVide: '', synOk: 'OK', remplace: 'lundi', puces: '' });
  expectClean(ctx);
});

test('v1.66.1 mail importé réel : liens « <https://…> » de l’ancien résumé → aucune note fantôme ; « Lire en entier » masqué avec le texte intégral', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const { manualNote } = await import('./js/textes-journal.js');
    // cas du suivi pilote (21/11/2026) : ancien résumé tiré de la partie texte (liens entre < >), texte intégral tiré du HTML
    const full = 'Hello Colin,\n\nÇa me semble un peu court 7000€ HT. Je sais pas si tu as vu passer le projet : [Voir le live]\n\nDis-moi,\n\n Antho\n Anthony Combe\n +33 (0)6 02 25 69 78 | anthony@lartboristerie.com\n lartboristerie.com | Instagram\n SAS L’ArtBoristerie - 48Bis rue Pajol, 75018 Paris';
    const body = 'Envoyé — **Re: Invitation**\n**De :** Anthony · **À :** Colin\n\nHello Colin,\nÇa me semble un peu court 7000€ HT. Je sais pas si tu as vu passer le projet : [Voir le live <https://www.example.com/pro/>]\nDis-moi,\nAntho\nAnthony Combe\n+33 (0)6 02 25 69 78 <tel:+33602256978> | anthony@lartboristerie.com <mailto:anthony@lartboristerie.com>\nlartboristerie.com <https://www.example.com/> | Instagram <https://www.instagram.com/x/>\nSAS L’ArtBoristerie - 48Bis rue Pajol, 75018 Paris\n<https://www.example.com/>';
    return { sans: manualNote({ author: 'anthony@lartboristerie.com', body }, full), avec: manualNote({ author: 'anthony@lartboristerie.com', body: body + '\nNote de test v1.66' }, full) };
  });
  expect(r.sans).toBe(''); expect(r.avec).toBe('Note de test v1.66');
  // liste numérotée (« 1. » dans la partie texte, « - » dans le texte intégral) ; résumé coupé à 6 000 caractères au milieu d'un mot
  const r2 = await page.evaluate(async () => {
    const { manualNote } = await import('./js/textes-journal.js');
    const long = Array.from({ length: 300 }, (_, i) => `Phrase ${i} du mail.`).join('\n');
    return { liste: manualNote({ author: 'a', body: 'Reçu — x\n\nProgramme :\n1. Balances\n2. Concert\nMarie' }, 'Programme :\n- Balances\n- Concert\nMarie'),
      coupe: manualNote({ author: 'a', body: 'Reçu — x\n\n' + long.slice(0, 6000) }, long) };
  });
  expect(r2).toEqual({ liste: '', coupe: '' });
  // bouton : absent sur une entrée dont le texte intégral est affiché, présent sur un extrait
  await ouvrir(page, { logs: [LOG('lg-b', { body: 'Mail reçu de prog@example.com — « Re: Proposition »\nBonjour…' }),
      LOG('lg-c', { body: 'Mail reçu de prog@example.com — « Re: Devis »\nBonjour…', created_at: '2026-11-17T11:00:00Z' })],
    msgs: [{ id: 'mm-b', thread_id: 'mt-1', gmail_message_id: 'g02', prospect_log_id: 'lg-b', body_text: 'TEXTE COMPLET DU MESSAGE' },
           { id: 'mm-c', thread_id: 'mt-1', gmail_message_id: 'g03', prospect_log_id: 'lg-c', body_text: null }], gmail: [{ id: 'g02', html: GMAIL }] });
  await expect(entree(page, 'Re: Proposition').locator('.mail-text')).toContainText('TEXTE COMPLET DU MESSAGE');
  // texte intégral d'un mail synchronisé : seulement le lien discret « Ouvrir le mail d'origine » (décision d'Anthony du 21/11/2026)
  await expect(entree(page, 'Re: Proposition').getByRole('button', { name: 'Lire en entier' })).toHaveCount(0);
  const orig = entree(page, 'Re: Proposition').getByRole('button', { name: 'Ouvrir le mail d’origine' });
  await expect(orig).toHaveCount(1); await expect(orig).toHaveClass(/ghost/);
  // entrée marquée « Extrait » : « Lire en entier »
  await expect(entree(page, 'Re: Devis').locator('.log-extrait')).toBeVisible();
  await expect(entree(page, 'Re: Devis').getByRole('button', { name: 'Lire en entier' })).toHaveCount(1);
  // le lien ouvre le message exact dans la messagerie (même lecture à la source que v1.65)
  await orig.click();
  await expect(page.locator('.mail-msg.focus')).toHaveCount(1);
  void ctx;
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
  expect(await page.evaluate(() => window.__DB.mail_textes.map(t => [t.message_id, t.body_text.slice(-14)]).sort())).toEqual([['mm-b', '06 00 00 00 00'], ['mm-z', 'DÉJÀ LU, GARDÉ'.slice(-14)]]);
  expectClean(ctx);
});
