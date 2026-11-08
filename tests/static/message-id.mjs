// v1.60.4 — message glissé depuis Apple Mail sans fichier : seul le lien « message:%3C<Message-ID>%3E » arrive dans le navigateur.
// Contrôles sans navigateur (aucun service réel, données fictives) :
//  1. lecture du Message-ID dans les vrais formats de lien d'Apple Mail (js/eml.js mailLinkIds) et refus des identifiants invalides ;
//  2. même expression de contrôle, même longueur maximale et même taille maximale dans js/eml.js, apps-script/Code.gs et
//     apps-script/Prospection.gs ; fonction mailByMsgId_ identique au caractère près dans les deux scripts ;
//  3. l'action « mail_by_msgid » n'appelle QUE des méthodes de lecture (lecture du code, puis exécution réelle des deux scripts avec
//     des services Google simulés qui relèvent tout autre appel) : une seule recherche « rfc822msgid: », correspondance exacte de
//     l'en-tête, brouillons exclus, plusieurs correspondances refusées, taille bornée, identifiant invalide refusé sans recherche,
//     code secret exigé.
import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const problems = [];
const fail = (cat, msg) => problems.push(`[${cat}] ${msg}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (cat, label, got, want) => { if (!same(got, want)) fail(cat, `${label} : obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)}`); };

// 1. Lecture du lien (formats réels d'Apple Mail : Message-ID RFC 822 encodé entre %3C et %3E)
const { mailLinkIds, msgIdOk, msgIdDomain, MSGID_RE, MSGID_MAX, MSG_RAW_MAX } = await import(join(ROOT, 'js/eml.js'));
const ID1 = '<9F1C2E3A-1B2C-4D5E-8F90-ABCDEF012345@exemple-fictif.fr>';
const ID2 = '<CAJ+fictif=XyZ_0123.abc$def@mail.exemple.com>';
const ID3 = "<0102018f.fictif-000000@eu-west-1.exemple.net>";
const enc = id => 'message:%3C' + encodeURIComponent(id.slice(1, -1)) + '%3E';
const cases = [
  ['lien Apple Mail encodé', ['message:%3C9F1C2E3A-1B2C-4D5E-8F90-ABCDEF012345@exemple-fictif.fr%3E'], [ID1]],
  ['variante message://', ['message://%3C9F1C2E3A-1B2C-4D5E-8F90-ABCDEF012345@exemple-fictif.fr%3E'], [ID1]],
  ['@ et + encodés (%40, %2B)', [enc(ID2)], [ID2]],
  ['caractères de Gmail non encodés', ['message:%3CCAJ+fictif=XyZ_0123.abc$def@mail.exemple.com%3E'], [ID2]],
  ['chevrons en clair', ['message:<0102018f.fictif-000000@eu-west-1.exemple.net>'], [ID3]],
  ['majuscules (MESSAGE:, %3c)', ['MESSAGE:%3c9F1C2E3A-1B2C-4D5E-8F90-ABCDEF012345@exemple-fictif.fr%3e'], [ID1]],
  ['plusieurs liens (liste d\'adresses avec commentaire)', ['# glissé depuis Mail\r\n' + enc(ID1) + '\r\n' + enc(ID2) + '\r\n'], [ID1, ID2]],
  ['lien dans le texte (text/plain)', ['', 'Objet fictif ' + enc(ID3) + ' fin'], [ID3]],
  ['même message dans la liste et le texte : une seule fois', [enc(ID1), enc(ID1)], [ID1]],
  ['texte sans lien', ['Programmation fictive'], []],
  ['espace dans l\'identifiant (%20)', ['message:%3Cabc%20def@exemple.fr%3E'], []],
  ['sans @', ['message:%3Cabcdef.exemple.fr%3E'], []],
  ['deux @', ['message:%3Ca@b@exemple.fr%3E'], []],
  ['caractère de contrôle (%00, %0A)', ['message:%3Cab%00c@exemple.fr%3E', 'message:%3Cab%0Ac@exemple.fr%3E'], []],
  ['guillemet, parenthèse, accolade, barre, virgule', ['message:%3Ca%22b@x.fr%3E', 'message:%3Ca(b)@x.fr%3E', 'message:%3Ca%7Bb@x.fr%3E', 'message:%3Ca%7Cb@x.fr%3E', 'message:%3Ca,b@x.fr%3E'], []],
  ['recherche Gmail glissée dans l\'identifiant', ['message:%3Cx@y.fr%20OR%20from:moi%3E'], []],
  ['chevron en trop', ['message:%3C%3Cabc@exemple.fr%3E'], []],
  ['vide', ['message:%3C%3E', 'message:%3C@%3E'], []],
  ['trop long (plus de 250 caractères)', ['message:%3C' + 'a'.repeat(200) + '@' + 'b'.repeat(60) + '%3E'], []],
  ['encodage incomplet', ['message:%3Cab%E0%A4c@exemple.fr%3E'], []],
  ['autre schéma', ['mailto:abc@exemple.fr', 'https://exemple.fr/%3Cabc@exemple.fr%3E'], []],
];
for (const [label, texts, want] of cases) eq('lecture du lien', label, mailLinkIds(...texts), want);
eq('lecture du lien', 'identifiant de 250 caractères accepté', msgIdOk('<' + 'a'.repeat(200) + '@' + 'b'.repeat(47) + '>'), true);
eq('lecture du lien', 'identifiant de 251 caractères refusé', msgIdOk('<' + 'a'.repeat(200) + '@' + 'b'.repeat(48) + '>'), false);
eq('lecture du lien', 'identifiant non texte refusé', [msgIdOk(null), msgIdOk(42), msgIdOk({})], [false, false, false]);
eq('diagnostic', 'domaine seulement', [msgIdDomain(ID1), msgIdDomain(ID2)], ['exemple-fictif.fr', 'mail.exemple.com']);

// 1b. Lecture d'un .eml (même lecture pour un fichier déposé et un message retrouvé) : participants, Message-ID, pièces jointes
{
  const { parseEml } = await import(join(ROOT, 'js/eml.js'));
  const raw = ['From: =?UTF-8?Q?Cam=C3=A9lia?= <c@exemple.fr>', 'To: a@exemple.fr, b@exemple.fr', 'Cc: d@exemple.fr', 'Subject: Test fictif', `Message-ID: ${ID1}`,
    'Content-Type: multipart/mixed; boundary="XX"', '', '--XX', 'Content-Type: multipart/alternative; boundary="YY"', '', '--YY', 'Content-Type: text/plain; charset=utf-8', '', 'Bonjour', '--YY--',
    '--XX', 'Content-Type: application/pdf; name="devis.pdf"', "Content-Disposition: attachment; filename*=UTF-8''d%C3%A9vis%20fictif.pdf", 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQK',
    '--XX', 'Content-Type: application/vnd.ms-excel', 'Content-Disposition: attachment;', ' filename*0*=UTF-8\'\'tableau%20; filename*1="long.xls"', '', 'xls',
    '--XX', 'Content-Type: image/png', 'Content-Disposition: inline; filename=logo.png', 'Content-ID: <logo>', 'Content-Transfer-Encoding: base64', '', 'iVBORw==',
    '--XX', 'Content-Type: message/rfc822', '', 'Subject: joint', '', 'x', '--XX--', ''].join('\r\n');
  const m = parseEml(raw);
  eq('lecture du .eml', 'participants', [m.fromLine, m.toLine, m.ccLine], ['Camélia <c@exemple.fr>', 'a@exemple.fr, b@exemple.fr', 'd@exemple.fr']);
  eq('lecture du .eml', 'Message-ID et texte', [m.messageId, m.text], [ID1, 'Bonjour']);
  eq('lecture du .eml', 'pièces jointes (logo de signature exclu)', m.attachments.map(a => [a.name, a.type]),
    [['dévis fictif.pdf', 'application/pdf'], ['tableau long.xls', 'application/vnd.ms-excel'], ['mail joint.eml', 'message/rfc822']]);
  eq('lecture du .eml', 'contenu de la pièce décodé', new TextDecoder().decode(m.attachments[0].bytes), '%PDF-1.4\n');
}

// 1c. Relecture v1.60.4 : lecture des liens en temps linéaire, même sur 500 Ko piégés (lue à chaque dépôt, dans toutes les zones)
for (const [label, t] of [['« message:< » répété', 'message:<'.repeat(57000)], ['« message:%3C » répété', 'message:%3C'.repeat(46000)],
  ['« message:%3Ca » répété', 'message:%3Ca'.repeat(42000)], ['identifiants trop longs sans fin', ('message:%3C' + 'a'.repeat(800)).repeat(600)]]){
  // médiane de 5 mesures (une machine de CI chargée ne fait pas échouer le contrôle sur un seul passage lent)
  let r = []; const runs = [];
  for (let i = 0; i < 5; i++){ const t0 = performance.now(); r = mailLinkIds(t, t); runs.push(performance.now() - t0); }
  const ms = runs.sort((a, b) => a - b)[2];
  if (ms >= 100) fail('lecture du lien', `${label} (${Math.round(t.length / 1024)} Ko) : médiane ${Math.round(ms)} ms (100 ms au plus)`);
  if (r.length) fail('lecture du lien', `${label} : aucun identifiant attendu`);
}

// 1d. Pièces non extraites comptées (au-delà de 20, ou imbriquées trop profondément) : jamais perdues en silence
{
  const { parseEml } = await import(join(ROOT, 'js/eml.js'));
  const part = i => ['--B', `Content-Type: application/pdf; name="p${i}.pdf"`, 'Content-Disposition: attachment', 'Content-Transfer-Encoding: base64', '', 'JVBERg=='];
  const many = ['Subject: x', 'Content-Type: multipart/mixed; boundary="B"', '', '--B', 'Content-Type: text/plain', '', 'Texte',
    ...Array.from({ length: 22 }, (_, i) => part(i + 1)).flat(), '--B--', ''].join('\r\n');
  const m = parseEml(many);
  eq('lecture du .eml', '22 pièces : 20 extraites, 2 annoncées', [m.attachments.length, m.attachmentsSkipped, m.attachments[19].name], [20, 2, 'p20.pdf']);
  let deep = ['Content-Type: application/pdf; name="profond.pdf"', 'Content-Disposition: attachment', '', 'x'].join('\r\n');
  for (let d = 8; d >= 1; d--) deep = [`Content-Type: multipart/mixed; boundary="N${d}"`, '', `--N${d}`, deep, `--N${d}--`, ''].join('\r\n');
  const md = parseEml('Subject: y\r\n' + deep);
  eq('lecture du .eml', 'pièce trop imbriquée annoncée', [md.attachments.length, md.attachmentsSkipped], [0, 1]);
}

// 2. Même règle des deux côtés (CONVENTIONS.md §8.4)
const gsCode = readFileSync(join(ROOT, 'apps-script/Code.gs'), 'utf8');
const gsProsp = readFileSync(join(ROOT, 'apps-script/Prospection.gs'), 'utf8');
const block = (src, name) => { const a = src.indexOf('// ─────────────── Message retrouvé par son Message-ID'), z = src.indexOf('// ─────────────── fin : Message-ID ───────────────');
  if (a < 0 || z < a) { fail('scripts', `${name} : bloc mailByMsgId_ introuvable`); return ''; } return src.slice(a, z); };
const bCode = block(gsCode, 'Code.gs'), bProsp = block(gsProsp, 'Prospection.gs');
if (bCode !== bProsp) fail('scripts', 'mailByMsgId_ diffère entre Code.gs et Prospection.gs (doit être identique au caractère près)');
const gsRe = (bCode.match(/var MSGID_RE_ = (\/.+\/);/) || [])[1];
if (gsRe !== String(MSGID_RE)) fail('scripts', `expression du Message-ID différente : eml.js ${MSGID_RE} / scripts ${gsRe}`);
if (!new RegExp(`var MSGID_MAX_ = ${MSGID_MAX};`).test(bCode)) fail('scripts', 'longueur maximale du Message-ID différente entre eml.js et les scripts');
if (MSG_RAW_MAX !== 20 * 1024 * 1024 || !/var MSG_RAW_MAX_ = 20 \* 1024 \* 1024;/.test(bCode)) fail('scripts', 'taille maximale du contenu brut différente entre eml.js et les scripts');
if (!/action === 'mail_by_msgid'\) out = mailByMsgId_\(body\.message_id\)/.test(gsCode)) fail('scripts', 'Code.gs : action mail_by_msgid non branchée dans doPost');
// (v1.63) Prospection.gs : toutes les actions de boîte, dont mail_by_msgid, passent par ownerOnly_ AVANT d'être exécutées (BOITE_)
if (!/a === 'mail_by_msgid'\) out = mailByMsgId_\(body\.message_id\)/.test(gsProsp) || !/var refus = BOITE_\[a\] \? ownerOnly_\(body, a\) : null;\s*if \(refus\) out = refus;/.test(gsProsp)
  || !/var BOITE_ = \{[^}]*mail_by_msgid: 1/.test(gsProsp)) fail('scripts', 'Prospection.gs : action mail_by_msgid non branchée dans doPost ou non réservée au titulaire');
// version du code renvoyée par « ping » : celle de la dernière modification de CHAQUE script (Prospection.gs : messagerie v1.61.0)
for (const [n, src, v] of [['Code.gs', gsCode, '1.60.4'], ['Prospection.gs', gsProsp, '1.61.0']])
  if (!new RegExp(`var SCRIPT_VERSION = 'v${v.replace(/\./g, '\\.')}'`).test(src)) fail('scripts', `${n} : SCRIPT_VERSION doit être 'v${v}'`);

// 3a. Lecture du code : seulement des méthodes de lecture (Gmail) et des opérations sur du texte
const READ_ONLY = new Set(['search', 'forEach', 'getMessages', 'getHeader', 'trim', 'isDraft', 'push', 'test', 'slice', 'getRawContent', 'round', 'getSubject', 'getFrom', 'getDate', 'toISOString']);
const fn = bCode.slice(bCode.indexOf('function mailByMsgId_'));
const called = [...fn.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
const extra = [...new Set(called.filter(m => !READ_ONLY.has(m)))];
if (extra.length) fail('lecture seule', `mailByMsgId_ appelle des méthodes hors liste de lecture : ${extra.join(', ')}`);
if (/markRead|markUnread|addLabel|removeLabel|moveTo|star|trash|delete|modify|send|reply|forward|createDraft|Drafts|Users\.Messages|UrlFetchApp|DriveApp|PropertiesService|sb_\(/i.test(fn)) fail('lecture seule', 'mailByMsgId_ contient une écriture ou un accès à un autre service');
if ((fn.match(/GmailApp\.search\(/g) || []).length !== 1 || !/GmailApp\.search\('rfc822msgid:' \+ id\.slice\(1, -1\), 0, 10\)/.test(fn)) fail('lecture seule', 'mailByMsgId_ : une seule recherche « rfc822msgid: » + identifiant validé attendue');

// 3b. Exécution réelle des deux scripts, services Google simulés : tout appel hors lecture est relevé
const RAW = ['From: Camille Exemple <camille@example.com>', 'To: testeur@example.com', 'Subject: Programmation fictive', `Message-ID: ${ID1}`,
  'Date: Tue, 03 Nov 2026 10:00:00 +0100', 'Content-Type: text/plain; charset=utf-8', '', 'Bonjour, proposition fictive.', ''].join('\r\n');
const MSG_OK = new Set(['getHeader', 'isDraft', 'getRawContent', 'getSubject', 'getFrom', 'getDate']);
function run(file, msgs, call){
  const log = { searches: [], forbidden: [] };
  const guard = (obj, allowed, what) => new Proxy(obj, { get(t, k) { if (typeof k === 'symbol' || k === 'then') return t[k];
    if (!allowed.has(k)) { log.forbidden.push(`${what}.${k}`); return () => { throw new Error(`appel interdit ${what}.${k}`); }; } return t[k]; } });
  const message = o => guard({ getHeader: h => /^message-id$/i.test(h) ? o.header : '', isDraft: () => !!o.draft, getRawContent: () => o.raw ?? RAW,
    getSubject: () => 'Programmation fictive', getFrom: () => 'Camille Exemple <camille@example.com>', getDate: () => new Date('2026-11-03T09:00:00Z') }, MSG_OK, 'message');
  const GmailApp = guard({ search: (q, a, b) => { log.searches.push([q, a, b]); return [guard({ getMessages: () => msgs.map(message) }, new Set(['getMessages']), 'fil')]; } }, new Set(['search']), 'GmailApp');
  const props = { WEBHOOK_SECRET: 'secret-de-test', CLE_BOITE: 'cle-boite-de-test' };
  const cache = {};
  const ctx = { GmailApp, Logger: { log() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => 'boite@example.com' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], getProperties: () => props }) },
    ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: () => '', Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v).digest()].map(b => (b > 127 ? b - 256 : b)) } };
  vm.createContext(ctx); vm.runInContext(file, ctx);
  const out = call(ctx);
  return { out: typeof out === 'string' ? JSON.parse(out) : JSON.parse(JSON.stringify(out)), ...log };
}
// identité du titulaire de la boîte (compte qui exécute le script), signée comme par le relais script-google (v1.60.4)
// (relecture B1 : clé dédiée CLE_BOITE, signature sur adresse, action, Message-ID et horodatage)
const owner = body => { const ts = Date.now(), mid = typeof body.message_id === 'string' ? body.message_id : '';
  return { caller: 'boite@example.com', caller_ts: ts, caller_sig: createHmac('sha256', 'cle-boite-de-test').update(['matrice-boite-v2', 'prospect', 'anthony', 'boite@example.com', body.action, mid, String(ts)].join('|')).digest('hex') }; };
const post = body => ctx => ctx.doPost({ postData: { contents: JSON.stringify({ ...owner(body), ...body }) } });
for (const [name, file] of [['Code.gs', gsCode], ['Prospection.gs', gsProsp]]){
  const cat = `lecture seule ${name}`;
  try {
    // trouvé : une seule recherche, exactement la requête attendue, contenu brut renvoyé
    let r = run(file, [{ header: ID1 }], post({ secret: 'secret-de-test', action: 'mail_by_msgid', message_id: ID1 }));
    eq(cat, 'trouvé : recherche', r.searches, [['rfc822msgid:' + ID1.slice(1, -1), 0, 10]]);
    eq(cat, 'trouvé : réponse', { ok: r.out.ok, found: r.out.found, id: r.out.message?.message_id, raw: r.out.message?.raw === RAW, date: r.out.message?.date, keys: Object.keys(r.out.message || {}).sort() },
      { ok: true, found: true, id: ID1, raw: true, date: '2026-11-03T09:00:00.000Z', keys: ['date', 'from', 'message_id', 'raw', 'size', 'subject'] });
    eq(cat, 'trouvé : aucun appel hors lecture', r.forbidden, []);
    // l'en-tête doit être IDENTIQUE (un message voisin renvoyé par la recherche n'est jamais pris)
    r = run(file, [{ header: '<autre-fictif@exemple-fictif.fr>' }, { header: ID1.toLowerCase() }], ctx => ctx.mailByMsgId_(ID1));
    eq(cat, 'en-tête différent', r.out, { ok: true, found: false });
    r = run(file, [{ header: ID1, draft: true }], ctx => ctx.mailByMsgId_(ID1));
    eq(cat, 'brouillon exclu', r.out, { ok: true, found: false });
    r = run(file, [{ header: ID1 }, { header: ID1 }], ctx => ctx.mailByMsgId_(ID1));
    eq(cat, 'deux correspondances refusées', [r.out.ok, /Plusieurs messages/.test(r.out.error || ''), 'message' in r.out], [false, true, false]);
    r = run(file, [{ header: ID1, raw: 'x'.repeat(20 * 1024 * 1024 + 1) }], ctx => ctx.mailByMsgId_(ID1));
    eq(cat, 'trop lourd refusé', [r.out.ok, /trop lourd/.test(r.out.error || ''), 'message' in r.out], [false, true, false]);
    // identifiants invalides : refusés AVANT toute recherche
    for (const bad of ['', 'abc@exemple.fr', '<abc def@exemple.fr>', '<x@y.fr> OR from:moi', '<a(b)@x.fr>', '<a"b@x.fr>', '<ab\nc@x.fr>', '<' + 'a'.repeat(250) + '@x.fr>', null, 42, ['<a@b.fr>'], { id: '<a@b.fr>' }]){
      r = run(file, [{ header: ID1 }], post({ secret: 'secret-de-test', action: 'mail_by_msgid', message_id: bad }));
      eq(cat, `identifiant invalide ${JSON.stringify(bad)}`, [r.out.ok, /Identifiant de message refusé/.test(r.out.error || ''), r.searches.length], [false, true, 0]);
    }
    // code secret exigé : aucune recherche sans lui
    r = run(file, [{ header: ID1 }], post({ secret: 'mauvais', action: 'mail_by_msgid', message_id: ID1 }));
    eq(cat, 'code secret incorrect', [r.out.ok, r.searches.length], [false, 0]);
  } catch (e) { fail(cat, 'exécution simulée impossible : ' + e); }
}

console.log(`Message-ID (v1.60.4) : ${cases.length} formats de lien, 2 scripts Google exécutés avec services simulés.`);
if (problems.length) { console.error(`\n${problems.length} problème(s) :\n` + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('✓ Aucun problème.');
