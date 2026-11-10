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
    const urls = [{ key: 'drive_webhook_url', value: 'https://script.google.com/macros/s/fictif-production/exec' },
      { key: 'prospect_script_url', value: 'https://script.google.com/macros/s/fictif-anthony/exec' }];
    S.db.settings.push(...urls); window.__DB.settings.push(...urls.map(u => ({ ...u }))); touch('settings');   // gardés après un rechargement des données
    window.__MAILBOX = mailbox; window.__google = []; window.__up = [];
    const orig = d.sb.functions.invoke;
    d.sb.functions.invoke = async (name, o) => {
      if (name !== 'script-google') return orig(name, o);
      window.__google.push({ target: o.body.target, action: o.body.action, payload: o.body.payload });
      const r = window.__MAILBOX[o.body.target];
      // (v1.60.7) l'application demande la CONVERSATION (thread_by_msgid) : une réponse « message trouvé » de ces essais v1.60.4
      // devient une conversation d'un seul message (identifiant Gmail tiré du Message-ID) ; le contenu n'est rendu que s'il est demandé
      if (o.body.action === 'thread_by_msgid' && r && r.found === true && r.message){
        const m = r.message, gid = '18f' + [...m.message_id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(13, '0');
        const meta = { gmail_id: gid, message_id: m.message_id, subject: m.subject, from: m.from, to: '', cc: '', date: m.date, att: (String(m.raw).match(/Content-Disposition: attachment/g) || []).length };
        if ((o.body.payload.want || []).includes(gid)) meta.raw = m.raw;
        return { data: { ok: true, found: true, thread_id: 't-' + gid, messages: [meta], rest: [] }, error: null };
      }
      return { data: r || { ok: false, error: 'Action inconnue : ' + o.body.action }, error: null };
    };
    window.__removed = [];
    d.sb.storage.from = () => ({ upload: async (p, f) => { window.__up.push({ p, type: f.type, size: f.size }); return { data: { path: p }, error: null }; },
      remove: async paths => { window.__removed.push(...paths); return { data: [], error: null }; },
      // fichiers déjà stockés (mails joints avant la v1.60.4) : lecture seule, téléchargements relevés
      download: async path => { (window.__downloads ||= []).push(path); const t = (window.__STORED || {})[path]; return t == null ? { data: null, error: { message: 'absent' } } : { data: new Blob([t]), error: null }; } });
    // (v1.60.7) nouveaux essais « synchronisation en cours » : désactivés dans ces essais v1.60.4 (essayés dans apple-mail-conversation-v1607)
    (await import('./js/prospection.js')).SYNC_RETRIES.length = 0;
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

test('v1.60.4 lien message: seul (comme chez Anthony) : message retrouvé dans production@, joint sans question au suivi et au journal (v1.60.7)', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: ABSENT, main: FOUND() });
  const r = await dropLink(page);
  expect(r).toEqual({ prevented: true, types: ['text/uri-list', 'text/plain'], files: 0 });
  await expect(page.locator('.toast').last()).toContainText('Conversation importée : 1 message ajouté, 0 message déjà présent — conversation lue dans production@');
  await expect(page.locator('dialog.ask')).toHaveCount(0);   // (v1.60.7) aucune confirmation
  let s = await state(page);
  // recherche dans anthony@ puis production@, avec le seul Message-ID validé ; contenu demandé ensuite à production@ seulement
  expect(s.google.map(g => [g.target, g.action, g.payload.message_id, !!g.payload.want])).toEqual([['prospect', 'thread_by_msgid', ID, false], ['main', 'thread_by_msgid', ID, false], ['main', 'thread_by_msgid', ID, true]]);
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

  // doublon : le même message glissé une seconde fois → conversation relue (description seule), rien n'est ajouté
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('Conversation déjà complète dans ce suivi : 1 message, rien n’a été ajouté');
  await expect(page.locator('dialog.ask')).toHaveCount(0);
  s = await state(page);
  expect(s.files).toHaveLength(1); expect(s.logs).toHaveLength(1); expect(s.google.filter(g => g.payload.want)).toHaveLength(1); expect(s.up).toBe(1);
  expectClean(ctx);
});

test('v1.60.4 lien message: : trouvé dans anthony@ — production@ n’est pas consultée (v1.60.7 : plus de question « Annuler »)', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(), main: ABSENT });
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('conversation lue dans anthony@');
  const s = await state(page);
  expect(s.files).toHaveLength(1); expect(s.logs).toHaveLength(1);
  expect(s.google.map(g => g.target)).toEqual(['prospect', 'prospect']);   // description puis contenu, dans anthony@ seulement
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
  // identifiant annoncé correct mais contenu d'un autre message : jamais joint, dit dans le bilan
  await page.evaluate(([ok, raw]) => { window.__MAILBOX = { prospect: { ...ok, message: { ...ok.message, raw } }, main: null }; }, [FOUND(), eml(other)]);
  await dropLink(page);
  await expect(dlg).toContainText('contenu renvoyé par le script illisible ou différent : non importé');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  const s = await state(page);
  expect(s.files).toEqual([]); expect(s.up).toBe(0);
  expectClean(ctx);
});

/** Second suivi fictif (pr-2, Festival Fictif), présent en base et à l'écran */
const addSuivi2 = page => page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
  const p = { id: 'pr-2', name: 'Suivi 2', project_id: 'art-a', structure_id: 'st-2', status: 'Interest' };
  window.__DB.prospects.push({ ...p }); S.db.prospects.push({ ...p }); touch('prospects'); });

test('v1.60.4 décision 2 : lien d’un message déjà joint à un autre suivi — rien ajouté, aucun appel, le suivi concerné est nommé et s’ouvre', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(), main: FOUND() });
  await addSuivi2(page);
  // pièce jointe déjà en base pour l'autre suivi (lue sur le serveur, pas encore dans l'écran)
  await page.evaluate(id => { window.__DB.prospect_files.push({ id: 'pf-autre', prospect_id: 'pr-2', name: 'x.eml', path: 'pr-2/x.eml', import_key: 'msgid:' + id }); }, ID);
  await dropLink(page);
  const t = page.locator('.toast').last();
  await expect(t).toContainText('déjà joint au suivi « Festival Fictif');
  let s = await state(page);
  expect(s.google).toEqual([]); expect(s.up).toBe(0); expect(s.files).toEqual([]);
  await t.getByRole('button', { name: 'Ouvrir le suivi' }).click();
  await expect.poll(() => page.evaluate(async () => (await import('./js/state.js')).S.suiviPage)).toBe('pr-2');
  expectClean(ctx);
});

test('v1.60.4 décision 2 : .eml d’un message déjà joint à un autre suivi — refusé, bilan avec accès au suivi concerné', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: ABSENT, main: ABSENT });
  await addSuivi2(page);
  await page.evaluate(id => { window.__DB.prospect_files.push({ id: 'pf-autre', prospect_id: 'pr-2', name: 'x.eml', path: 'pr-2/x.eml', import_key: 'msgid:' + id }); }, ID);
  await page.evaluate(raw => { const dt = new DataTransfer(); dt.items.add(new File([raw], 'Devis fictif.eml', { type: '' }));
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, MULTI());
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('déjà joint au suivi « Festival Fictif');
  await dlg.getByRole('button', { name: 'Ouvrir le suivi concerné' }).click();
  await expect.poll(() => page.evaluate(async () => (await import('./js/state.js')).S.suiviPage)).toBe('pr-2');
  const s = await state(page);
  expect(s.up).toBe(0); expect(s.files).toEqual([]); expect(s.logs).toEqual([]);
  expectClean(ctx);
});

test('v1.60.4 décision 3 : mail joint AVANT la v1.60.4 (.eml stocké sans clé) — reconnu par son Message-ID, en lecture seule, ni perdu ni réimporté', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(MULTI()), main: ABSENT });
  await addSuivi2(page);
  // .eml joint en v1.60.3 dans pr-1 (sans import_key) ; journal d'alors sous une autre forme : seul le fichier stocké permet de le reconnaître
  await page.evaluate(async raw => { const { S, touch } = await import('./js/state.js');
    const f = { id: 'pf-ancien', prospect_id: 'pr-1', name: 'Devis fictif.eml', path: 'pr-1/1700000000000_Devis_fictif.eml', mime: 'message/rfc822', size: raw.length, created_at: '2026-11-04T15:00:00Z' };
    window.__DB.prospect_files.push({ ...f }); S.db.prospect_files.push({ ...f }); touch('prospect_files');
    window.__STORED = { [f.path]: raw }; }, MULTI());
  const before = await page.evaluate(() => JSON.stringify(window.__DB.prospect_files));
  const writes = () => page.evaluate(() => window.__calls.filter(c => ['prospect_files', 'prospect_logs'].includes(c.table) && c.op !== 'select').length);
  const w0 = await writes();
  // lien du même message déposé sur le même suivi : reconnu comme déjà présent ; sa conversation est relue (description seule,
  // v1.60.7) pour d'éventuels autres messages ; rien n'est réimporté
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('Conversation déjà complète dans ce suivi : 1 message, rien n’a été ajouté');
  let s = await state(page);
  expect(s.google.filter(g => g.payload.want)).toEqual([]); expect(s.up).toBe(0);
  // .eml du même message déposé sur un AUTRE suivi : reconnu, refusé, accès au suivi d'origine
  await page.evaluate(async () => { const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); S.suiviPage = 'pr-2'; app.render(); });
  await page.evaluate(raw => { const dt = new DataTransfer(); dt.items.add(new File([raw], 'Devis fictif.eml', { type: '' }));
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, MULTI());
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('déjà joint au suivi « Salle Exemple');
  await dlg.getByRole('button', { name: 'Ouvrir le suivi concerné' }).click();
  await expect.poll(() => page.evaluate(async () => (await import('./js/state.js')).S.suiviPage)).toBe('pr-1');
  // lecture seule : aucune écriture, ligne historique inchangée (pas de clé ajoutée), fichier seulement téléchargé
  expect(await writes()).toBe(w0);
  expect(await page.evaluate(() => JSON.stringify(window.__DB.prospect_files))).toBe(before);
  s = await state(page);
  expect(s.up).toBe(0); expect(s.logs).toEqual([]);
  expect(await page.evaluate(() => [...new Set(window.__downloads)])).toEqual(['pr-1/1700000000000_Devis_fictif.eml']);
  expect(await page.evaluate(() => window.__removed)).toEqual([]);
  expectClean(ctx);
});

test('v1.60.4 décision 1 : recherche dans anthony@ refusée par le script (compte non titulaire) — dit clairement, production@ consultée avec les droits d’équipe', async ({ page }) => {
  const refused = { ok: false, refused: true, error: 'Recherche dans la boîte titulaire@exemple-fictif.fr réservée à son titulaire : rien n’a été consulté.' };
  const ctx = await openSuivi(page, { prospect: refused, main: FOUND() });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(page.locator('.toast').last()).toContainText('conversation lue dans production@');
  // même chose avec un message absent de production@ : le refus d'anthony@ est dit tel quel
  await page.evaluate(() => { window.__MAILBOX.main = { ok: true, found: false }; });
  await dropLink(page, 'message:%3Cautre-absent@exemple-fictif.fr%3E');
  await expect(dlg).toContainText('anthony@ : Recherche dans la boîte titulaire@exemple-fictif.fr réservée à son titulaire : rien n’a été consulté.');
  await expect(dlg).toContainText('production@ : message absent');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  expect((await state(page)).up).toBe(1);
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
  // deux messages glissés ensemble (deux liens) : chacun cherché et importé à part (v1.60.7 : sans question)
  const ID2 = '<CAJ+fictif=XyZ_0123@mail.exemple.com>';
  await page.evaluate(([a, b]) => { window.__MAILBOX = { prospect: a, main: null }; window.__seq = [a, b]; }, [FOUND(), FOUND(eml(ID2, 'Second message fictif.'), ID2)]);
  await page.evaluate(async () => { const d = await import('./js/data.js'); const inv = d.sb.functions.invoke;
    d.sb.functions.invoke = async (n, o) => { if (n === 'script-google' && o.body.target === 'prospect') window.__MAILBOX.prospect = window.__seq.shift(); return inv(n, o); }; });
  await page.evaluate(([a, b]) => { window.__seq = [a, a, b, b]; }, [FOUND(), FOUND(eml(ID2, 'Second message fictif.'), ID2)]);
  await dropLink(page, `${LINK}\r\nmessage:%3C${encodeURIComponent(ID2.slice(1, -1))}%3E`);
  await expect.poll(async () => (await state(page)).files.map(f => f.key)).toEqual(['msgid:' + ID, 'msgid:' + ID2]);
  s = await state(page);
  expect([...new Set(s.google.filter(g => g.target === 'prospect').map(g => g.payload.message_id))]).toEqual([ID, ID2]);
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
  await expect(dlg).toContainText('déjà joint à ce suivi en entier (même Message-ID)');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  // puis le lien seul du même message : même clé, même vérification partie par partie, rien d'ajouté (conversation relue sans contenu)
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('Conversation déjà complète dans ce suivi');
  s = await state(page);
  expect(s.files).toHaveLength(2); expect(s.logs).toHaveLength(1); expect(s.google.filter(g => g.payload.want)).toEqual([]); expect(s.up).toBe(2);
  expectClean(ctx);
});

test('v1.60.4 lien message: : message retrouvé avec pièce jointe — original + pièce + journal, sans question (v1.60.7)', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(MULTI()), main: ABSENT });
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('1 message ajouté, 0 message déjà présent (2 fichiers enregistrés, pièces jointes comprises)');
  const s = await state(page);
  expect(s.files.map(f => f.key)).toEqual(['msgid:' + ID, 'msgid:' + ID + ':pj:1']);
  expect(s.logs[0].body).toContain('**Cc :** copie@example.com');
  expectClean(ctx);
});

// ─── Relecture v1.60.4 : points facultatifs corrigés ───

test('v1.60.4 relecture 5 : objet, expéditeur et date relus dans le .eml, pas ceux de la réponse du script (v1.60.7 : nom du fichier et journal)', async ({ page }) => {
  const reply = FOUND(MULTI()); reply.message.subject = 'Objet annoncé par le script'; reply.message.from = 'annonce@exemple.fr'; reply.message.date = '2020-01-01T00:00:00.000Z';
  const ctx = await openSuivi(page, { prospect: reply, main: ABSENT });
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('Conversation importée');
  const s = await state(page);
  expect(s.files[0].name).toBe('Devis fictif.eml');
  expect(s.logs[0]).toMatchObject({ date: '2026-11-04' });
  expect(s.logs[0].body).toContain('**Devis fictif**'); expect(s.logs[0].body).toContain('Camille Exemplé <camille@example.com>');
  expect(JSON.stringify(s)).not.toContain('Objet annoncé'); expect(JSON.stringify(s)).not.toContain('annonce@');
  expectClean(ctx);
});

test('v1.60.4 relecture 2 : plus de 20 pièces jointes — 20 extraites, les autres annoncées (confirmation et bilan), l’original les garde', async ({ page }) => {
  const part = i => ['--B', `Content-Type: application/pdf; name="piece${i}.pdf"`, 'Content-Disposition: attachment', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQK', ''];
  const big = ['From: Camille Exemple <camille@example.com>', 'To: testeur@example.com', 'Subject: Beaucoup de pièces', `Message-ID: ${ID}`, 'Date: Wed, 04 Nov 2026 15:30:00 +0100',
    'Content-Type: multipart/mixed; boundary="B"', '', '--B', 'Content-Type: text/plain; charset=utf-8', '', 'Texte fictif.', '', ...Array.from({ length: 22 }, (_, i) => part(i + 1)).flat(), '--B--', ''].join('\r\n');
  const ctx = await openSuivi(page, { prospect: FOUND(big), main: ABSENT });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  // (v1.60.7) plus de confirmation : les pièces non extraites sont annoncées dans le bilan de l'import
  await expect(dlg).toContainText('2 pièces du mail non extraites');
  await expect(dlg).toContainText('l’original .eml les contient');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  const s = await state(page);
  expect(s.files).toHaveLength(21); expect(s.files[0].name).toBe('Beaucoup de pièces.eml');
  expectClean(ctx);
});

test('v1.60.4 relecture 3 : joint au même moment depuis un autre poste (clé unique) — message clair en français, fichier envoyé effacé', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(), main: ABSENT });
  await page.evaluate(() => { window.__INSERT_ERROR = { prospect_files: { code: '23505', message: 'duplicate key value violates unique constraint "prospect_files_import_key_key"' } }; });
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('déjà joint par ailleurs au même moment (autre poste ou autre onglet) : rien n’a été ajouté');
  await expect(dlg).not.toContainText('duplicate');
  await expect(page.locator('.toast', { hasText: 'duplicate' })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  const r = await page.evaluate(() => ({ up: window.__up.map(u => u.p), removed: window.__removed, logs: window.__DB.prospect_logs.filter(l => l.import_key).length }));
  expect(r.up).toHaveLength(1); expect(r.removed).toEqual(r.up);   // aucun fichier orphelin dans le stockage
  expect(r.logs).toBe(0);                                            // l'original n'est pas joint : rien d'autre n'est ajouté
  expectClean(ctx);
});

test('v1.60.4 relecture 4 : import partiel (journal refusé, pièce manquante) — le dépôt suivant complète ce qui manque, sans rien dupliquer', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(MULTI()), main: ABSENT });
  const dropEml = () => page.evaluate(raw => { const dt = new DataTransfer(); dt.items.add(new File([raw], 'Devis fictif.eml', { type: '' }));
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, MULTI());
  const dlg = page.locator('dialog.ask');
  // 1er dépôt : l'entrée du journal est refusée par la base → original et pièce joints, échec dit dans le bilan
  await page.evaluate(() => { window.__INSERT_ERROR = { prospect_logs: { code: '42501', message: 'permission refusée (simulée)' } }; });
  await dropEml();
  await expect(dlg).toContainText('Devis fictif.eml (entrée du journal) — enregistrement refusé');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  let s = await state(page);
  expect(s.files.map(f => f.key)).toEqual(['msgid:' + ID, 'msgid:' + ID + ':pj:1']); expect(s.logs).toEqual([]);
  // 2e dépôt du même .eml : seule l'entrée du journal est ajoutée
  await page.evaluate(() => { window.__INSERT_ERROR = null; });
  await dropEml();
  await expect(page.locator('.toast', { hasText: 'Mail ajouté au journal' })).toBeVisible();
  s = await state(page);
  expect(s.files).toHaveLength(2); expect(s.logs).toHaveLength(1); expect(s.up).toBe(2);
  // pièce du mail perdue (ligne absente) : le lien du même message la complète, seule (v1.60.7 : sans question, compté « complété »)
  await page.evaluate(async id => { const { S, touch } = await import('./js/state.js');
    const k = 'msgid:' + id + ':pj:1'; window.__DB.prospect_files = window.__DB.prospect_files.filter(f => f.import_key !== k);
    S.db.prospect_files = S.db.prospect_files.filter(f => f.import_key !== k); touch('prospect_files'); }, ID);
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('0 message ajouté, 1 message complété, 0 message déjà présent');
  s = await state(page);
  expect(s.files.map(f => f.key).sort()).toEqual(['msgid:' + ID, 'msgid:' + ID + ':pj:1']); expect(s.logs).toHaveLength(1); expect(s.up).toBe(3);
  expectClean(ctx);
});

test('v1.60.4 relecture B2 : ancien .eml illisible — vérification incomplète annoncée avant tout rattachement ; échec relu ensuite (non mémorisé)', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: FOUND(MULTI()), main: ABSENT });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js');
    const f = { id: 'pf-ancien', prospect_id: 'pr-1', name: 'Devis fictif.eml', path: 'pr-1/1700000000000_Devis_fictif.eml', mime: 'message/rfc822', size: 10, created_at: '2026-11-04T15:00:00Z' };
    window.__DB.prospect_files.push({ ...f }); S.db.prospect_files.push({ ...f }); touch('prospect_files'); window.__STORED = {}; });   // téléchargement en échec
  await dropLink(page);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Vérification incomplète');
  await expect(dlg).toContainText('1 fichier .eml joint avant la v1.60.4 illisible pour le moment');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  let s = await state(page);
  expect(s.up).toBe(0); expect(s.files).toEqual([]);
  // le fichier redevient lisible : l'échec n'a pas été mémorisé, le mail est reconnu comme déjà joint, rien n'est ajouté
  await page.evaluate(raw => { window.__STORED = { 'pr-1/1700000000000_Devis_fictif.eml': raw }; }, MULTI());
  await dropLink(page);
  await expect(page.locator('.toast').last()).toContainText('Conversation déjà complète dans ce suivi');
  s = await state(page);
  expect(s.up).toBe(0);
  // relu à chaque vérification tant qu'il était illisible (jamais mémorisé en échec)
  expect(await page.evaluate(() => window.__downloads.filter(p => p === 'pr-1/1700000000000_Devis_fictif.eml').length)).toBeGreaterThanOrEqual(2);
  expectClean(ctx);
});

test('v1.60.4 relecture B2 : plus de 300 anciens .eml — vérification incomplète annoncée (.eml déposé), jamais joint sans accord', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: ABSENT, main: ABSENT });
  await page.evaluate(async () => { const { S, touch } = await import('./js/state.js'); window.__STORED = {};
    for (let i = 0; i < 301; i++){ const f = { id: 'pf-a' + i, prospect_id: 'pr-1', name: `ancien-${i}.eml`, path: `pr-1/ancien-${i}.eml`, mime: 'message/rfc822', size: 10,
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() };
      window.__DB.prospect_files.push({ ...f }); S.db.prospect_files.push({ ...f }); window.__STORED[f.path] = `Message-ID: <ancien-${i}@exemple-fictif.fr>\r\n\r\nx`; }
    touch('prospect_files'); });
  await page.evaluate(raw => { const dt = new DataTransfer(); dt.items.add(new File([raw], 'Devis fictif.eml', { type: '' }));
    document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, MULTI());
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Vérification incomplète');
  await expect(dlg).toContainText('1 fichier .eml ancien non vérifié (plus de 300)');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await expect(dlg).toContainText('non joint : vérification incomplète');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  const s = await state(page);
  expect(s.up).toBe(0); expect(s.files).toEqual([]);
  expectClean(ctx);
});
