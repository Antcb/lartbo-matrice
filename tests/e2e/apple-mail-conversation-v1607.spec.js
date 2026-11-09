// v1.60.7 — décision d'Anthony du 09/11/2026 : un mail glissé depuis Apple Mail importe TOUTE sa conversation Gmail (reçus et
// envoyés), immédiatement, sans confirmation : progression puis bilan (ajoutés, déjà présents, erreurs) ; un nouveau dépôt n'ajoute
// que les messages manquants ; mêmes identifiants que la messagerie (clé « msgid:<Message-ID> », prospect_logs.gmail_message_id) ;
// conversation d'un autre suivi : rien n'est déplacé ni dupliqué ; message pas encore visible : « synchronisation en cours », reprise bornée.
// Boîtes Google SIMULÉES (même contrat que l'action thread_by_msgid des scripts, contrôlée par tests/static/conversation.mjs) :
// seul l'essai réel sur le Mac d'Anthony prouvera le comportement de Gmail.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const T1 = 'anthony-fictif@example.com', T2 = 'correspondant@exemple-externe.org';   // T1 : même domaine que le compte connecté des essais
const gid = n => '18f00000000000' + String(n).padStart(2, '0');
const mid = n => `<test-conv-${n}@example.com>`;
const link = n => `message:%3C${encodeURIComponent(mid(n).slice(1, -1))}%3E`;
const PDF = 'JVBERi0xLjQKJWZpY3RpZgo=';
/** Message .eml fictif n de la conversation TEST (n impair : envoyé par T1 ; pair : reçu de T2) ; option pièce jointe */
function raw(n, { pj = false } = {}){
  const from = n % 2 ? T1 : T2, to = n % 2 ? T2 : T1, date = `Mon, 09 Nov 2026 ${String(8 + n).padStart(2, '0')}:00:00 +0100`;
  const head = [`From: ${from}`, `To: ${to}`, ...(n === 3 ? ['Cc: copie@example.com'] : []), `Subject: ${n === 1 ? '' : 'Re: '}TEST conversation`, `Message-ID: ${mid(n)}`,
    ...(n > 1 ? [`In-Reply-To: ${mid(n - 1)}`] : []), `Date: ${date}`, 'MIME-Version: 1.0'];
  const text = `Message ${n} de la conversation TEST.` + (n > 1 ? `\r\n\r\nLe lundi, ${n % 2 ? T2 : T1} a écrit :\r\n> Message ${n - 1} de la conversation TEST.` : '');
  if (!pj) return [...head, 'Content-Type: text/plain; charset=utf-8', '', text, ''].join('\r\n');
  return [...head, 'Content-Type: multipart/mixed; boundary="B"', '', '--B', 'Content-Type: text/plain; charset=utf-8', '', text, '',
    '--B', 'Content-Type: application/pdf; name="devis-test.pdf"', 'Content-Disposition: attachment; filename="devis-test.pdf"', 'Content-Transfer-Encoding: base64', '', PDF, '', '--B--', ''].join('\r\n');
}
const meta = (n, opts) => ({ gmail_id: gid(n), message_id: mid(n), subject: `${n === 1 ? '' : 'Re: '}TEST conversation`, from: n % 2 ? T1 : T2, to: n % 2 ? T2 : T1,
  cc: n === 3 ? 'copie@example.com' : '', date: new Date(Date.UTC(2026, 10, 9, 7 + n)).toISOString(), att: opts?.pj ? 1 : 0, raw: raw(n, opts) });

/** Suivi pr-1 ouvert ; boîtes simulées : window.__BOX[cible] = {threads: {id: [messages]}} | {refuse: 'motif'} | null (script pas à jour) */
async function openSuivi(page, boxes){
  const ctx = await openApp(page);
  await page.evaluate(async boxes => {
    const { S, touch } = await import('./js/state.js'); const app = await import('./js/app.js'); const d = await import('./js/data.js');
    const urls = [{ key: 'drive_webhook_url', value: 'https://script.google.com/macros/s/fictif-production/exec' },
      { key: 'prospect_script_url', value: 'https://script.google.com/macros/s/fictif-anthony/exec' }];
    S.db.settings.push(...urls); window.__DB.settings.push(...urls.map(u => ({ ...u }))); touch('settings');
    const p2 = { id: 'pr-2', name: 'Suivi 2', project_id: 'art-a', structure_id: 'st-2', status: 'Interest' };
    window.__DB.prospects.push({ ...p2 }); S.db.prospects.push({ ...p2 }); touch('prospects');
    window.__BOX = boxes; window.__google = []; window.__up = []; window.__BUDGET = 20 * 1024 * 1024;
    const orig = d.sb.functions.invoke;
    // même contrat que threadByMsgId_ (apps-script) : description sans contenu ; « want » → contenu, budget par appel, reste à la passe suivante
    d.sb.functions.invoke = async (name, o) => {
      if (name !== 'script-google') return orig(name, o);
      const { target, action, payload } = o.body; window.__google.push({ target, action, payload: JSON.parse(JSON.stringify(payload)) });
      const box = window.__BOX[target];
      if (!box) return { data: { ok: false, error: 'Action inconnue : ' + action }, error: null };
      if (box.refuse) return { data: { ok: false, refused: true, error: box.refuse }, error: null };
      const tid = Object.keys(box.threads).find(t => box.threads[t].some(m => m.message_id === payload.message_id));
      if (!tid) return { data: { ok: true, found: false }, error: null };
      let budget = window.__BUDGET, given = 0; const rest = [];
      const messages = [...box.threads[tid]].sort((a, b) => a.date.localeCompare(b.date)).map(m => {
        const { raw, ...x } = m;
        if ((payload.want || []).includes(m.gmail_id)){
          if (given > 0 && raw.length > budget) rest.push(m.gmail_id); else { x.raw = raw; budget -= raw.length; given++; }
        }
        return x;
      });
      return { data: { ok: true, found: true, thread_id: tid, truncated: false, messages, rest }, error: null };
    };
    d.sb.storage.from = () => ({ upload: async (p, f) => { window.__up.push({ p, size: f.size }); return { data: { path: p }, error: null }; },
      remove: async () => ({ data: [], error: null }), download: async () => ({ data: null, error: { message: 'absent' } }) });
    app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  }, boxes);
  await expect(page.locator('.log-attach [data-drop]')).toBeVisible();
  return ctx;
}
const drop = (page, n) => page.evaluate(l => {
  const dt = new DataTransfer(); dt.setData('text/uri-list', l); dt.setData('text/plain', 'TEST conversation');
  document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, link(n));
const state = page => page.evaluate(() => ({
  files: window.__DB.prospect_files.filter(f => f.import_key).map(f => [f.prospect_id, f.import_key, f.name]),
  logs: window.__DB.prospect_logs.filter(l => l.gmail_message_id || (l.import_key || '').startsWith('msgid:')).map(l => ({ pid: l.prospect_id, gmail: l.gmail_message_id, key: l.import_key, date: l.date, body: l.body })),
  google: window.__google }));
const lastToast = page => page.locator('.toast').last();

test('v1.60.7 conversation de 3 messages (1 reçu, 2 envoyés) : dépôt d’un message → les 3 importés sans question, une seule fois, avec leurs identifiants', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(3), meta(1), meta(2)] } }, main: { threads: {} } });
  await drop(page, 2);
  await expect(lastToast(page)).toContainText('Conversation importée : 3 messages ajoutés, 0 message déjà présent');
  await expect(page.locator('dialog.ask')).toHaveCount(0);                     // aucune confirmation
  const s = await state(page);
  expect(s.files.map(f => f[1])).toEqual([1, 2, 3].map(n => 'msgid:' + mid(n)));   // ordre chronologique
  expect(s.logs.map(l => [l.pid, l.gmail, l.key])).toEqual([1, 2, 3].map(n => ['pr-1', gid(n), 'msgid:' + mid(n)]));
  expect(s.logs[1].body).toContain('Reçu — **Re: TEST conversation**');
  expect(s.logs[0].body).toContain('Envoyé — **TEST conversation**');
  expect(s.logs[2].body).toContain('**Cc :** copie@example.com');
  // le texte cité (« … a écrit : > … ») n'est pas un message de plus
  expect(s.logs[2].body).not.toContain('> Message 2');
  // description puis contenu des seuls messages manquants, dans la boîte anthony@ (titulaire) ; production@ pas consultée
  expect(s.google.map(g => [g.target, g.action, g.payload.message_id, g.payload.want || null])).toEqual([
    ['prospect', 'thread_by_msgid', mid(2), null], ['prospect', 'thread_by_msgid', mid(2), [gid(1), gid(2), gid(3)]]]);
  expectClean(ctx);
});

test('v1.60.7 4e réponse puis nouveau dépôt d’un message déjà importé : seul le 4e est ajouté ; puis « conversation déjà complète » ; conservé après actualisation', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1), meta(2), meta(3)] } }, main: { threads: {} } });
  await drop(page, 1);
  await expect(lastToast(page)).toContainText('3 messages ajoutés');
  await page.evaluate(m4 => { window.__BOX.prospect.threads.tA.push(m4); window.__google = []; }, meta(4));
  await drop(page, 1);
  await expect(lastToast(page)).toContainText('Conversation importée : 1 message ajouté, 3 messages déjà présents');
  let s = await state(page);
  expect(s.logs.map(l => l.gmail)).toEqual([1, 2, 3, 4].map(gid));
  expect(s.google[1].payload.want).toEqual([gid(4)]);                          // seul le manquant est lu
  await page.evaluate(() => { window.__google = []; });
  await drop(page, 4);
  await expect(lastToast(page)).toContainText('Conversation déjà complète dans ce suivi : 4 messages, rien n’a été ajouté');
  s = await state(page);
  expect(s.google.filter(g => g.payload.want)).toEqual([]);                    // aucun contenu relu
  // conservé après actualisation (relu depuis la base)
  await page.evaluate(async () => { const d = await import('./js/data.js'); const app = await import('./js/app.js'); await d.loadAll(); app.render(); });
  const journal = page.locator('.log-attach').locator('xpath=..');
  for (const n of [1, 2, 3, 4]) await expect(journal).toContainText(`Message ${n} de la conversation TEST.`);
  expect((await state(page)).files).toHaveLength(4);
  expectClean(ctx);
});

test('v1.60.7 pièce jointe d’un message de la conversation : extraite en pièce du suivi, avec sa clé', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1), meta(2, { pj: true })] } }, main: { threads: {} } });
  await drop(page, 1);
  await expect(lastToast(page)).toContainText('2 messages ajoutés, 0 message déjà présent (3 fichiers enregistrés, pièces jointes comprises)');
  const s = await state(page);
  expect(s.files).toContainEqual(['pr-1', 'msgid:' + mid(2) + ':pj:1', 'devis-test.pdf']);
  expectClean(ctx);
});

test('v1.60.7 conversation lourde : lue en plusieurs passes (budget par appel), le bilan reste exact', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1), meta(2), meta(3)] } }, main: { threads: {} } });
  await page.evaluate(() => { window.__BUDGET = 10; });                        // un message par appel
  await drop(page, 3);
  await expect(lastToast(page)).toContainText('3 messages ajoutés');
  const s = await state(page);
  expect(s.google.filter(g => g.payload.want).map(g => g.payload.want)).toEqual([[gid(1), gid(2), gid(3)], [gid(2), gid(3)], [gid(3)]]);
  expect(s.logs).toHaveLength(3);
  expectClean(ctx);
});

test('v1.60.7 conversation déjà rattachée à un autre suivi : rien déplacé ni ajouté, le suivi est nommé et s’ouvre', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1), meta(2), meta(3)] } }, main: { threads: {} } });
  // un message de la conversation est déjà au journal du suivi 2 (identifiant Gmail, comme l'écrira la messagerie)
  await page.evaluate(g => { window.__DB.prospect_logs.push({ id: 'lg-autre', prospect_id: 'pr-2', date: '2026-11-09', kind: 'Mail', body: 'x', gmail_message_id: g }); }, gid(2));
  await drop(page, 3);
  const t = lastToast(page);
  await expect(t).toContainText('Cette conversation est déjà rattachée au suivi « Festival Fictif');
  const s = await state(page);
  expect(s.files).toEqual([]); expect(s.logs.filter(l => l.pid === 'pr-1')).toEqual([]);
  expect(s.google.filter(g => g.payload.want)).toEqual([]);
  await t.getByRole('button', { name: 'Ouvrir le suivi' }).click();
  await expect.poll(() => page.evaluate(async () => (await import('./js/state.js')).S.suiviPage)).toBe('pr-2');
  expectClean(ctx);
});

test('v1.60.7 réponse pas encore visible chez Google : « synchronisation en cours », nouvel essai, puis import ; jamais annoncé complet avant', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1), meta(2)] } }, main: { threads: {} } });
  await page.evaluate(async () => { const p = await import('./js/prospection.js'); p.SYNC_RETRIES.splice(0, 4, 1, 1, 1, 1); });   // essais rapprochés (test)
  await drop(page, 3);                                                         // message 3 envoyé depuis Apple Mail, pas encore chez Google
  await expect(lastToast(page)).toContainText('Synchronisation en cours : le message n’est pas encore visible chez Google');
  await expect(lastToast(page)).toContainText('Rien n’est encore importé');
  expect((await state(page)).logs).toEqual([]);
  await page.evaluate(m3 => { window.__BOX.prospect.threads.tA.push(m3); }, meta(3));   // Google le rend visible
  await expect(lastToast(page)).toContainText('Conversation importée : 3 messages ajoutés', { timeout: 10_000 });
  expect((await state(page)).logs.map(l => l.gmail)).toEqual([1, 2, 3].map(gid));
  expectClean(ctx);
});

test('v1.60.7 toujours invisible après les nouveaux essais : import dit incomplet, rien de joint', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: {} }, main: { threads: {} } });
  await page.evaluate(async () => { const p = await import('./js/prospection.js'); p.SYNC_RETRIES.splice(0, 4, 0.2, 0.2); });
  await drop(page, 3);
  const dlg = page.locator('dialog.ask');
  await expect(dlg).toContainText('Toujours introuvable après 2 nouveaux essais', { timeout: 10_000 });
  await expect(dlg).toContainText('import incomplet');
  await dlg.getByRole('button', { name: 'Fermer' }).click();
  expect((await state(page)).logs).toEqual([]);
  expect((await state(page)).google.filter(g => g.target === 'prospect')).toHaveLength(3);   // 1 + 2 nouveaux essais, bornés
  expectClean(ctx);
});

test('v1.60.7 anthony@ refusée (compte non titulaire) : conversation lue dans production@ avec les droits d’équipe', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { refuse: 'Recherche dans la boîte titulaire@exemple-fictif.fr réservée à son titulaire : rien n’a été consulté.' },
    main: { threads: { tP: [meta(1), meta(2)] } } });
  await drop(page, 2);
  await expect(lastToast(page)).toContainText('2 messages ajoutés, 0 message déjà présent — conversation lue dans production@');
  const s = await state(page);
  expect(s.google.filter(g => g.target === 'prospect').every(g => !g.payload.want)).toBe(true);   // aucun contenu demandé à anthony@
  expectClean(ctx);
});
