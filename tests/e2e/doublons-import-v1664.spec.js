// v1.66.4 — n°15 (suivi Rockalissimo, 23/11/2026) : une prospection envoyée depuis la Matrice est au journal avec son identifiant
// Gmail mais sans clé « msgid:… ». Importer ensuite sa conversation (mail glissé depuis Apple Mail) recréait une seconde entrée.
// Règle d'Anthony : même identifiant Gmail dans le même suivi → l'entrée existante est réutilisée (texte, notes, pièces inchangés),
// le .eml n'est joint que s'il manque, la clé est posée sur l'entrée ; un second dépôt n'ajoute rien ; un mail distinct est importé.
// Boîtes Google SIMULÉES (même contrat que la conversation v1.60.8).
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
      // même limite que le script (THREAD_MAX_, ici window.__THREAD_MAX) : les plus récents ET toujours le message glissé
      let all = [...box.threads[tid]].sort((a, b) => a.date.localeCompare(b.date)); const total = all.length, max = window.__THREAD_MAX || 100;
      if (total > max){ let keep = all.slice(total - max); if (!keep.some(m => m.message_id === payload.message_id)) keep = all.filter(m => m.message_id === payload.message_id).concat(all.slice(total - (max - 1))); all = keep; }
      const messages = all.map(m => {
        const { raw, ...x } = m;
        if ((payload.want || []).includes(m.gmail_id)){
          if (given > 0 && raw.length > budget) rest.push(m.gmail_id); else { x.raw = raw; budget -= raw.length; given++; }
        }
        return x;
      });
      return { data: { ok: true, found: true, thread_id: tid, truncated: total > max, total, messages, rest }, error: null };
    };
    d.sb.storage.from = () => ({ upload: async (p, f) => { window.__up.push({ p, size: f.size }); return { data: { path: p }, error: null }; },
      remove: async () => ({ data: [], error: null }),
      download: async path => { const t = (window.__STORED || {})[path]; return t == null ? { data: null, error: { message: 'absent' } } : { data: new Blob([t]), error: null }; } });
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
/** Prospection déjà envoyée depuis la Matrice : entrée du journal avec l'identifiant Gmail du message 1, sans clé ; inMemory : aussi à l'écran */
const sent = (page, inMemory) => page.evaluate(async ({ g, inMemory }) => {
  const row = { id: 'lg-envoi', prospect_id: 'pr-1', date: '2026-11-09', kind: 'Mail', author: 'anthony-fictif@example.com', gmail_message_id: g,
    body: 'Envoyé — **Prospection** texte de la Matrice', body_html: '<p>Prospection mise en forme</p>', created_at: '2026-11-09T08:00:00Z' };
  window.__DB.prospect_logs.push({ ...row });
  if (inMemory){ const { S, touch } = await import('./js/state.js'); S.db.prospect_logs.push({ ...row }); touch('prospect_logs'); }
}, { g: gid(1), inMemory });

for (const inMemory of [true, false]) test(`v1.66.4 prospection envoyée puis conversation glissée : entrée réutilisée, .eml joint une fois, réponse importée${inMemory ? '' : ' (entrée lue en base)'}`, async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1), meta(2, { pj: true })] } }, main: { threads: {} } });
  await sent(page, inMemory);
  await drop(page, 2);
  await expect(lastToast(page)).toContainText('Conversation importée');
  let s = await state(page);
  // message 1 : UNE seule entrée (l'originale, réutilisée, texte / notes / mise en forme intacts) qui reçoit la clé ; son .eml joint
  const m1 = await page.evaluate(g => window.__DB.prospect_logs.filter(l => l.gmail_message_id === g), gid(1));
  expect(m1).toHaveLength(1);
  expect(m1[0]).toMatchObject({ id: 'lg-envoi', import_key: 'msgid:' + mid(1), body: 'Envoyé — **Prospection** texte de la Matrice',
    body_html: '<p>Prospection mise en forme</p>' });
  expect(m1[0].mail_text).toBeUndefined();
  // message 2 (réponse distincte) : importé normalement, avec sa pièce jointe
  expect(s.logs.map(l => [l.gmail, l.key])).toEqual([[gid(1), 'msgid:' + mid(1)], [gid(2), 'msgid:' + mid(2)]]);
  expect(s.files.map(f => f[1]).sort()).toEqual(['msgid:' + mid(1), 'msgid:' + mid(2), 'msgid:' + mid(2) + ':pj:1'].sort());
  // second dépôt : rien de plus (ni entrée ni fichier), conversation annoncée complète
  await drop(page, 1);
  await expect(lastToast(page)).toContainText('Conversation déjà complète dans ce suivi : 2 messages, rien n’a été ajouté');
  const s2 = await state(page);
  expect(s2.logs).toEqual(s.logs); expect(s2.files).toEqual(s.files);
  expectClean(ctx);
});

test('v1.66.4 nouvelle réponse après coup : importée ; l’entrée réutilisée reste unique', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1)] } }, main: { threads: {} } });
  await sent(page, true);
  await drop(page, 1);
  await expect(lastToast(page)).toContainText('Conversation importée');
  await page.evaluate(m => { window.__BOX.prospect.threads.tA.push(m); }, meta(2));
  await drop(page, 1);
  await expect(lastToast(page)).toContainText('1 message ajouté, 1 message déjà présent');
  const n = await page.evaluate(() => window.__DB.prospect_logs.filter(l => l.prospect_id === 'pr-1' && l.gmail_message_id).map(l => l.gmail_message_id));
  expect(n).toEqual([gid(1), gid(2)]);
  expect((await state(page)).files.map(f => f[1])).toEqual(['msgid:' + mid(1), 'msgid:' + mid(2)]);
  expectClean(ctx);
});

test('v1.66.4 .eml déjà joint sans clé (avant la v1.60.4) : entrée réutilisée, aucun second .eml', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1), meta(2)] } }, main: { threads: {} } });
  await sent(page, true);
  await page.evaluate(async r => {
    const f = { id: 'pf-ancien', prospect_id: 'pr-1', name: 'ancien.eml', mime: 'message/rfc822', path: 'pr-1/ancien.eml', created_at: '2026-11-09T09:00:00Z' };
    window.__DB.prospect_files.push({ ...f }); window.__STORED = { 'pr-1/ancien.eml': r };
    const { S, touch } = await import('./js/state.js'); S.db.prospect_files.push({ ...f }); touch('prospect_files');
  }, raw(1));
  await drop(page, 2);
  await expect(lastToast(page)).toContainText('Conversation importée');
  const emls = await page.evaluate(() => window.__DB.prospect_files.filter(f => /\.eml$/.test(f.name) || f.mime === 'message/rfc822').map(f => f.import_key || f.name));
  expect(emls.filter(x => x === 'ancien.eml' || x === 'msgid:' + '<test-conv-1@example.com>')).toEqual(['ancien.eml']);
  expect(await page.evaluate(g => window.__DB.prospect_logs.filter(l => l.gmail_message_id === g).length, gid(1))).toBe(1);
  expectClean(ctx);
});
