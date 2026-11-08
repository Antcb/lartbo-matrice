// Relecture v1.63 (B1) : dépose Apple Mail (v1.60.4, clé import_key « msgid:<Message-ID> ») ↔ synchronisation de la messagerie.
// Données FICTIVES, fausse base, réseau bloqué. La partie serveur (mail_journal / mail_link_thread) est vérifiée sur une base PostgreSQL
// locale par supabase/repetitions/2026-11-08_v1.63_messagerie_essai.sql (mêmes clés, au caractère près) ; ici : le côté navigateur.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const ID = '<9F1C2E3A-1B2C@exemple-fictif.fr>';
const eml = id => ['From: Prog A <prog@a.example>', 'To: testeur@example.com', 'Subject: Programmation fictive', `Message-ID: ${id}`,
  'Date: Tue, 03 Nov 2026 10:00:00 +0100', 'Content-Type: text/plain; charset=utf-8', '', 'Bonjour, proposition fictive.', ''].join('\r\n');
const deposer = (page, id) => page.evaluate(async ([raw]) => {
  const d = await import('./js/data.js');
  await d.uploadFiles({ prospect_id: 'pr-1' }, [new File([raw], 'message.eml', { type: 'message/rfc822' })]);
  document.querySelector('dialog.ask[open]')?.close();
  return { logs: window.__DB.prospect_logs.filter(l => l.prospect_id === 'pr-1' && l.kind === 'Mail' && /Programmation|proposition fictive|Mail reçu/.test(l.body || '')).map(l => ({ key: l.import_key || null, author: l.author })),
    files: window.__DB.prospect_files.filter(f => f.prospect_id === 'pr-1' && f.import_key).map(f => f.import_key) };
}, [eml(id)]);

test('B1 : synchronisation puis dépose du même mail → une seule ligne au journal (l’original .eml est gardé)', async ({ page }) => {
  const ctx = await openApp(page);
  // ligne écrite par la synchronisation (mail_journal) : auteur « Messagerie », clé msgid:<Message-ID>
  await page.evaluate(async id => { const { S, touch } = await import('./js/state.js');
    const l = { id: 'lg-sync', prospect_id: 'pr-1', date: '2026-11-03', kind: 'Mail', author: 'Messagerie', body: 'Mail reçu de prog@a.example — « Programmation fictive »', import_key: 'msgid:' + id };
    S.db.prospect_logs.push(l); window.__DB.prospect_logs.push({ ...l }); touch('prospect_logs'); }, ID);
  const r = await deposer(page, ID);
  expect(r.logs).toEqual([{ key: 'msgid:' + ID, author: 'Messagerie' }]);
  expect(r.files).toEqual(['msgid:' + ID]);
  expectClean(ctx);
});

test('B1 : dépose d’abord → clé exactement « msgid:<Message-ID> », celle que la synchronisation reconnaît', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await deposer(page, ID);
  expect(r.logs.map(l => l.key)).toEqual(['msgid:' + ID]);
  // même forme que la clé calculée par mail_journal à partir de l'en-tête Gmail (« msgid: » || rfc_message_id, chevrons compris)
  expect(r.logs[0].key).toBe(`msgid:${ID}`);
  expectClean(ctx);
});
