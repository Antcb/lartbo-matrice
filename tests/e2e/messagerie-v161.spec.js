// v1.61 : messagerie intégrée (boîte anthony@) — données et réponses Gmail FICTIVES (script et synchronisation simulés).
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

const THREADS = [
  { id: 'mt-a', mailbox: 'anthony', gmail_thread_id: 'aaa111', subject: 'Disponibilités printemps', snippet: 'Bonjour, avez-vous…', participants: ['inconnu@example.org'],
    last_message_at: '2026-11-05T10:00:00Z', message_count: 1, unread: true, labels: ['INBOX', 'UNREAD'], link_status: 'a_rattacher', link_reason: 'Aucun contact connu parmi les participants' },
  { id: 'mt-b', mailbox: 'anthony', gmail_thread_id: 'bbb222', subject: 'Re: Proposition Artiste Alpha', snippet: 'Merci pour votre mail', participants: ['camille@example.com'],
    last_message_at: '2026-11-04T09:00:00Z', message_count: 2, unread: false, labels: ['INBOX', 'Label_7'], structure_id: 'st-1', link_status: 'auto', link_reason: 'Contact Camille Exemple' },
];
const MSG = { id: 'm-2', thread_id: 'bbb222', from: { name: 'Camille Exemple', email: 'camille@example.com' }, reply_to: [{ email: 'prog@example.com', name: '' }],
  to: [{ email: 'anthony@lartboristerie.com' }], cc: [{ email: 'collegue@example.org' }], subject: 'Re: Proposition Artiste Alpha', date: '2026-11-04T09:00:00Z',
  snippet: 'Merci', direction: 'in', attachments: [{ name: 'fiche.pdf', size: 120000, mime: 'application/pdf', id: 'att-1' }],
  html: '<p>Merci pour votre mail</p><script>window.parent.__pirate = 1</script><img src="x" onerror="window.parent.__pirate = 2">' };

async function preparer(page, { sent = true } = {}) {
  await page.evaluate(async ([threads, msg, sent]) => {
    const { S, touch } = await import('./js/state.js');
    for (const db of [S.db, window.__DB]) {
      db.mail_threads = JSON.parse(JSON.stringify(threads));
      db.mail_sync_state = [{ mailbox: 'anthony', last_run_at: '2026-11-06T10:05:00Z', last_ok_at: '2026-11-06T10:00:00Z', last_error: 'Le script de prospection met plus de 2 minutes' }];
      db.settings.push({ key: 'prospect_script_url', value: 'https://script.google.com/macros/s/FICTIF/exec' }, { key: 'prospect_from', value: 'anthony@lartboristerie.com' });
    }
    touch('mail_threads'); touch('mail_sync_state'); touch('settings');
    window.__script = [];
    window.__FN_REPLY = {
      'script-google': b => { window.__script.push(b); const a = b.action;
        if (a === 'labels') return { ok: true, labels: [{ id: 'Label_7', name: 'Booking 2027', type: 'user' }] };
        if (a === 'thread') return { ok: true, thread: { id: 'bbb222', subject: msg.subject, messages: [msg] } };
        if (a === 'modify') return { ok: true, labels: ['INBOX'] };
        if (a === 'compose') return b.payload.send ? (sent ? { ok: true, sent: true, thread_id: 'bbb222', message_id: 'm-3' } : { ok: true, sent: false }) : { ok: true, draft_id: 'd-1' };
        return { ok: true }; },
      'mail-sync': () => ({ ok: true, threads: 1, journal: 1, remaining: 0 }),
    };
    const app = await import('./js/app.js'); app.go('mails'); app.render();
  }, [THREADS, MSG, sent]);
}
const actions = page => page.evaluate(() => window.__script.map(b => b.action + (b.payload?.send ? ':envoi' : '')));
const syncs = page => page.evaluate(() => window.__calls.filter(c => c.fn === 'mail-sync').map(c => c.body));

test('v1.61 : liste, dernière synchronisation et erreur visibles, « À rattacher », libellés Gmail', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await expect(page.locator('main')).toContainText('Dernière synchronisation réussie : 06/11/2026');
  await expect(page.locator('main .mail-err')).toContainText('plus de 2 minutes');
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await page.locator('[data-act=mailFilter][data-f=link]').click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await expect(page.locator('.mail-row')).toContainText('Disponibilités printemps');
  await page.locator('[data-act=mailFilter][data-f=inbox]').click();
  await expect(page.locator('.mail-row').nth(1)).toContainText('Booking 2027');   // libellé Gmail affiché par son nom
  await page.locator('[data-act=mailRefresh]').click();
  await expect.poll(() => syncs(page)).toEqual([{ mode: 'sync' }]);   // actualisation manuelle par la fonction serveur
  expectClean(ctx);
});

test('v1.61 : lecture isolée (aucun script du mail exécuté), réponse dans le fil, modèle inséré sans rien remplacer, journal après confirmation', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.locator('.mail-row', { hasText: 'Proposition' }).click();
  await expect(page.locator('iframe.mail-frame')).toHaveAttribute('sandbox', '');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pirate || 0)).toBe(0);
  await expect(page.locator('.mail-msg')).toContainText('fiche.pdf');
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply_all]').first().click();
  // répondre à tous : adresse de réponse + copies, jamais la boîte elle-même
  await expect(page.locator('#mc-to')).toHaveValue('prog@example.com');
  await expect(page.locator('#mc-cc')).toHaveValue('collegue@example.org');
  await expect(page.locator('#mc-subj')).toHaveValue('Re: Proposition Artiste Alpha');
  await page.locator('#mc-body').evaluate(el => { el.innerHTML = '<p>Mon texte déjà écrit</p>'; el.dispatchEvent(new Event('input')); });
  await page.locator('#mc-tpl').selectOption('mt-1');
  await page.locator('#mc-ins').click();
  await expect(page.locator('#mc-body')).toContainText('Mon texte déjà écrit');
  await expect(page.locator('#mc-body')).toContainText('Bonjour');
  await expect(page.locator('#mc-to')).toHaveValue('prog@example.com');   // destinataires inchangés
  await page.locator('#modal button[type=submit]').click();
  await page.locator('dialog[open] button', { hasText: 'Envoyer le mail' }).click();
  await expect.poll(() => syncs(page)).toContainEqual({ mode: 'threads', ids: ['bbb222'] });
  const compose = await page.evaluate(() => window.__script.find(b => b.action === 'compose').payload);
  expect(compose).toMatchObject({ mode: 'reply_all', thread_id: 'bbb222', to: 'prog@example.com', cc: 'collegue@example.org', send: true });
  expect(await actions(page)).toEqual(['labels', 'thread', 'compose:envoi']);   // lecture d'une conversation déjà lue : pas de « modify »
  expectClean(ctx);
});

test('v1.61 : envoi non confirmé par Gmail → rien au journal, la fenêtre reste ouverte', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page, { sent: false });
  await page.locator('.mail-row', { hasText: 'Proposition' }).click();
  await page.locator('.mail-actions [data-act=mailCompose][data-mode=reply]').first().click();
  await page.locator('#modal button[type=submit]').click();
  await page.locator('dialog[open] button', { hasText: 'Envoyer le mail' }).click();
  await expect(page.locator('#toast, .toast').last()).toContainText('n’a pas confirmé');
  expect(await syncs(page)).toEqual([]);
  await expect(page.locator('#modal')).toBeVisible();
  expectClean(ctx);
});

test('v1.61 : ouvrir une conversation non lue la marque lue dans Gmail ; corbeille seulement après confirmation', async ({ page }) => {
  const ctx = await openApp(page);
  await preparer(page);
  await page.locator('.mail-row', { hasText: 'Disponibilités' }).click();
  await expect.poll(() => actions(page)).toContain('modify');
  expect(await page.evaluate(() => window.__script.find(b => b.action === 'modify').payload)).toMatchObject({ thread_id: 'aaa111', read: true });
  await page.locator('[data-act=mailTrash]').click();
  await page.locator('dialog[open] button', { hasText: 'Annuler' }).click();
  expect(await page.evaluate(() => window.__script.filter(b => b.payload?.trash).length)).toBe(0);
  expectClean(ctx);
});
