// v1.60.4 — essai réel d'Anthony (Mac, Chrome 156, v1.60.3) : un message glissé depuis Apple Mail sur les pièces jointes d'un suivi
// n'apporte AUCUN fichier, seulement « text/plain » et « text/uri-list » avec un lien « message:%3C<Message-ID>%3E ».
// Correction : le Message-ID (validé) sert à retrouver CE message dans les boîtes Google par le circuit serveur existant
// (relais script-google → action en lecture seule « mail_by_msgid » d'anthony@ puis de production@), puis à le joindre au suivi
// après confirmation explicite, sans doublon (clé import_key « msgid:<Message-ID> »).
// Ici les réponses des scripts Google sont SIMULÉES : seul l'essai réel sur le Mac d'Anthony prouve le format de son lien et la
// présence du message dans les boîtes Google.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const ID = '<9F1C2E3A-1B2C-4D5E-8F90-ABCDEF012345@exemple-fictif.fr>';
const LINK = 'message:%3C9F1C2E3A-1B2C-4D5E-8F90-ABCDEF012345@exemple-fictif.fr%3E';
const eml = (id = ID, text = 'Bonjour, voici notre proposition fictive.') => ['From: Camille Exemple <camille@example.com>', 'To: testeur@example.com', 'Subject: Programmation fictive', `Message-ID: ${id}`,
  'Date: Tue, 03 Nov 2026 10:00:00 +0100', 'Content-Type: text/plain; charset=utf-8', '', text, ''].join('\r\n');
const FOUND = (raw = eml(), id = ID) => ({ ok: true, found: true, message: { message_id: id, subject: 'Programmation fictive',
  from: 'Camille Exemple <camille@example.com>', date: '2026-11-03T09:00:00.000Z', size: raw.length, raw } });
const ABSENT = { ok: true, found: false };

/** Suivi pr-1 ouvert, scripts Google installés ; relais script-google simulé : window.__MAILBOX[cible] = réponse du script */
async function openSuivi(page, mailbox){
  const ctx = await openApp(page);
  ctx.urls = []; page.on('request', r => ctx.urls.push(r.url()));
  await page.evaluate(async mailbox => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js'); const d = await import('./js/data.js');
    S.db.settings.push({ key: 'drive_webhook_url', value: 'https://script.google.com/macros/s/fictif-production/exec' },
      { key: 'prospect_script_url', value: 'https://script.google.com/macros/s/fictif-anthony/exec' }); touch('settings');
    window.__MAILBOX = mailbox; window.__google = []; window.__up = [];
    const orig = d.sb.functions.invoke;
    d.sb.functions.invoke = async (name, o) => {
      if (name !== 'script-google') return orig(name, o);
      window.__google.push({ target: o.body.target, action: o.body.action, payload: o.body.payload });
      const r = window.__MAILBOX[o.body.target];
      return { data: r || { ok: false, error: 'Action inconnue : ' + o.body.action }, error: null };
    };
    d.sb.storage.from = () => ({ upload: async (p, f) => { window.__up.push({ p, type: f.type, size: f.size }); return { data: { path: p }, error: null }; } });
    app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  }, mailbox);
  await expect(page.locator('.log-attach [data-drop]')).toBeVisible();
  return ctx;
}

/** Dépôt comme Apple Mail vers Chrome : aucun fichier, « text/uri-list » (lien message:) et « text/plain » */
const dropLink = (page, link = LINK, text = 'Programmation fictive') => page.evaluate(({ link, text }) => {
  const dt = new DataTransfer(); dt.setData('text/uri-list', link); dt.setData('text/plain', text);
  const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
  document.querySelector('.log-attach [data-drop]').dispatchEvent(e);
  return { prevented: e.defaultPrevented, types: [...dt.types], files: dt.files.length };
}, { link, text });

const state = page => page.evaluate(() => ({
  files: window.__DB.prospect_files.filter(f => f.prospect_id === 'pr-1' && f.import_key).map(f => ({ name: f.name, mime: f.mime, key: f.import_key })),
  logs: window.__DB.prospect_logs.filter(l => l.import_key).map(l => ({ pid: l.prospect_id, kind: l.kind, date: l.date, key: l.import_key, body: l.body })),
  google: window.__google, up: window.__up.length,
  diag: window.__DB.client_errors.filter(r => r.message === 'dépôt : aucun fichier').map(r => r.stack) }));

test('v1.60.4 lien message: seul (comme chez Anthony) : message retrouvé dans production@, confirmation, joint au suivi et au journal', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: ABSENT, main: FOUND() });
  const r = await dropLink(page);
  expect(r).toEqual({ prevented: true, types: ['text/uri-list', 'text/plain'], files: 0 });
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Joindre ce message au suivi « Salle Exemple');
  await expect(dlg).toContainText('Programmation fictive · Camille Exemple <camille@example.com> · 03/11/2026');
  await expect(dlg).toContainText('Trouvé dans la boîte production@');
  let s = await state(page);
  expect(s.up).toBe(0);                                // rien n'est joint avant la confirmation
  // recherche dans anthony@ puis production@, avec le seul Message-ID validé
  expect(s.google).toEqual([{ target: 'prospect', action: 'mail_by_msgid', payload: { message_id: ID } }, { target: 'main', action: 'mail_by_msgid', payload: { message_id: ID } }]);
  await dlg.getByRole('button', { name: 'Joindre au suivi' }).click();
  await expect(page.locator('.toast', { hasText: '1 fichier ajouté' })).toBeVisible();
  s = await state(page);
  expect(s.files).toEqual([{ name: 'Programmation fictive.eml', mime: 'message/rfc822', key: 'msgid:' + ID }]);
  expect(s.logs).toHaveLength(1);
  expect(s.logs[0]).toMatchObject({ pid: 'pr-1', kind: 'Mail', date: '2026-11-03', key: 'msgid:' + ID });
  expect(s.logs[0].body).toContain('Bonjour, voici notre proposition fictive.');
  await expect(page.locator('.log-attach').locator('xpath=..')).toContainText('Programmation fictive.eml');
  // diagnostic : « Message-ID présent : oui » et le domaine seulement, jamais l'identifiant ni le sujet
  expect(s.diag).toHaveLength(1);
  expect(JSON.parse(s.diag[0])).toMatchObject({ files: 0, liens: ['message'], 'Message-ID présent': 'oui', domaines: ['exemple-fictif.fr'], lus: [] });
  expect(s.diag[0]).not.toContain('9F1C2E3A'); expect(s.diag[0]).not.toContain('Programmation');
  // aucune adresse transmise par le glisser n'est ouverte par le réseau
  expect(ctx.urls.filter(u => /^(message|file):/i.test(u))).toEqual([]);

  // doublon : le même message glissé une seconde fois → rien n'est ajouté, aucun appel aux scripts
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('déjà joint à ce suivi');
  s = await state(page);
  expect(s.files).toHaveLength(1); expect(s.logs).toHaveLength(1); expect(s.google).toHaveLength(2); expect(s.up).toBe(1);
  expectClean(ctx);
});

test('v1.60.4 lien message: : « Annuler » ne joint rien', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(), main: ABSENT });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Trouvé dans la boîte anthony@');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('.toast').last()).toContainText('Rien n’a été joint');
  const s = await state(page);
  expect(s.files).toEqual([]); expect(s.logs).toEqual([]); expect(s.up).toBe(0);
  expect(s.google.map(g => g.target)).toEqual(['prospect']);   // trouvé dans anthony@ : production@ n'est pas consultée
  expectClean(ctx);
});

test('v1.60.4 lien message: : message introuvable dans les deux boîtes — message clair, rien joint, parcours sans Bureau (journal)', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: ABSENT, main: ABSENT });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Message introuvable dans les boîtes Google (compte de Mail non relié)');
  await expect(dlg).toContainText('Rien n’a été joint');
  await expect(dlg).not.toContainText('Bureau');             // le parcours proposé n'est ni le Bureau ni un glisser-déposer
  await expect(dlg).not.toContainText('glisse');
  await dlg.getByRole('button', { name: 'Noter dans le journal' }).click();
  const form = page.locator('form[data-logform="pr-1"]');
  await expect(form.locator('select[name=kind]')).toHaveValue('Mail');
  await expect(form.locator('textarea[name=body]')).toBeFocused();
  const s = await state(page);
  expect(s.files).toEqual([]); expect(s.logs).toEqual([]); expect(s.up).toBe(0);
  expectClean(ctx);
});

test('v1.60.4 lien message: : script d’anthony@ pas à jour — production@ consultée, la boîte non consultée est nommée', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: null, main: ABSENT });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Message introuvable dans les boîtes Google consultées');
  await expect(dlg).toContainText('anthony@ : script de prospection pas à jour');
  await expect(dlg).toContainText('production@ : message absent');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  expect((await state(page)).up).toBe(0);
  expectClean(ctx);
});

test('v1.60.4 lien message: : réponse d’un script qui ne correspond pas au lien — jamais jointe', async ({ page }) => {
  // identifiant renvoyé différent : réponse ignorée (comptée comme illisible), production@ consultée ensuite
  const other = '<autre-fictif@exemple-fictif.fr>';
  const ctx = await openSuivi(page, { prospect: FOUND(eml(other), other), main: ABSENT });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('anthony@ : réponse du script illisible');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  // identifiant annoncé correct mais contenu d'un autre message : refusé avant toute question
  await page.evaluate(([ok, raw]) => { window.__MAILBOX = { prospect: { ...ok, message: { ...ok.message, raw } }, main: null }; }, [FOUND(), eml(other)]);
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('ne correspond pas au lien de Mail');
  await expect(dlg).toHaveCount(0);
  const s = await state(page);
  expect(s.files).toEqual([]); expect(s.up).toBe(0);
  expectClean(ctx);
});

test('v1.60.4 lien message: : déjà joint à un autre suivi — rien ajouté, aucun appel aux scripts', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(), main: FOUND() });
  // pièce jointe déjà en base pour un autre suivi (lue sur le serveur, pas encore dans l'écran)
  await page.evaluate(id => { window.__DB.prospect_files.push({ id: 'pf-autre', prospect_id: 'pr-autre', name: 'x.eml', path: 'pr-autre/x.eml', import_key: 'msgid:' + id }); }, ID);
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('déjà joint au suivi');
  const s = await state(page);
  expect(s.google).toEqual([]); expect(s.up).toBe(0);
  expectClean(ctx);
});

test('v1.60.4 lien message: invalide (espace, recherche glissée) ou plusieurs liens : refus sans appel, un message après l’autre', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: ABSENT, main: ABSENT });
  for (const bad of ['message:%3Cabc%20def@exemple.fr%3E', 'message:%3Cx@y.fr%20OR%20from:moi%3E', 'message:%3Csans-arobase%3E']){
    await dropLink(page, bad);
    await expect(page.locator('.toast').last()).toContainText('qu’un lien vers le message');
  }
  let s = await state(page);
  expect(s.google).toEqual([]);
  expect(s.diag.map(d => JSON.parse(d)['Message-ID présent'])).toEqual(['non', 'non', 'non']);
  // deux messages glissés ensemble (deux liens) : chacun cherché et confirmé à part
  const ID2 = '<CAJ+fictif=XyZ_0123@mail.exemple.com>';
  await page.evaluate(([a, b]) => { window.__MAILBOX = { prospect: a, main: null }; window.__seq = [a, b]; }, [FOUND(), FOUND(eml(ID2, 'Second message fictif.'), ID2)]);
  await page.evaluate(async () => { const d = await import('./js/data.js'); const inv = d.sb.functions.invoke;
    d.sb.functions.invoke = async (n, o) => { if (n === 'script-google' && o.body.target === 'prospect') window.__MAILBOX.prospect = window.__seq.shift(); return inv(n, o); }; });
  await dropLink(page, `${LINK}\r\nmessage:%3C${encodeURIComponent(ID2.slice(1, -1))}%3E`);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Programmation fictive');
  await dlg.getByRole('button', { name: 'Joindre au suivi' }).click();
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  s = await state(page);
  expect(s.google.filter(g => g.target === 'prospect').map(g => g.payload.message_id)).toEqual([ID, ID2]);
  expect(s.files.map(f => f.key)).toEqual(['msgid:' + ID]);
  expectClean(ctx);
});

test('v1.60.4 autres zones (tâche, fenêtre) : un lien message: seul garde le message « rien à joindre », aucun appel', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async () => { const d = await import('./js/data.js'); window.__google = [];
    const inv = d.sb.functions.invoke; d.sb.functions.invoke = async (n, o) => { if (n === 'script-google') window.__google.push(o.body); return inv(n, o); };
    const z = document.createElement('div'); z.className = 'dropzone'; z.dataset.drop = JSON.stringify({ task_id: 't-fictive' }); z.id = 'zone-tache'; document.body.appendChild(z); });
  await page.evaluate(link => { const dt = new DataTransfer(); dt.setData('text/uri-list', link);
    document.getElementById('zone-tache').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, LINK);
  await expect(page.locator('.toast').last()).toContainText('qu’un lien vers le message');
  expect(await page.evaluate(() => window.__google)).toEqual([]);
  expectClean(ctx);
});

// Mail complet (comme un .eml transmis par Mail ou retrouvé dans Gmail) : participants, texte, une pièce jointe PDF, une image de signature
const MULTI = (id = ID) => ['From: =?UTF-8?Q?Camille_Exempl=C3=A9?= <camille@example.com>', 'To: testeur@example.com, autre@example.com', 'Cc: copie@example.com',
  'Subject: Devis fictif', `Message-ID: ${id}`, 'Date: Wed, 04 Nov 2026 15:30:00 +0100', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="LIM"', '',
  '--LIM', 'Content-Type: text/plain; charset=utf-8', '', 'Bonjour, voici le devis fictif.', '',
  '--LIM', 'Content-Type: application/pdf; name="devis.pdf"', "Content-Disposition: attachment; filename*=UTF-8''d%C3%A9vis%20fictif.pdf", 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQKJWZpY3RpZgo=', '',
  '--LIM', 'Content-Type: image/png', 'Content-Disposition: inline; filename="logo.png"', 'Content-ID: <logo>', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '',
  '--LIM--', ''].join('\r\n');

test('v1.60.4 .eml transmis : original conservé, journal lisible (objet, date, De/À/Cc, texte), pièce jointe extraite ; second dépôt et lien du même message refusés', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(MULTI()), main: ABSENT });
  const dropEml = () => page.evaluate(({ raw, link }) => {
    const dt = new DataTransfer(); dt.items.add(new File([raw], 'Devis fictif.eml', { type: '' }));
    dt.setData('text/uri-list', link); dt.setData('text/plain', 'Devis fictif');
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { raw: MULTI(), link: LINK });
  await dropEml();
  await expect(page.locator('.toast', { hasText: '2 fichiers ajoutés' })).toBeVisible();
  let s = await state(page);
  expect(s.files).toEqual([{ name: 'Devis fictif.eml', mime: 'message/rfc822', key: 'msgid:' + ID },
    { name: 'dévis fictif.pdf', mime: 'application/pdf', key: 'msgid:' + ID + ':pj:1' }]);   // logo de signature non repris
  expect(s.logs).toHaveLength(1);
  expect(s.logs[0]).toMatchObject({ pid: 'pr-1', kind: 'Mail', date: '2026-11-04', key: 'msgid:' + ID });
  expect(s.logs[0].body).toContain('**Devis fictif**');
  expect(s.logs[0].body).toContain('**De :** Camille Exemplé <camille@example.com> · **À :** testeur@example.com, autre@example.com · **Cc :** copie@example.com');
  expect(s.logs[0].body).toContain('Bonjour, voici le devis fictif.');
  expect(s.google).toEqual([]);                        // fichier transmis : aucun appel aux scripts Google
  // diagnostic du dépôt réussi : types, nombre de fichiers, Message-ID oui + domaine, sans nom ni contenu
  const recu = await page.evaluate(() => window.__DB.client_errors.filter(r => r.message === 'dépôt : reçu').map(r => r.stack));
  expect(recu).toHaveLength(1);
  expect(JSON.parse(recu[0])).toMatchObject({ files: 1, 'Message-ID présent': 'oui', domaines: ['exemple-fictif.fr'], lus: [{ ext: 'eml' }] });
  expect(recu[0]).not.toContain('Devis'); expect(recu[0]).not.toContain('9F1C2E3A');

  // conservé après actualisation : relu depuis la base (rien en mémoire seule)
  await page.evaluate(async () => { const d = await import('./js/data.js'); const app = await import('./js/app.js'); await d.loadAll(); app.render(); });
  await expect(page.locator('.log-attach').locator('xpath=..')).toContainText('dévis fictif.pdf');
  await expect(page.locator('.log-attach').locator('xpath=..')).toContainText('Devis fictif.eml');

  // second dépôt du même .eml : refusé (clé vérifiée en base), rien d'ajouté
  await dropEml();
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('déjà joint à ce suivi (même Message-ID)');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  // puis le lien seul du même message : même clé, refusé avant tout appel
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('déjà joint à ce suivi');
  s = await state(page);
  expect(s.files).toHaveLength(2); expect(s.logs).toHaveLength(1); expect(s.google).toEqual([]); expect(s.up).toBe(2);
  expectClean(ctx);
});

test('v1.60.4 lien message: : message retrouvé avec pièce jointe — la confirmation l’annonce, original + pièce + journal', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(MULTI()), main: ABSENT });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('1 pièce jointe du mail : dévis fictif.pdf');
  await dlg.getByRole('button', { name: 'Joindre au suivi' }).click();
  await expect(page.locator('.toast', { hasText: '2 fichiers ajoutés' })).toBeVisible();
  const s = await state(page);
  expect(s.files.map(f => f.key)).toEqual(['msgid:' + ID, 'msgid:' + ID + ':pj:1']);
  expect(s.logs[0].body).toContain('**Cc :** copie@example.com');
  expectClean(ctx);
});
