// v1.60.3 — message glissé directement depuis Apple Mail (Mac, Chrome) dans un suivi : « Failed to fetch ».
// Cause reproduite ici : le message arrive comme un fichier .eml TEMPORAIRE (sur le disque) ; quand l'application d'origine
// l'efface ou le réécrit avant l'envoi, l'envoi au stockage (fetch) ne peut plus lire le fichier et Chrome répond
// « TypeError: Failed to fetch » ; l'exception n'était pas traitée (message « Erreur : Failed to fetch »), rien n'était joint.
// Correction : contenu copié en mémoire dès le dépôt ; aucune adresse transmise par le glisser (message:, file:) n'est récupérée ;
// échec réseau expliqué dans le bilan ; relevé de diagnostic sans donnée personnelle (console + client_errors).
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApp, expectClean } from './helpers.js';

const EML = ['From: Camille Exemple <camille@example.com>', 'To: testeur@example.com', 'Subject: Programmation fictive',
  'Date: Tue, 03 Nov 2026 10:00:00 +0100', 'Content-Type: text/plain; charset=utf-8', '', 'Bonjour, voici notre proposition fictive.', ''].join('\r\n');
const MSG_LINK = 'message:%3Cid-fictif-0001@example.com%3E';

/** Fichier .eml réel sur le disque (comme le fichier temporaire donné par Mail), et son chemin */
function tempEml(name = 'Programmation fictive.eml'){
  const p = join(mkdtempSync(join(tmpdir(), 'matrice-mail-')), name); writeFileSync(p, EML); return p;
}

/** Suivi pr-1 ouvert ; envoi au stockage remplacé par un VRAI fetch du fichier (vers le serveur de test), retenu jusqu'à __open() */
async function openSuivi(page){
  const ctx = await openApp(page);
  ctx.urls = []; page.on('request', r => ctx.urls.push(r.url()));
  ctx.logs = []; page.on('console', m => { if (m.type() === 'info') ctx.logs.push(m.text()); });
  await page.evaluate(async () => {
    const { S } = await import('./js/state.js'); const app = await import('./js/app.js'); const d = await import('./js/data.js');
    window.__up = []; window.__gate = new Promise(r => { window.__open = r; });
    d.sb.storage.from = () => ({ upload: async (p, f) => {
      window.__up.push({ p, type: f.type, size: f.size, mem: true });
      await window.__gate;
      await fetch('/__envoi-test', { method: 'POST', body: f });   // même lecture du fichier que la bibliothèque Supabase
      return { data: { path: p }, error: null };
    } });
    app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
    const inp = document.createElement('input'); inp.type = 'file'; inp.id = 'am-src'; inp.hidden = true; document.body.appendChild(inp);
  });
  await expect(page.locator('.log-attach [data-drop]')).toBeVisible();
  return ctx;
}

/** Vrai DragEvent « drop » avec un vrai DataTransfer : fichier du disque (optionnel) + lien message: + texte, comme Mail vers Chrome */
async function dropFromMail(page, { withFile }){
  return page.evaluate(({ withFile, link }) => {
    const dt = new DataTransfer();
    if (withFile) dt.items.add(document.getElementById('am-src').files[0]);
    dt.setData('text/uri-list', link); dt.setData('text/plain', 'Programmation fictive');
    const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    document.querySelector('.log-attach [data-drop]').dispatchEvent(e);
    return { prevented: e.defaultPrevented, types: [...dt.types] };
  }, { withFile, link: MSG_LINK });
}

test('v1.60.3 cause : un fichier du disque effacé ou réécrit après le dépôt fait échouer le fetch (« Failed to fetch »), pas sa copie en mémoire', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'am-src'; i.hidden = true; document.body.appendChild(i); });
  for (const change of ['effacé', 'réécrit']){
    const p = tempEml();
    await page.locator('#am-src').setInputFiles(p);
    await page.evaluate(async () => { const f = document.getElementById('am-src').files[0]; window.__mem = new File([await f.arrayBuffer()], f.name); });
    if (change === 'effacé') unlinkSync(p); else writeFileSync(p, 'autre contenu');
    const r = await page.evaluate(async () => {
      const send = async body => { try { await fetch('/__envoi-test', { method: 'POST', body }); return 'envoyé'; } catch (e) { return `${e.name}: ${e.message}`; } };
      return { disque: await send(document.getElementById('am-src').files[0]), memoire: await send(window.__mem) };
    });
    expect(r, change).toEqual({ disque: 'TypeError: Failed to fetch', memoire: 'envoyé' });
  }
  expectClean(ctx);
});

test('v1.60.3 parcours Apple Mail : message glissé (fichier .eml temporaire + lien message:) joint au suivi et ajouté au journal, même effacé par Mail ensuite', async ({ page }) => {
  const ctx = await openSuivi(page);
  const p = tempEml();
  await page.locator('#am-src').setInputFiles(p);
  // Chrome ne donne pas toujours de type à ce fichier : cas le plus défavorable
  const r = await dropFromMail(page, { withFile: true });
  expect(r.prevented).toBe(true);
  expect(r.types).toEqual(expect.arrayContaining(['Files', 'text/uri-list', 'text/plain']));
  await expect.poll(() => page.evaluate(() => window.__up.length)).toBe(1);
  unlinkSync(p);                                      // Mail efface son fichier temporaire avant l'envoi
  await page.evaluate(() => window.__open());
  await expect(page.locator('.toast', { hasText: '1 fichier ajouté' })).toBeVisible();
  const db = await page.evaluate(() => ({
    files: window.__DB.prospect_files.filter(f => f.prospect_id === 'pr-1').map(f => [f.name, f.mime, f.size]),
    log: window.__DB.prospect_logs.find(l => l.prospect_id === 'pr-1' && l.kind === 'Mail' && /Programmation fictive/.test(l.body)),
    up: window.__up[0] }));
  expect(db.files).toEqual([['Programmation fictive.eml', 'message/rfc822', EML.length]]);
  expect(db.up.type).toBe('message/rfc822');          // type porté par le fichier envoyé (la bibliothèque ignore contentType pour un fichier)
  expect(db.log).toMatchObject({ date: '2026-11-03' });
  expect(db.log.body).toContain('Bonjour, voici notre proposition fictive.');
  // aucune adresse transmise par le glisser n'est récupérée
  expect(ctx.urls.filter(u => /^(message|file):/i.test(u))).toEqual([]);
  // relevé de diagnostic dans la console, sans le nom du fichier ni l'identifiant du message
  const log = ctx.logs.find(l => l.startsWith('[Matrice] dépôt de fichier'));
  expect(log).toContain('"liens":["message"]'); expect(log).toContain('"ext":"eml"');
  expect(log).not.toContain('Programmation'); expect(log).not.toContain('id-fictif');
  expectClean(ctx);
});

test('v1.60.3 parcours Apple Mail : seul le lien message: transmis — message clair, rien envoyé, aucun fetch, diagnostic noté', async ({ page }) => {
  const ctx = await openSuivi(page);
  await dropFromMail(page, { withFile: false });
  await expect(page.locator('.toast').last()).toContainText('qu’un lien vers le message');
  await expect(page.locator('.toast').last()).not.toContainText('Bureau');
  expect(await page.evaluate(() => window.__up.length)).toBe(0);
  expect(ctx.urls.filter(u => /^(message|file):/i.test(u))).toEqual([]);
  const row = await page.evaluate(() => window.__DB.client_errors.find(r => r.message === 'dépôt : aucun fichier'));
  expect(JSON.parse(row.stack)).toMatchObject({ files: 0, liens: ['message'], lus: [] });
  expect(row.stack).not.toContain('id-fictif');
  expectClean(ctx);
});

test('v1.60.3 parcours Apple Mail : fichier déjà effacé au moment du dépôt — rien envoyé, motif affiché, diagnostic noté', async ({ page }) => {
  const ctx = await openSuivi(page);
  const p = tempEml();
  await page.locator('#am-src').setInputFiles(p);
  unlinkSync(p);
  await dropFromMail(page, { withFile: true });
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Rien n’a été joint');
  await expect(dlg).toContainText('n’existe plus');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  expect(await page.evaluate(() => window.__up.length)).toBe(0);
  const row = await page.evaluate(() => window.__DB.client_errors.find(r => r.message === 'dépôt : fichier illisible'));
  expect(JSON.parse(row.stack)).toMatchObject({ copies: 0, illisibles: ['NotFoundError'], liens: ['message'] });
  expectClean(ctx);
});

test('v1.60.3 envoi : une erreur réseau (« Failed to fetch ») est expliquée dans le bilan, sans erreur non traitée', async ({ page }) => {
  const ctx = await openSuivi(page);
  const p = tempEml('ancien.eml');
  await page.locator('#am-src').setInputFiles(p);
  await page.evaluate(() => document.getElementById('am-src').files[0].size);   // taille relevée par le navigateur au dépôt
  unlinkSync(p);
  await page.evaluate(async () => {
    const d = await import('./js/data.js');
    d.sb.storage.from = () => ({ upload: async (path, f) => { await fetch('/__envoi-test', { method: 'POST', body: f }); return { data: {}, error: null }; } });
    // fichier du disque devenu illisible (envoi sans copie) puis fichier lisible mais serveur injoignable
    const net = new File(['x'], 'devis.pdf', { type: 'application/pdf' });
    window.__done = d.uploadFiles({ prospect_id: 'pr-1' }, [document.getElementById('am-src').files[0]]).then(() =>
      (d.sb.storage.from = () => ({ upload: async () => { throw new TypeError('Failed to fetch'); } }), d.uploadFiles({ prospect_id: 'pr-1' }, [net])));
  });
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('ancien.eml — le fichier n’est plus lisible par le navigateur');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  await expect(dlg).toContainText('devis.pdf — connexion au stockage impossible (Failed to fetch)');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  await page.evaluate(() => window.__done);
  expect(await page.evaluate(() => window.__DB.client_errors.filter(r => r.message === 'envoi au stockage : échec réseau').map(r => JSON.parse(r.stack).lisible))).toEqual([false, true]);
  expect(await page.evaluate(() => window.__DB.prospect_files.length)).toBe(0);
  expectClean(ctx);
});
