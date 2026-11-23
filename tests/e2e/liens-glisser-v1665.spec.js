// v1.66.5 — demande d'Anthony du 23/11/2026 (n°15 rouvert).
// 1. Suivi Lit et Mixe : depuis la LISTE d'Apple Mail, Safari n'a transmis que du texte (l'objet du mail, « Re: … »), ni fichier ni lien
//    « message: ». Le suivi propose alors de RETROUVER le mail dans la messagerie (recherche sur l'objet) : rien n'est rattaché sur le seul
//    objet, la personne choisit ; le mail choisi suit le chemin d'un lien glissé (mails déjà présents réutilisés, .eml ajouté s'il manque).
// 2. Liens : les mots cliquables d'un mail gardent leur adresse dans le texte du journal (« [mots](adresse) ») et restent cliquables ;
//    les adresses écrites en clair aussi. Textes déjà enregistrés : mis à jour seulement si le contenu, liens retirés, est identique.
// Données FICTIVES ; Gmail, stockage et boîtes simulés.
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

const textDrop = (page, text, types = ['text/plain', 'text/uri-list']) => page.evaluate(({ text, types }) => {
  const dt = new DataTransfer(); for (const t of types) dt.setData(t, text);
  document.querySelector('.log-attach [data-drop]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, { text, types });
/** Messagerie simulée : le message 1 de la conversation TEST, déjà au journal du suivi (comme les 8 mails de Lit et Mixe) */
async function messagerie(page){
  await page.evaluate(async ({ g, m }) => {
    const { S, touch } = await import('./js/state.js');
    const log = { id: 'lg-msg', prospect_id: 'pr-1', date: '2026-11-09', kind: 'Mail', author: 'Messagerie', gmail_message_id: g, import_key: 'msgid:' + m,
      body: 'Mail envoyé à correspondant@exemple-externe.org — « TEST conversation » Message 1', created_at: '2026-11-23T17:32:24Z' };
    const msgs = [{ id: 'mm-1', mailbox: 'anthony', gmail_message_id: g, rfc_message_id: m, subject: 'TEST conversation', direction: 'out', from_addr: 'anthony-fictif@example.com',
        to_addrs: ['correspondant@exemple-externe.org'], sent_at: '2026-11-09T08:00:00Z', prospect_log_id: 'lg-msg' },
      { id: 'mm-x', mailbox: 'anthony', gmail_message_id: 'autre', rfc_message_id: '<autre@example.com>', subject: 'Facture fictive', direction: 'in', from_addr: 'x@example.com', sent_at: '2026-11-10T08:00:00Z' }];
    window.__DB.prospect_logs.push({ ...log }); S.db.prospect_logs.push({ ...log }); touch('prospect_logs');
    window.__DB.mail_messages = msgs;
  }, { g: gid(1), m: mid(1) });
}

test('v1.66.5 Lit et Mixe : objet seul glissé depuis la liste d’Apple Mail → retrouver le mail ; rien sur l’objet seul ; mail déjà présent réutilisé', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1)] } }, main: { threads: {} } });
  await messagerie(page);
  const avant = await state(page);
  await textDrop(page, 'Re: TEST conversation');
  const dlg = page.locator('dialog.ask', { hasText: 'Retrouver un mail dans la messagerie' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('Safari n’a transmis que du texte');
  await expect(dlg.locator('#ask-input')).toHaveValue('TEST conversation');   // « Re: » retiré
  await expect(dlg.locator('.pick-row')).toHaveCount(1);                       // « Facture fictive » écarté
  await expect(dlg.locator('.pick-row')).toContainText('déjà dans ce suivi');
  expect(await dlg.locator('.pick-row input:checked').count()).toBe(0);         // aucune présélection
  // rien n'est fait sans choix explicite
  await dlg.getByRole('button', { name: 'Joindre ce mail' }).click();
  await expect(dlg.locator('.help.err')).toHaveText('Choisis une ligne.');
  expect(await page.evaluate(() => window.__google.length)).toBe(0);
  expect(await state(page)).toEqual(avant);
  // choix : le mail suit le chemin d'un lien glissé ; l'entrée existante est gardée, seul le .eml s'ajoute
  await dlg.locator('.pick-row').click();
  await dlg.getByRole('button', { name: 'Joindre ce mail' }).click();
  await expect(dlg).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__google.map(g => g.payload.message_id))).toContain(mid(1));
  await expect.poll(async () => (await state(page)).files.length).toBe(1);
  const s = await state(page);
  expect(s.logs).toEqual(avant.logs);                                          // entrée intacte, aucune nouvelle
  expect(s.files.map(f => f[1])).toEqual(['msgid:' + mid(1)]);
  expectClean(ctx);
});

test('v1.66.5 « Retrouver un mail » depuis le suivi ; Annuler ne fait rien ; texte seul hors suivi et lien de mail : inchangés', async ({ page }) => {
  const ctx = await openSuivi(page, { prospect: { threads: { tA: [meta(1)] } }, main: { threads: {} } });
  await messagerie(page);
  await page.locator('.log-attach [data-act="findMail"]').click();
  const dlg = page.locator('dialog.ask', { hasText: 'Retrouver un mail dans la messagerie' });
  await expect(dlg.locator('#ask-input')).toHaveValue('');
  await dlg.locator('#ask-input').fill('facture');
  await expect(dlg.locator('.pick-row')).toHaveCount(1);
  await expect(dlg.locator('.pick-row')).toContainText('Facture fictive');
  await dlg.getByRole('button', { name: 'Annuler' }).click();
  await expect(dlg).toHaveCount(0);
  expect(await page.evaluate(() => window.__google.length)).toBe(0);
  // lien web glissé (ni mail ni objet) : « Rien à joindre », aucune fenêtre
  await textDrop(page, 'https://exemple-fictif.fr/page', ['text/uri-list']);
  await expect(page.locator('.toast').last()).toContainText('Rien à joindre');
  expect(await page.locator('dialog.ask').count()).toBe(0);
  // lien « message: » glissé : toujours importé directement, sans fenêtre
  await drop(page, 1);
  await expect.poll(() => page.evaluate(() => window.__google.length)).toBeGreaterThan(0);
  expect(await page.locator('dialog.ask').count()).toBe(0);
  expectClean(ctx);
});

// ---------- 2. Liens ----------
const HTML = '<div>Voici la <a href="https://drive.google.com/fiche">fiche technique</a> et <a href="https://x.fr/a b(c)">la page (bis)</a>.<br>'
  + 'Écris à <a href="mailto:marie@salle-fictive.fr">marie@salle-fictive.fr</a> ou <a href="javascript:alert(1)">ici</a>.<br>'
  + 'Site : www.salle-fictive.fr. Contact : prog@salle-fictive.fr</div>';
test('v1.66.5 extraction : adresse des mots cliquables gardée ; sans elle, exactement le texte d’avant ; liens dangereux ignorés', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async html => {
    const { ownText, unlinked } = await import('./js/texte-mail.js');
    const t = ownText({ html });
    return { t, sans: unlinked(t) };
  }, HTML);
  expect(r.t).toContain('[fiche technique](https://drive.google.com/fiche)');
  expect(r.t).toContain('[la page (bis)](https://x.fr/a%20b%28c%29)');
  expect(r.t).toContain('Écris à marie@salle-fictive.fr ou ici.');           // adresse = mots du lien : inchangé ; javascript: ignoré
  expect(r.sans).toBe('Voici la fiche technique et la page (bis).\nÉcris à marie@salle-fictive.fr ou ici.\nSite : www.salle-fictive.fr. Contact : prog@salle-fictive.fr');
  // (essai sur les vrais mails, 23/11) l'adresse d'un lien ne change jamais ce qui est reconnu comme citation : « De : [Paul](mailto:…) »
  // n'est pas un en-tête Outlook (pas d'adresse dans les mots), « Le [rendez-vous](https://…2026…) a écrit : » pas une attribution
  const r2 = await page.evaluate(async () => {
    const { ownText, unlinked } = await import('./js/texte-mail.js');
    const a = ownText({ html: '<p>Programme</p><p>De : <a href="mailto:paul@x.fr">Paul</a><br>Envoyé : lundi<br>À : Lyon<br>Objet : tournée</p><p>Suite gardée</p>' });
    const b = ownText({ html: '<p>Le <a href="https://x.fr/2026">rendez-vous</a> a écrit :</p><p>&gt; ligne</p>' });
    return [unlinked(a), unlinked(b)];
  });
  expect(r2[0]).toContain('Suite gardée');
  expect(r2[1]).toContain('rendez-vous a écrit');
  expectClean(ctx);
});

const bin = s => Buffer.from(s, 'utf8').toString('latin1');
const EML = (html, id = 'lien-1') => bin(`From: Marie Prog <marie@salle-fictive.fr>\r\nTo: anthony-fictif@example.com\r\nSubject: Fiche\r\nDate: Mon, 16 Nov 2026 10:00:00 +0100\r\nMessage-ID: <${id}@salle-fictive.fr>\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n`);
test('v1.66.5 journal : mots cliquables et adresses en clair ouvrent leur lien (autre onglet) ; texte affiché identique', async ({ page }) => {
  const ctx = await openApp(page);
  await page.evaluate(async ({ html, eml }) => {
    const { S, touch } = await import('./js/state.js'); const { ownText } = await import('./js/texte-mail.js');
    const log = { id: 'lg-l', prospect_id: 'pr-1', date: '2026-11-16', kind: 'Mail', author: 'anthony-fictif@example.com', import_key: 'msgid:<lien-1@salle-fictive.fr>',
      body: 'Reçu — **Fiche**\n\nVoici la fiche technique', mail_text: ownText({ html }), created_at: '2026-11-16T09:00:00Z' };
    const f = { id: 'pf-l', prospect_id: 'pr-1', name: 'Fiche.eml', path: 'pr-1/fiche.eml', import_key: 'msgid:<lien-1@salle-fictive.fr>', created_at: '2026-11-16T09:00:00Z' };
    for (const db of [S.db, window.__DB]){ db.prospect_logs.push({ ...log }); db.prospect_files.push({ ...f }); }
    touch('prospect_logs'); touch('prospect_files');
    const app = await import('./js/app.js'); app.go('prospects'); S.suiviPage = 'pr-1'; app.render();
  }, { html: HTML, eml: EML(HTML) });
  const txt = page.locator('.mail-text').first();
  await expect(txt).toBeVisible();
  const a = await txt.locator('a').evaluateAll(as => as.map(x => [x.textContent, x.getAttribute('href'), x.target, x.rel]));
  expect(a).toEqual([
    ['fiche technique', 'https://drive.google.com/fiche', '_blank', 'noopener noreferrer'],
    ['la page (bis)', 'https://x.fr/a%20b%28c%29', '_blank', 'noopener noreferrer'],
    ['marie@salle-fictive.fr', 'mailto:marie@salle-fictive.fr', '_blank', 'noopener noreferrer'],
    ['www.salle-fictive.fr', 'https://www.salle-fictive.fr', '_blank', 'noopener noreferrer'],
    ['prog@salle-fictive.fr', 'mailto:prog@salle-fictive.fr', '_blank', 'noopener noreferrer'],
  ]);
  expect(await txt.innerText()).toBe('Voici la fiche technique et la page (bis).\nÉcris à marie@salle-fictive.fr ou ici.\nSite : www.salle-fictive.fr. Contact : prog@salle-fictive.fr');
  // aucune note fantôme : l'extrait automatique (body) reste reconnu malgré les adresses
  await expect(page.locator('.log-note')).toHaveCount(0);
  // texte piégé : aucune balise, aucun lien hors web / mail / téléphone
  const piege = await page.evaluate(async () => (await import('./js/textes-journal.js')).mailTextHtml('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://ok.fr/"onmouseover=) <https://a.fr/?q=1&r=2>'));
  expect(piege).not.toContain('<img');
  expect(piege).not.toContain('href="javascript');
  expect(piege).toContain('&lt;<a href="https://a.fr/?q=1&amp;r=2" target="_blank" rel="noopener noreferrer">https://a.fr/?q=1&amp;r=2</a>&gt;');
  expectClean(ctx);
});

test('v1.66.5 textes déjà enregistrés : essai à blanc sans écriture, puis mise à jour des seuls textes identiques (importés et boîte privée)', async ({ page }) => {
  const ctx = await openApp(page);
  const OLD = 'Voici la fiche technique et la page (bis).\nÉcris à marie@salle-fictive.fr ou ici.\nSite : www.salle-fictive.fr. Contact : prog@salle-fictive.fr';
  await page.evaluate(async ({ html, eml, eml2, OLD }) => {
    const { S, touch } = await import('./js/state.js');
    const L = (id, extra) => ({ id, prospect_id: 'pr-1', date: '2026-11-16', kind: 'Mail', author: 'anthony-fictif@example.com', body: 'Reçu — **Fiche**', created_at: '2026-11-16T09:00:00Z', ...extra });
    const logs = [L('lg-ok', { import_key: 'msgid:<lien-1@salle-fictive.fr>', mail_text: OLD }),          // récupérable
      L('lg-diff', { import_key: 'msgid:<lien-2@salle-fictive.fr>', mail_text: 'Texte enregistré différent' }),   // .eml différent : laissé
      L('lg-nofile', { import_key: 'msgid:<lien-3@salle-fictive.fr>', mail_text: OLD }),                   // source indisponible
      L('lg-priv', { author: 'Messagerie', gmail_message_id: 'g-priv', import_key: 'msgid:<priv@x>' })];   // boîte privée
    const files = [{ id: 'pf-1', prospect_id: 'pr-1', name: 'a.eml', path: 'pr-1/a.eml', import_key: 'msgid:<lien-1@salle-fictive.fr>' },
      { id: 'pf-2', prospect_id: 'pr-1', name: 'b.eml', path: 'pr-1/b.eml', import_key: 'msgid:<lien-2@salle-fictive.fr>' }];
    for (const db of [S.db, window.__DB]){
      db.prospect_logs.push(...JSON.parse(JSON.stringify(logs))); db.prospect_files.push(...JSON.parse(JSON.stringify(files)));
      db.mail_threads = [{ id: 'mt-1', mailbox: 'anthony', gmail_thread_id: 'thr1', subject: 'Fiche', labels: ['INBOX'], prospect_id: 'pr-1' }];
      db.mail_messages = [{ id: 'mm-p', mailbox: 'anthony', thread_id: 'mt-1', gmail_message_id: 'g-priv', prospect_log_id: 'lg-priv' }];
      db.settings.push({ key: 'prospect_script_url', value: 'https://script.google.com/macros/s/FICTIF/exec' });
    }
    window.__DB.mail_textes = [{ message_id: 'mm-p', body_text: OLD }];
    ['prospect_logs', 'prospect_files', 'mail_threads', 'settings'].forEach(touch);
    window.__STORED = { 'suivi/pr-1/a.eml': eml, 'suivi/pr-1/b.eml': eml2 }; window.__MAILBOX_OWNER = true;
    window.__FN_REPLY = { 'script-google': b => b.action === 'thread' ? { ok: true, thread: { id: 'thr1', messages: [{ id: 'g-priv', html, subject: 'Fiche' }] } } : { ok: true } };
    const app = await import('./js/app.js'); app.go('mails'); app.render();
  }, { html: HTML, eml: EML(HTML), eml2: EML('<div>Un tout autre <a href="https://y.fr">texte</a></div>', 'lien-2'), OLD });
  const snap = () => page.evaluate(() => ({ logs: JSON.stringify(window.__DB.prospect_logs.map(l => [l.id, l.body, l.mail_text, l.hidden])), files: window.__DB.prospect_files.length, priv: window.__DB.mail_textes[0].body_text }));
  const avant = await snap();
  // essai à blanc : bilan, aucune écriture
  await page.locator('[data-act="mailLinks"]').click();
  await page.locator('dialog.ask').getByRole('button', { name: 'Essai à blanc' }).click();
  const bilan = page.locator('dialog.ask', { hasText: 'essai à blanc' });
  await expect(bilan).toContainText('2 récupérables · 0 sans lien · 1 source indisponible · 1 contenu différent');
  expect(await snap()).toEqual(avant);
  expect(await page.evaluate(() => window.__calls.filter(c => /^mail_texte_liens/.test(c.rpc || '')).length)).toBe(0);
  await bilan.getByRole('button', { name: 'Fermer' }).click();
  // mise à jour : seuls les deux textes identiques reçoivent leurs adresses ; le reste est intact
  await page.locator('[data-act="mailLinks"]').click();
  await page.locator('dialog.ask').getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(page.locator('dialog.ask', { hasText: 'mise à jour faite' })).toContainText('2 récupérables (2 mis à jour)');
  const apres = await page.evaluate(() => Object.fromEntries(window.__DB.prospect_logs.map(l => [l.id, [l.body, l.mail_text]])));
  expect(apres['lg-ok'][1]).toContain('[fiche technique](https://drive.google.com/fiche)');
  expect(apres['lg-ok'][0]).toBe('Reçu — **Fiche**');
  expect(apres['lg-diff'][1]).toBe('Texte enregistré différent');
  expect(apres['lg-nofile'][1]).toBe(OLD);
  const priv = await page.evaluate(() => window.__DB.mail_textes[0].body_text);
  expect(priv).toContain('[fiche technique](https://drive.google.com/fiche)');
  expect(await page.evaluate(() => window.__DB.prospect_logs.find(l => l.id === 'lg-priv').mail_text)).toBeUndefined();   // privé : jamais recopié au journal
  expect(await page.evaluate(() => window.__DB.prospect_files.length)).toBe(avant.files);
  // la base refuse un texte dont le contenu changerait
  const refus = await page.evaluate(async () => (await (await import('./js/data.js')).sb.rpc('mail_texte_liens', { p_log: 'lg-diff', p_old: 'Texte enregistré différent', p_new: 'Autre [texte](https://y.fr)' })).error?.code);
  expect(refus).toBe('22023');
  expectClean(ctx);
});
