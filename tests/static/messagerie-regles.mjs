// Messagerie intégrée (v1.63) sur de FAUSSES données : aucun appel à Gmail, à Google ni à la base.
//  1. règles de la fonction serveur mail-sync (supabase/functions/mail-sync/regles.ts) : accès, lignes enregistrées, doublons ;
//  2. script Google de prospection (apps-script/Prospection.gs) exécuté dans un bac à sable Node avec des services Google SIMULÉS :
//     réponse dans le fil (threadId, In-Reply-To, References), brouillon mis à jour sans copie, envoi confirmé seulement par Gmail,
//     limite de 25 Mo mesurée sur le message encodé, pièces jointes réelles (jamais de lien), rangement (libellé / archive /
//     corbeille, jamais de suppression définitive), historique sans doublon, documents Drive lus avec les droits du compte.
// Lancé par « npm test » (node --experimental-strip-types).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, createHmac } from 'node:crypto';
import { acces, compteOk, essaiOk, horsEssai, messageRows, same, scriptUrlOk, threadIds, threadRow, threadsEssai } from '../../supabase/functions/mail-sync/regles.ts';
import { callerSig, canon, identOf, outgoingBody, signedText } from '../../supabase/functions/script-google/identite.ts';

const cas = [];
const t = (nom, f) => cas.push([nom, f]);
const J = (x) => JSON.parse(JSON.stringify(x));   // valeurs venues du bac à sable du script (autre contexte JavaScript)

// ── 1. Règles de la fonction serveur ─────────────────────────────────────────────────────────────────────────────────
t('accès : sans justificatif, faux secret, secret vide → 403', () => {
  assert.equal(acces({ hook: '', hookSecret: 'abc', owner: false, mode: 'sync' }).status, 403);
  assert.equal(acces({ hook: 'faux', hookSecret: 'abc', owner: false, mode: 'sync' }).status, 403);
  assert.equal(acces({ hook: '', hookSecret: '', owner: false, mode: 'sync' }).status, 403);
  assert.equal(acces({ hook: 'abc', hookSecret: null, owner: false, mode: 'sync' }).status, 403);
});
t('accès : secret dédié → synchronisation planifiée seulement ; relire des conversations précises → équipe', () => {
  assert.equal(acces({ hook: 'abc', hookSecret: 'abc', owner: false, mode: 'sync' }).ok, true);
  assert.equal(acces({ hook: 'abc', hookSecret: 'abc', owner: false, mode: 'threads' }).status, 403);
  assert.equal(acces({ hook: '', hookSecret: 'abc', owner: true, mode: 'threads' }).ok, true);
  assert.equal(same('abc', 'abd'), false); assert.equal(same('abc', 'abc'), true);
});
t('boîte anthony@ réservée au compte d’Anthony : autre membre de l’équipe refusé par mail-sync', () => {
  // un membre de l'équipe qui n'est pas le propriétaire : owner = false (is_mailbox_owner côté base, avec sa session)
  assert.equal(acces({ hook: '', hookSecret: 'abc', owner: false, mode: 'sync' }).status, 403);
  assert.equal(acces({ hook: '', hookSecret: 'abc', owner: false, mode: 'threads' }).status, 403);
  assert.match(acces({ hook: '', hookSecret: 'abc', owner: false, mode: 'sync' }).error, /réservée au compte d’Anthony/);
});
t('une seule règle : toutes les actions de boîte du script sont réservées au titulaire (BOITE_), pas de second contrôle dans le relais', () => {
  const relais = readFileSync(new URL('../../supabase/functions/script-google/index.ts', import.meta.url), 'utf8');
  const gs = readFileSync(new URL('../../apps-script/Prospection.gs', import.meta.url), 'utf8');
  const boite = Object.keys(JSON.parse((gs.match(/var BOITE_ = (\{[^}]*\})/) || [])[1].replace(/(\w+):/g, '"$1":')));
  assert.deepEqual(boite.sort(), ['attachment', 'compose', 'files_info', 'history', 'labels', 'mail_by_msgid', 'modify', 'thread', 'threads']);
  for (const a of boite) assert.ok(gs.includes(`a === '${a}'`), 'action absente du script : ' + a);
  for (const a of ['mail', 'reply', 'status', 'ping']) assert.ok(!boite.includes(a), 'prospection : droits de l’équipe conservés (' + a + ')');
  assert.ok(!/OWNER_ONLY|is_mailbox_owner/.test(relais), 'aucun second mécanisme dans le relais');
});
t('adresse du script : seulement une adresse publiée script.google.com/…/exec', () => {
  assert.ok(scriptUrlOk('https://script.google.com/macros/s/AKfy_essai-1/exec'));
  assert.ok(!scriptUrlOk('https://script.google.com.example.net/macros/s/x/exec'));
  assert.ok(!scriptUrlOk('http://script.google.com/macros/s/x/exec'));
});
t('identifiants de conversation envoyés par le navigateur : filtrés (hexadécimal, 25 au plus)', () => {
  assert.deepEqual(threadIds(['abc123', "x' or 1=1", 'ABCDEF0123', 5]), ['abc123', 'ABCDEF0123']);
  assert.equal(threadIds(Array.from({ length: 40 }, (_, i) => 'aaaaaa' + i)).length, 25);
  assert.deepEqual(threadIds('abc123'), []);
});
const TH = { id: 'th1', subject: 'Objet', snippet: '…', last_at: '2026-11-08T09:00:00Z', count: 3, unread: true, labels: ['INBOX', 'UNREAD'],
  participants: [{ email: 'Camille@Example.com' }, { email: 'camille@example.com' }],
  messages: [
    { id: 'm1', rfc_id: '<m1@example.com>', from: { email: 'Camille@Example.com', name: 'Camille' }, to: [{ email: 'boite@example.org' }], cc: [], subject: 'Objet', date: '2026-11-08T08:00:00Z', snippet: 'a', direction: 'in', attachments: [{ name: 'fiche.pdf', size: 1000, mime: 'application/pdf', id: 'x' }] },
    { id: 'm2', rfc_id: '<m2@example.org>', refs: ['<m1@example.com>', 'pas-un-id', '<m1@example.com>'], from: { email: 'boite@example.org' }, to: [{ email: 'camille@example.com' }], cc: [], subject: 'Re: Objet', date: '2026-11-08T09:00:00Z', snippet: 'b', direction: 'out', attachments: [] },
    { id: 'm2', rfc_id: '<m2@example.org>', from: { email: 'boite@example.org' }, to: [], cc: [], subject: 'Re: Objet', date: '2026-11-08T09:00:00Z', snippet: 'b', direction: 'out', attachments: [] },
    { id: 'd1', draft: true, from: { email: 'boite@example.org' }, to: [], cc: [], subject: 'Brouillon', date: '2026-11-08T10:00:00Z', snippet: '', direction: 'out', attachments: [] },
  ] };
t('conversation : participants uniques en minuscules ; le rattachement ne fait jamais partie de la ligne enregistrée', () => {
  const r = threadRow('anthony', TH);
  assert.deepEqual(r.participants, ['camille@example.com']);
  for (const k of ['structure_id', 'prospect_id', 'project_id', 'show_id', 'link_status', 'link_reason']) assert.ok(!(k in r), k);
});
t('messages : brouillon jamais enregistré (un brouillon n’est pas un envoi), aucun doublon, références conservées', () => {
  const rows = messageRows('anthony', 'uuid-th', TH);
  assert.deepEqual(rows.map((r) => r.gmail_message_id), ['m1', 'm2']);
  assert.equal(rows[0].from_addr, 'camille@example.com');
  assert.deepEqual(rows[1].ref_ids, ['<m1@example.com>', '<m1@example.com>']);   // filtrées (« pas-un-id » écarté) ; le doublon est sans effet en base
  assert.ok(rows[1].ref_ids.every((x) => /^<.+>$/.test(x)));
  assert.equal(rows[0].attachments[0].name, 'fiche.pdf');
  assert.ok(!('id' in rows[0].attachments[0]), 'identifiant de pièce Gmail non stocké');
  const auto = messageRows('anthony', 'u', { ...TH, messages: [{ ...TH.messages[0], id: 'n1', auto: 'ndr' }, { ...TH.messages[0], id: 'n2', auto: 'auto' }, { ...TH.messages[1], id: 'n3', auto: 'ndr' }, { ...TH.messages[0], id: 'n4', auto: 'pirate' }] });
  assert.deepEqual(auto.map((r) => r.auto_kind), ['ndr', 'auto', null, null]);   // message envoyé ou valeur inconnue : jamais « automatique »
});

// ── 2. Script Google simulé ──────────────────────────────────────────────────────────────────────────────────────────
const SRC = readFileSync(new URL('../../apps-script/Prospection.gs', import.meta.url), 'utf8');
t('script : aucune suppression définitive (ni Threads.delete, ni Messages.delete, ni setTrashed(false) en masse)', () => {
  assert.ok(!/\.(Threads|Messages)\.(delete|remove|batchDelete)\b/.test(SRC));
  assert.ok(!/Drafts\.delete|\.setTrashed\(|DriveApp\.[a-zA-Z]+\([^)]*\)\.(setContent|setName|moveTo|setSharing|addEditor|addViewer)/.test(SRC));
});

const ME = 'boite.essai@example.org';
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : Buffer.from(x)).toString('base64');
const blob = (bytes, name = '', type = 'application/octet-stream') => ({
  _b: Buffer.from(bytes), getBytes() { return this._b; }, getName() { return name; }, getContentType() { return type; },
  setName(n) { name = n; return this; }, setDataFromString(s) { this._b = Buffer.from(String(s), 'utf8'); return this; }, getDataAsString() { return this._b.toString('utf8'); } });
const CLE = 'cle-boite-fictive', TITULAIRE = ME;
function bac({ threads = {}, history = null, historyError = false, driveFiles = {}, urls = {}, sendNoId = false, updateFails = false, cle = CLE, props = {}, labels = null, searches = {}, drafts = null, modifyFails = false } = {}) {
  const log = { created: [], updated: [], sent: [], modified: [], trashed: [], untrashed: [], fetched: [], lists: [], gets: [], historyCalls: 0, searches: [] };
  const hdrs = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
  const Gmail = { Users: {
    Threads: {
      get: (_me, id, opt) => { log.gets.push([id, opt?.format || '']); if (!threads[id]) throw new Error('Not Found'); return JSON.parse(JSON.stringify(threads[id])); },
      // liste : filtre par libellé au niveau de la CONVERSATION (un message porteur suffit), comme Gmail
      list: (_me, opt = {}) => { log.lists.push(opt); const L = opt.labelIds || [];
        return { threads: Object.keys(threads).filter((id) => L.every((l) => threads[id].messages.some((m) => (m.labelIds || []).includes(l))))
          .map((id) => ({ id, historyId: threads[id].historyId || '100' })) }; },
      modify: (req, _me, id) => { if (modifyFails) throw new Error('Gmail indisponible'); log.modified.push({ id, ...req }); return { messages: [{ labelIds: ['INBOX'] }] }; },
      trash: (_me, id) => { log.trashed.push(id); }, untrash: (_me, id) => { log.untrashed.push(id); },
    },
    Drafts: {
      get: (_me, id) => { const d = (drafts || {})[id]; if (!d) throw new Error('Not Found'); return { id, message: { id: 'm-' + id, threadId: d } }; },
      create: (req) => { log.created.push(req); return { id: 'dr-' + log.created.length, message: { id: 'msg-d', threadId: req.message.threadId || 'neuf' } }; },
      update: (req, _me, id) => { if (updateFails) throw new Error('Requested entity was not found.'); log.updated.push({ id, req }); return { id, message: { id: 'msg-d', threadId: req.message.threadId || 'neuf' } }; },
      send: (req) => { log.sent.push(req.id); return sendNoId ? {} : { id: 'envoye-1', threadId: 'th-envoi' }; },
    },
    History: { list: () => { log.historyCalls++; if (historyError) throw new Error('historyId expiré'); return history || { history: [] }; } },
    Labels: { list: () => ({ labels: labels || [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_1', name: 'Booking 2027', type: 'user' }] }) },
    Messages: { Attachments: { get: () => ({ size: 10, data: 'eA' }) },
      get: (_me, id) => { const t = Object.keys(threads).find((k) => threads[k].messages.some((m) => m.id === id)); if (!t) throw new Error('Not Found'); return { id, threadId: t }; } },
    getProfile: () => ({ historyId: '999' }),
  } };
  const cache = {};
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ WEBHOOK_SECRET: 'secret-essai', CLE_BOITE: cle, ...props })[k] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => ME }) },
    ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    Logger: { log() {} },
    Utilities: {
      base64Encode: (x) => b64(x), base64EncodeWebSafe: (x) => Buffer.from(x).toString('base64url'),
      base64DecodeWebSafe: (s) => Buffer.from(s, 'base64url'), Charset: { UTF_8: 'UTF-8' },
      newBlob: (x) => blob(typeof x === 'string' ? Buffer.from(x, 'utf8') : x),
      formatDate: () => '08/11/2026 à 09:00',
      // mêmes calculs que Google : octets signés (-128…127)
      computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v).digest()].map((b) => (b > 127 ? b - 256 : b)),
      computeDigest: (_alg, v) => [...createHash('sha256').update(v, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
    },
    UrlFetchApp: { fetch: (u) => { log.fetched.push(u); if (!urls[u]) throw new Error('404'); return { getBlob: () => blob(urls[u], 'x', 'application/pdf') }; } },
    DriveApp: { getFileById: (id) => { const f = driveFiles[id]; if (!f) throw new Error('Accès refusé');
      return { getBlob: () => blob(f.bytes, f.name, 'application/pdf'), getSize: () => f.size ?? f.bytes.length, getName: () => f.name, getMimeType: () => 'application/pdf' }; } },
    GmailApp: { getMessageById: () => ({ getAttachments: () => [blob(Buffer.alloc(100), 'origine.pdf', 'application/pdf')] }),
      search: (q) => { log.searches.push(q); return searches[q] || []; } },
    Gmail,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const raw = (req) => Buffer.from(req.message.raw, 'base64url').toString('utf8');
  return { ctx, log, raw, hdrs };
}
const msg = (id, labels, h, extra = {}) => ({ id, threadId: 'th1', labelIds: labels, internalDate: String(Date.parse('2026-11-08T08:00:00Z')), snippet: 's',
  payload: { mimeType: 'multipart/mixed', headers: Object.entries(h).map(([name, value]) => ({ name, value })), parts: [
    { mimeType: 'text/html', body: { data: Buffer.from('<p>Bonjour</p>').toString('base64url'), size: 14 } }, ...(extra.parts || [])] } });
const FIL = { id: 'th1', messages: [
  msg('g1', ['INBOX'], { From: 'Camille <camille@example.com>', To: ME, Cc: 'copie@example.com', Subject: 'Proposition', 'Message-ID': '<m1@example.com>' },
    { parts: [{ mimeType: 'application/pdf', filename: 'fiche.pdf', body: { attachmentId: 'att1', size: 120000 } }] }),
  msg('g2', ['SENT'], { From: ME, To: 'camille@example.com', Subject: 'Re: Proposition', 'Message-ID': '<m2@example.org>', 'In-Reply-To': '<m1@example.com>', References: '<m1@example.com>' }),
  msg('g3', ['INBOX', 'UNREAD'], { From: 'camille@example.com', 'Reply-To': 'prog@example.com', To: ME, Subject: 'Re: Proposition', 'Message-ID': '<m3@example.com>', 'In-Reply-To': '<m2@example.org>', References: '<m1@example.com> <m2@example.org>' }),
  msg('g4', ['DRAFT'], { From: ME, To: 'camille@example.com', Subject: 'Re: Proposition', 'Message-ID': '<brouillon@example.org>' }),
] };

t('réponse : même conversation (threadId), In-Reply-To = message d’origine, References complétées, objet « Re: » gardé', () => {
  const { ctx, log, raw } = bac({ threads: { th1: FIL } });
  const out = ctx.compose_({ mode: 'reply', thread_id: 'th1', to: 'prog@example.com', html: '<p>Merci</p>', send: true });
  assert.equal(out.sent, true); assert.equal(out.message_id, 'envoye-1');
  const req = log.created[0], m = raw(req);
  assert.equal(req.message.threadId, 'th1');
  assert.match(m, /\r\nIn-Reply-To: <m3@example\.com>\r\n/);
  assert.match(m, /\r\nReferences: <m1@example\.com> <m2@example\.org> <m3@example\.com>\r\n/);
  assert.match(m, /Subject: =\?UTF-8\?B\?/); assert.ok(m.includes(b64('Re: Proposition')));
  assert.ok(!m.includes('brouillon@example.org'), 'jamais en réponse à un brouillon');
});
t('réponse à un message précis du fil : In-Reply-To = ce message', () => {
  const { ctx, log, raw } = bac({ threads: { th1: FIL } });
  ctx.compose_({ mode: 'reply_all', thread_id: 'th1', message_id: 'g1', to: 'camille@example.com', cc: 'copie@example.com', html: 'x', send: true });
  assert.match(raw(log.created[0]), /\r\nIn-Reply-To: <m1@example\.com>\r\nReferences: <m1@example\.com>\r\n/);
  assert.match(raw(log.created[0]), /\r\nCc: copie@example\.com\r\n/);
});
t('transfert : pièces d’origine jointes, pas d’In-Reply-To ; nouveau mail : aucun fil', () => {
  const { ctx, log, raw } = bac({ threads: { th1: FIL } });
  ctx.compose_({ mode: 'forward', thread_id: 'th1', to: 'autre@example.net', html: 'x', send: false });
  const m = raw(log.created[0]);
  assert.ok(!/In-Reply-To/.test(m)); assert.ok(m.includes(b64('Tr : Re: Proposition')), 'objet « Tr : » (dernier message du fil)');
  assert.match(m, /Content-Disposition: attachment; filename=/);
  ctx.compose_({ mode: 'new', to: 'autre@example.net', subject: 'Nouveau', html: 'x', send: false });
  assert.equal(log.created[1].message.threadId, undefined);
});
t('en-têtes : un retour à la ligne glissé dans un destinataire ou l’objet ne crée aucun en-tête', () => {
  const { ctx, log, raw } = bac({ threads: { th1: FIL } });
  ctx.compose_({ mode: 'new', to: 'a@example.net\r\nBcc: espion@example.net', subject: 'Objet\nX-Pirate: 1', html: 'x', send: false });
  const m = raw(log.created[0]);
  assert.ok(!/\r\nBcc: espion/.test(m)); assert.ok(!/\r\nX-Pirate/.test(m));
});
t('brouillon : enregistré puis MIS À JOUR (jamais dupliqué) ; envoi depuis le brouillon', () => {
  const { ctx, log } = bac({ threads: { th1: FIL } });
  const d = ctx.compose_({ mode: 'reply', thread_id: 'th1', to: 'prog@example.com', html: 'v1', send: false });
  assert.equal(d.sent, false); assert.equal(d.draft_id, 'dr-1');
  ctx.compose_({ mode: 'reply', thread_id: 'th1', to: 'prog@example.com', html: 'v2', send: false, draft_id: d.draft_id });
  ctx.compose_({ mode: 'reply', thread_id: 'th1', to: 'prog@example.com', html: 'v3', send: true, draft_id: d.draft_id });
  assert.equal(log.created.length, 1); assert.equal(log.updated.length, 2); assert.deepEqual(log.sent, ['dr-1']);
});
t('brouillon disparu de Gmail (envoyé / supprimé ailleurs) : arrêt, aucun nouveau brouillon, aucun envoi', () => {
  const { ctx, log } = bac({ threads: { th1: FIL }, updateFails: true });
  assert.throws(() => ctx.compose_({ mode: 'reply', thread_id: 'th1', to: 'prog@example.com', html: 'x', send: true, draft_id: 'dr-ancien' }), /BROUILLON_ABSENT.*Rien n’est parti/);
  assert.equal(log.created.length, 0); assert.equal(log.sent.length, 0);
});
t('envoi : « envoyé » seulement si Gmail renvoie l’identifiant du message', () => {
  const { ctx } = bac({ threads: { th1: FIL }, sendNoId: true });
  assert.equal(ctx.compose_({ mode: 'reply', thread_id: 'th1', to: 'prog@example.com', html: 'x', send: true }).sent, false);
});
t('pièces jointes : vraies pièces (stockage par lien temporaire, Drive avec les droits du compte), illisible → rien ne part', () => {
  const { ctx, log, raw } = bac({ threads: { th1: FIL }, urls: { 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/artiste/ft.pdf?token=essai': Buffer.from('%PDF-essai') }, driveFiles: { 'drive-dp-00001': { bytes: Buffer.from('%PDF-drive'), name: 'Dossier de presse.pdf' } } });
  ctx.compose_({ mode: 'new', to: 'a@example.net', subject: 'Docs', html: 'x', send: true,
    attachments: [{ url: 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/artiste/ft.pdf?token=essai', name: 'Fiche technique.pdf' }, { id: 'drive-dp-00001', name: 'Dossier de presse.pdf' }] });
  const m = raw(log.created[0]);
  assert.equal((m.match(/Content-Disposition: attachment/g) || []).length, 2);
  assert.ok(m.includes(b64('%PDF-essai')) && m.includes(b64('%PDF-drive')));
  assert.ok(!m.includes('supabase.co'), 'aucun lien à la place de la pièce');
  const { ctx: c2, log: l2 } = bac({ threads: { th1: FIL } });
  assert.throws(() => c2.compose_({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true, attachments: [{ id: 'interdit', name: 'privé.pdf' }] }), /Pièce jointe illisible.*Rien n’est parti/);
  assert.equal(l2.created.length + l2.sent.length, 0);
});
t('limite Gmail mesurée sur le message ENCODÉ : 18,5 Mo bruts refusés (≈ 25,4 Mo encodés), 17 Mo acceptés', () => {
  const Mo = 1024 * 1024;
  const gros = bac({ urls: { 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/gros?token=x': Buffer.alloc(Math.round(18.5 * Mo), 65) } });
  assert.throws(() => gros.ctx.compose_({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true, attachments: [{ url: 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/gros?token=x', name: 'gros.wav' }] }), /trop lourd/i);
  assert.equal(gros.log.created.length, 0, 'rien n’est créé dans Gmail');
  const ok = bac({ urls: { 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/moyen?token=x': Buffer.alloc(17 * Mo, 65) } });
  assert.equal(ok.ctx.compose_({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true, attachments: [{ url: 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/moyen?token=x', name: 'moyen.wav' }] }).sent, true);
  // deux pièces de 9,5 Mo : sous 25 Mo bruts, au-dessus une fois encodées
  const deux = bac({ urls: { 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/a?token=x': Buffer.alloc(Math.round(9.5 * Mo), 65), 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/b?token=x': Buffer.alloc(Math.round(9.5 * Mo), 66) } });
  assert.throws(() => deux.ctx.compose_({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true, attachments: [{ url: 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/a?token=x', name: 'a' }, { url: 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/suivi/b?token=x', name: 'b' }] }), /trop lourd/i);
});
t('adresses : seule, avec nom, nom entre guillemets avec virgule, plusieurs (jamais tronquées)', () => {
  const { ctx } = bac();
  assert.deepEqual(J(ctx.addrs_('prog@example.com')), [{ name: '', email: 'prog@example.com' }]);
  assert.deepEqual(J(ctx.addrs_('Camille Exemple <Camille@Example.com>, dom@example.org')), [{ name: 'Camille Exemple', email: 'camille@example.com' }, { name: '', email: 'dom@example.org' }]);
  assert.deepEqual(J(ctx.addrs_('"Exemple, Camille" <c@example.com>')), [{ name: 'Exemple, Camille', email: 'c@example.com' }]);
  assert.deepEqual(J(ctx.addrs_('')), []);
});
t('pièces jointes : seuls les liens signés du stockage Supabase et des identifiants Drive valides sont lus', () => {
  const { ctx, log } = bac({ urls: { 'https://pirate.example.net/x': Buffer.from('x') } });
  assert.throws(() => ctx.compose_({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true, attachments: [{ url: 'https://pirate.example.net/x', name: 'x' }] }), /adresse refusée.*Rien n’est parti/);
  assert.throws(() => ctx.compose_({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true, attachments: [{ url: 'https://abcdefghijkl.supabase.co/storage/v1/object/sign/x?t=1 https://pirate', name: 'x' }] }), /adresse refusée/);
  assert.throws(() => ctx.compose_({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true, attachments: [{ id: '../../x', name: 'x' }] }), /identifiant Drive refusé/);
  assert.equal(log.fetched.length + log.created.length, 0);
});
t('messages automatiques reconnus par leurs en-têtes : avis de non-remise (rapport, X-Failed-Recipients, Exchange), réponse automatique', () => {
  const { ctx } = bac();
  const k = (h, mime = 'text/plain') => ctx.autoKind_({ mimeType: mime, headers: Object.entries(h).map(([name, value]) => ({ name, value })) }, (h.From || '').replace(/.*<|>.*/g, ''), h.Subject || '');
  assert.equal(k({ From: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }), 'ndr');
  assert.equal(k({ From: 'microsoftexchange329e71ec88ae4615bbc36ab6ce41109e@b.example', Subject: 'Non remis : Hello' }), 'ndr');
  assert.equal(k({ From: 'robot@b.example', 'Content-Type': 'multipart/report; report-type=delivery-status' }, 'multipart/report'), 'ndr');
  assert.equal(k({ From: 'relais@b.example', 'X-Failed-Recipients': 'x@b.example' }), 'ndr');
  assert.equal(k({ From: 'camille@example.com', 'Auto-Submitted': 'auto-replied', Subject: 'Absence' }), 'auto');
  assert.equal(k({ From: 'camille@example.com', 'X-Autoreply': 'yes' }), 'auto');
  assert.equal(k({ From: 'camille@example.com', 'Auto-Submitted': 'no', Subject: 'Re: Proposition' }), '');
  assert.equal(k({ From: 'camille@example.com', Subject: 'Re: Proposition' }), '');
});
t('image intégrée au texte (Content-ID) : marquée, distincte d’une vraie pièce jointe', () => {
  const { ctx } = bac();
  const acc = ctx.parts_({ mimeType: 'multipart/related', parts: [
    { mimeType: 'image/png', filename: 'logo.png', headers: [{ name: 'Content-ID', value: '<logo1>' }, { name: 'Content-Disposition', value: 'inline; filename=logo.png' }], body: { attachmentId: 'i1', size: 900 } },
    { mimeType: 'application/pdf', filename: 'fiche.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment; filename=fiche.pdf' }], body: { attachmentId: 'a1', size: 1000 } }] }, { html: '', text: '', attachments: [] });
  assert.deepEqual(J(acc.attachments.map(a => [a.name, a.inline])), [['logo.png', true], ['fiche.pdf', false]]);
});
t('lecture : brouillons exclus du fil, participants sans la boîte, adresse de réponse, pièces (nom, taille), références', () => {
  const { ctx } = bac({ threads: { th1: FIL } });
  const th = ctx.thread_({ thread_id: 'th1' }).thread;
  assert.deepEqual(J(th.messages.map((m) => m.id)), ['g1', 'g2', 'g3']);
  assert.equal(th.count, 3); assert.equal(th.unread, true);
  assert.ok(!th.participants.some((p) => p.email === ME));
  assert.deepEqual(J(th.messages[2].reply_to.map((a) => a.email)), ['prog@example.com']);
  assert.equal(th.messages[1].direction, 'out');
  assert.deepEqual(J(th.messages[0].attachments.map((a) => [a.name, a.size])), [['fiche.pdf', 120000]]);
  assert.deepEqual(J(th.messages[2].refs), ['<m2@example.org>', '<m1@example.com>']);
});
t('rangement : libellé ajouté / retiré, archive = retrait de INBOX, lu / non lu, corbeille et retour, distincts', () => {
  const { ctx, log } = bac();
  ctx.modify_({ thread_id: 'th1', add: ['Label_1'] });
  ctx.modify_({ thread_id: 'th1', remove: ['Label_1'] });
  ctx.modify_({ thread_id: 'th1', archive: true });
  ctx.modify_({ thread_id: 'th1', read: true });
  ctx.modify_({ thread_id: 'th1', trash: true });
  ctx.modify_({ thread_id: 'th1', untrash: true });
  assert.deepEqual(J(log.modified.map((m) => [m.addLabelIds, m.removeLabelIds])), [[['Label_1'], []], [[], ['Label_1']], [[], ['INBOX']], [[], ['UNREAD']]]);
  assert.deepEqual(log.trashed, ['th1']); assert.deepEqual(log.untrashed, ['th1']);
});
t('historique : messages ajoutés (Apple Mail compris) et libellés changés → conversations, une fois chacune ; reste au passage suivant', () => {
  const threads = { th1: FIL, th2: { id: 'th2', messages: [msg('h1', ['SENT'], { From: ME, To: 'x@example.net', Subject: 'A' })] }, th3: { id: 'th3', messages: [msg('h2', ['INBOX'], { From: 'x@example.net', To: ME, Subject: 'B' })] } };
  const history = { history: [{ messagesAdded: [{ message: { id: 'g3', threadId: 'th1' } }] }, { labelsAdded: [{ message: { id: 'g1', threadId: 'th1' } }] },
    { labelsRemoved: [{ message: { id: 'h1', threadId: 'th2' } }] }, { messagesAdded: [{ message: { id: 'h2', threadId: 'th3' } }] }] };
  const { ctx } = bac({ threads, history });
  const r = ctx.history_({ start_history_id: '100', max: 2 });
  assert.equal(r.history_id, '999');
  assert.deepEqual(J(r.threads.map((x) => x.id)), ['th1', 'th2']); assert.deepEqual(J(r.remaining), ['th3']);
  const r2 = ctx.history_({ ids: r.remaining });
  assert.deepEqual(J(r2.threads.map((x) => x.id)), ['th3']);
});
t('historique expiré : reprise sur 14 jours ; conversation supprimée définitivement de Gmail : signalée, jamais effacée ici', () => {
  const { ctx } = bac({ threads: { th1: FIL }, historyError: true });
  const r = ctx.history_({ start_history_id: '1' });
  assert.equal(r.full, true); assert.deepEqual(J(r.threads.map((x) => x.id)), ['th1']);
  const r2 = ctx.history_({ ids: ['disparue'] });
  assert.deepEqual(J(r2.threads), [{ id: 'disparue', missing: true }]);
});
t('documents Drive : taille et nom lus avec les droits du compte ; inaccessible → signalé, rien n’est partagé', () => {
  const { ctx } = bac({ driveFiles: { 'drive-ok-0001': { bytes: Buffer.alloc(2048), name: 'Fiche technique.pdf' }, 'gdoc-00000001': { bytes: Buffer.alloc(5000), name: 'Dossier.pdf', size: 0 } } });
  const r = ctx.filesInfo_({ ids: ['drive-ok-0001', 'gdoc-00000001', 'prive-000001', '../x'] }).files;
  assert.deepEqual(J(r.map((f) => [f.ok, f.size || 0])), [[true, 2048], [true, 5000], [false, 0], [false, 0]]);
  assert.match(r[2].error, /Inaccessible/);
});

// ── Accès à la boîte : UNE règle (v1.60.4) pour toutes les actions de messagerie ──────────────────────────────────────────
const appel = (ctx, body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }));
const ACTIONS_BOITE = [['threads', {}], ['thread', { thread_id: 'th1' }], ['labels', {}], ['modify', { thread_id: 'th1', archive: true }],
  ['compose', { mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: false }], ['attachment', { message_id: 'g1', attachment_id: 'att1' }],
  ['history', { start_history_id: '1' }], ['files_info', { ids: [] }]];
t('empreinte de la demande : même valeur au relais (identite.ts) et dans le script (unicode, émojis, tableaux, nombres, clés désordonnées)', async () => {
  const { ctx } = bac();
  const charge = { z: 1.5, a: ['é', { y: null, b: true }], html: '<p>Café 🎵 « test »</p>\n', n: 0, vide: {}, liste: [] };
  const relais = await identOf('compose', { ...charge, secret: 'ignoré', caller: 'x' });
  assert.equal(relais, ctx.identOf_({ ...JSON.parse(JSON.stringify(charge)), action: 'compose', secret: 's', caller: 'c', caller_ts: 1, caller_sig: 'x' }, 'compose'));
  assert.equal(relais, 'sha256:' + createHash('sha256').update(canon(charge), 'utf8').digest('hex'));
  assert.equal(await identOf('mail_by_msgid', { message_id: '<a@b.fr>' }), '<a@b.fr>');   // v1.60.4 inchangé
});
t('toutes les actions de boîte : sans identité signée → refusées AVANT toute lecture (motif « signature »)', async () => {
  const { ctx, log } = bac({ threads: { th1: FIL } });
  for (const [a, p] of ACTIONS_BOITE) {
    const r = appel(ctx, { ...p, action: a, secret: 'secret-essai' });
    assert.equal(r.refused, true, a); assert.match(r.error, /non signée ou signature invalide/, a);
  }
  assert.equal(log.created.length + log.modified.length + log.fetched.length, 0);
  assert.equal(appel(ctx, { action: 'ping', secret: 'secret-essai' }).ok, true);   // prospection et ping : droits inchangés
});
t('titulaire (identité signée par le relais) accepté ; autre membre de l’équipe refusé « réservée à son titulaire »', async () => {
  for (const [a, p] of ACTIONS_BOITE) {
    const { ctx } = bac({ threads: { th1: FIL } });
    const ok = appel(ctx, await outgoingBody(p, a, 'secret-essai', TITULAIRE, CLE));
    assert.equal(ok.refused, undefined, a + ' : ' + ok.error);
    const non = appel(ctx, await outgoingBody(p, a, 'secret-essai', 'collegue@example.net', CLE));
    assert.equal(non.refused, true, a); assert.match(non.error, /réservée à son titulaire/, a);
  }
});
t('signature captée : inutilisable pour une AUTRE demande (autre conversation, autre destinataire) ; rejeu à l’identique refusé', async () => {
  const { ctx, log } = bac({ threads: { th1: FIL, th2: FIL } });
  const capte = JSON.parse(await outgoingBody({ thread_id: 'th1' }, 'thread', 'secret-essai', TITULAIRE, CLE));
  assert.match(appel(ctx, { ...capte, thread_id: 'th2' }).error, /signature invalide/);
  const envoi = JSON.parse(await outgoingBody({ mode: 'new', to: 'a@example.net', subject: 'x', html: 'x', send: true }, 'compose', 'secret-essai', TITULAIRE, CLE));
  assert.match(appel(ctx, { ...envoi, to: 'pirate@example.net' }).error, /signature invalide/);
  assert.match(appel(ctx, { ...envoi, action: 'modify' }).error, /signature invalide/);
  assert.equal(log.sent.length, 0);
  assert.equal(appel(ctx, capte).ok, true);
  assert.match(appel(ctx, capte).error, /déjà utilisée/);
  const { ctx: c2 } = bac({ threads: { th1: FIL }, cle: '' });
  assert.match(appel(c2, await outgoingBody({ thread_id: 'th1' }, 'thread', 'secret-essai', TITULAIRE, CLE)).error, /ajoute la propriété CLE_BOITE/);
});
t('cible et boîte signées : demande signée pour « main » (production@) refusée par le script de prospection, pour chaque action de boîte', async () => {
  for (const [a, p] of ACTIONS_BOITE) {
    const { ctx, log } = bac({ threads: { th1: FIL } });
    const r = appel(ctx, await outgoingBody(p, a, 'secret-essai', TITULAIRE, CLE, Date.now(), 'main'));
    assert.equal(r.refused, true, a); assert.match(r.error, /signature invalide/, a);
    assert.equal(log.created.length + log.modified.length, 0);
  }
  assert.match(signedText('prospect', 'anthony', 'A@B.fr', 'thread', 'x', 1), /^matrice-boite-v2\|prospect\|anthony\|a@b\.fr\|thread\|x\|1$/);
});
t('et inversement : une signature faite pour « prospect » ne vaut pas pour « main » ; le script principal ne réserve aucune action à une signature', async () => {
  const ts = Date.now();
  assert.notEqual(await callerSig(CLE, 'prospect', 'anthony', TITULAIRE, 'mail_by_msgid', '<a@b.fr>', ts), await callerSig(CLE, 'main', 'production', TITULAIRE, 'mail_by_msgid', '<a@b.fr>', ts));
  const code = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(!/caller_sig|CLE_BOITE|ownerOnly_/.test(code), 'Code.gs (production@) : droits de l’équipe, aucune action accordée sur signature');
  assert.equal(JSON.parse(await outgoingBody({ message_id: '<a@b.fr>' }, 'mail_by_msgid', 's', TITULAIRE, CLE, ts, 'inconnue')).caller_sig, '', 'cible inconnue : aucune signature');
});
t('synchronisation planifiée : signée au nom du titulaire inscrit, côté serveur ; réponse d’un autre compte refusée', () => {
  const src = readFileSync(new URL('../../supabase/functions/mail-sync/index.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ outgoingBody \} from '\.\.\/script-google\/identite\.ts'/);
  assert.match(src, /rpc\('mailbox_owner_email', \{ p_mailbox: MAILBOX \}\)/);
  assert.match(src, /rpc\('import_secret', \{ k: 'mailbox_sign_key' \}\)/);
  assert.match(src, /body: await outgoingBody\(payload, action, secret, owner, key, Date\.now\(\), 'prospect'\)/);
  assert.match(src, /if \(!compteOk\(j\.account, owner\)\) throw/);
  assert.ok(!/JSON\.stringify\(\{ \.\.\.payload, action, secret \}\)/.test(src), 'plus aucun appel non signé');
  assert.equal(compteOk('Titulaire@Example.org', 'titulaire@example.org'), true);
  assert.equal(compteOk('autre@example.org', 'titulaire@example.org'), false);
  assert.equal(compteOk(undefined, 'titulaire@example.org'), false);
  assert.equal(compteOk('x@example.org', ''), false);
});

// ── Mode essai (09/11/2026) : seules les conversations TEST portant le libellé, au niveau de la conversation ──────────────────────
const ESSAI = { MODE_ESSAI: 'oui', LIBELLE_ESSAI: 'Matrice-essai', DESTINATAIRES_ESSAI: 'colbe.essai@example.net, titulaire@example.org' };
const LIBS = [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_E', name: 'Matrice-essai', type: 'user' }];
const conv = (id, msgs, historyId = '500') => ({ id, historyId, messages: msgs });
const m = (id, labels, h) => msg(id, labels, { Subject: 'Essai Matrice', 'Message-ID': `<${id}@example.org>`, ...h });
// T : conversation TEST — 1er message porte le libellé ; la RÉPONSE arrivée ensuite ne le porte pas (comme Gmail)
const T = conv('aa01aa01aa01aa01', [m('t1', ['SENT', 'Label_E'], { From: ME, To: 'colbe.essai@example.net' }), m('t2', ['INBOX'], { From: 'colbe.essai@example.net', To: ME })]);
// H : conversation réelle hors essai, MÊME objet
const H = conv('bb02bb02bb02bb02', [m('h1', ['INBOX'], { From: 'vrai.contact@example.com', To: ME })]);
const essaiBac = ({ threads = {}, ...o } = {}) => bac({ props: ESSAI, labels: LIBS, ...o, threads: { 'aa01aa01aa01aa01': JSON.parse(JSON.stringify(T)), 'bb02bb02bb02bb02': H, ...threads } });
const signe = async (p, a) => outgoingBody(p, a, 'secret-essai', TITULAIRE, CLE);
t('mode essai : réponse arrivée SANS libellé dans une conversation TEST → récupérée (lecture et synchronisation)', async () => {
  const { ctx } = essaiBac();
  const r = appel(ctx, await signe({ thread_id: 'aa01aa01aa01aa01' }, 'thread'));
  assert.equal(r.ok, true, r.error); assert.deepEqual(J(r.thread.messages.map((x) => x.id)), ['t1', 't2']);
  assert.deepEqual(J(r.essai), { libelle: 'Matrice-essai', id: 'Label_E' });
  const h = appel(ctx, await signe({ start_history_id: '100' }, 'history'));
  assert.deepEqual(J(h.threads.map((x) => x.id)), ['aa01aa01aa01aa01']);
});
t('mode essai : conversation hors TEST au MÊME objet → refusée (lecture, réponse, rangement, pièce, synchronisation, liste)', async () => {
  const { ctx, log } = essaiBac();
  for (const [a, p] of [['thread', { thread_id: 'bb02bb02bb02bb02' }], ['modify', { thread_id: 'bb02bb02bb02bb02', archive: true }], ['compose', { mode: 'reply', thread_id: 'bb02bb02bb02bb02', to: 'colbe.essai@example.net', html: 'x' }],
    ['attachment', { message_id: 'h1', attachment_id: 'x' }], ['status', { thread_id: 'bb02bb02bb02bb02' }]]) {
    const r = appel(ctx, a === 'status' ? { action: a, secret: 'secret-essai', ...p } : await signe(p, a));
    assert.equal(r.refused, true, a); assert.match(r.error, /hors essai|mode essai/, a);
  }
  assert.equal(log.modified.length + log.created.length, 0);
  const h = appel(ctx, await signe({}, 'history'));
  assert.ok(!h.threads.some((x) => x.id === 'bb02bb02bb02bb02'));
  const l = appel(ctx, await signe({ q: 'Essai Matrice' }, 'threads'));
  assert.deepEqual(J(l.threads.map((x) => x.id)), ['aa01aa01aa01aa01']);   // recherche : limitée au libellé
  assert.deepEqual(J(appel(ctx, await signe({}, 'labels')).labels.map((x) => x.name)), ['Matrice-essai']);
});
t('mode essai : libellé RETIRÉ d’une conversation → plus lue ni synchronisée', async () => {
  const sans = conv('aa01aa01aa01aa01', T.messages.map((x) => ({ ...x, labelIds: x.labelIds.filter((l) => l !== 'Label_E') })));
  const { ctx } = essaiBac({ threads: { 'aa01aa01aa01aa01': sans } });
  assert.equal(appel(ctx, await signe({ thread_id: 'aa01aa01aa01aa01' }, 'thread')).refused, true);
  assert.deepEqual(J(appel(ctx, await signe({ start_history_id: '100' }, 'history')).threads), []);
  assert.deepEqual(J(appel(ctx, await signe({ ids: ['aa01aa01aa01aa01'] }, 'history')).threads), []);   // conversation en attente : écartée aussi
});
t('mode essai : synchronisation SANS l’historique de toute la boîte — une liste par libellé, puis les seules conversations changées', async () => {
  const { ctx, log } = essaiBac({ threads: { 'cc03cc03cc03cc03': conv('cc03cc03cc03cc03', [m('c1', ['Label_E'], { From: ME, To: 'colbe.essai@example.net' })], '90') } });
  const h = appel(ctx, await signe({ start_history_id: '100' }, 'history'));
  assert.equal(log.historyCalls, 0, 'jamais History.list en mode essai');
  assert.ok(log.lists.length >= 1 && log.lists.every((o) => JSON.stringify(o.labelIds) === '["Label_E"]'), 'toute liste filtrée par le libellé');
  assert.deepEqual(J(h.threads.map((x) => x.id)), ['aa01aa01aa01aa01']);   // cc03 inchangée depuis le point de reprise : pas relue
  assert.ok(!log.gets.some(([id]) => id === 'bb02bb02bb02bb02'), 'aucune lecture d’une conversation hors essai');
});
t('mode essai : envois réservés aux destinataires d’essai (alias compris) ; conversation créée marquée TEST ; libellé jamais retiré', async () => {
  const { ctx, log } = essaiBac();
  assert.match(appel(ctx, await signe({ mode: 'new', to: 'vrai.contact@example.com', subject: 'x', html: 'x', send: true }, 'compose')).error, /Destinataire hors/);
  assert.match(appel(ctx, await signe({ mode: 'new', to: 'colbe.essai@example.net', bcc: 'autre@example.com', subject: 'x', html: 'x', send: true }, 'compose')).error, /Destinataire hors/);
  assert.match(appel(ctx, { action: 'mail', secret: 'secret-essai', to: 'vrai.contact@example.com', subject: 'x', html: 'x' }).error, /Destinataire hors/);
  assert.equal(log.created.length, 0);
  const ok = appel(ctx, await signe({ mode: 'new', to: 'Colbe.Essai+salle@example.net', subject: 'Essai', html: 'x', send: true }, 'compose'));
  assert.equal(ok.sent, true, ok.error);
  assert.deepEqual(J(log.modified.at(-1)), { id: 'th-envoi', addLabelIds: ['Label_E'] });
  assert.match(appel(ctx, await signe({ thread_id: 'aa01aa01aa01aa01', remove: ['Label_E'] }, 'modify')).error, /ne se retire pas/);
});
t('relecture B1 : destinataires — toutes les adresses d’un champ vérifiées ; « ; », espaces, adresse cachée dans un nom ou un domaine → refus (À, Copie, Copie cachée, action mail)', async () => {
  const PIEGES = ['colbe.essai@example.net; vrai.contact@example.com', 'colbe.essai@example.net vrai.contact@example.com',
    '<colbe.essai@example.net> vrai.contact@example.com', '"colbe.essai@example.net"@evil.example.com', 'colbe.essai@example.net@evil.example.com'];
  for (const piege of PIEGES) {
    for (const champ of ['to', 'cc', 'bcc']) {
      const { ctx, log } = essaiBac();
      const p = { mode: 'new', to: 'colbe.essai@example.net', subject: 'x', html: 'x', send: true, [champ]: piege };
      const r = appel(ctx, await signe(p, 'compose'));
      assert.match(r.error || '', /Destinataire hors/, champ + ' : ' + piege);
      assert.equal(log.created.length + log.sent.length, 0);
    }
    const { ctx } = essaiBac();
    for (const champ of ['to', 'cc']) assert.match(appel(ctx, { action: 'mail', secret: 'secret-essai', to: 'colbe.essai@example.net', subject: 'x', html: 'x', [champ]: piege }).error || '', /Destinataire hors/, 'mail ' + champ);
  }
  // formes légitimes acceptées
  const { ctx } = essaiBac();
  for (const to of ['Colbe Essai <colbe.essai@example.net>', '"Essai Colbe" <colbe.essai+salle@example.net>, titulaire@example.org'])
    assert.equal(appel(ctx, await signe({ mode: 'new', to, subject: 'x', html: 'x', send: false }, 'compose')).ok, true, to);
  // au moindre doute, refus : virgule dans un nom entre guillemets (découpage ambigu)
  assert.match(appel(ctx, await signe({ mode: 'new', to: '"Essai, Colbe" <colbe.essai@example.net>', subject: 'x', html: 'x', send: false }, 'compose')).error || '', /Destinataire hors/);
});
t('relecture B2 : brouillon désigné hors essai (brouillon réel) → refusé, jamais écrasé ni envoyé ; brouillon d’une conversation TEST accepté', async () => {
  const { ctx, log } = essaiBac({ drafts: { 'r-reel': 'bb02bb02bb02bb02', 'r-test': 'aa01aa01aa01aa01' } });
  for (const id of ['r-reel', 'inconnu']) {
    const r = appel(ctx, await signe({ mode: 'new', to: 'colbe.essai@example.net', subject: 'x', html: 'x', send: true, draft_id: id }, 'compose'));
    assert.match(r.error || '', /Brouillon hors essai/, id);
  }
  assert.equal(log.updated.length + log.sent.length, 0);
  const ok = appel(ctx, await signe({ mode: 'new', to: 'colbe.essai@example.net', subject: 'x', html: 'x', send: false, draft_id: 'r-test' }, 'compose'));
  assert.equal(ok.ok, true, ok.error); assert.equal(log.updated.length, 1);
});
t('mode essai : libellé non retirable quelle que soit l’écriture ; recherche par Message-ID : conversation trouvée hors essai écartée ; libellé non posé après envoi → succès avec avertissement', async () => {
  const { ctx } = essaiBac();
  for (const x of [' Label_E ', 'label_e', 'matrice-essai']) assert.match(appel(ctx, await signe({ thread_id: 'aa01aa01aa01aa01', remove: [x] }, 'modify')).error || '', /ne se retire pas/, x);
  const q = 'rfc822msgid:h1@example.org label:"Matrice-essai"';
  const { ctx: c2 } = essaiBac({ searches: { [q]: [{ getId: () => 'bb02bb02bb02bb02' }] } });
  assert.equal(appel(c2, await signe({ message_id: '<h1@example.org>' }, 'mail_by_msgid')).found, false);
  const { ctx: c3 } = essaiBac({ modifyFails: true });
  const r = appel(c3, await signe({ mode: 'new', to: 'colbe.essai@example.net', subject: 'x', html: 'x', send: true }, 'compose'));
  assert.equal(r.ok, true); assert.equal(r.sent, true); assert.match(r.avertissement, /libellé « Matrice-essai » n’a pas pu être posé/);
});
t('mode essai : synchronisation au-delà de 50 conversations TEST (pages suivantes lues, toujours par libellé)', async () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => { const id = 'dd' + String(i).padStart(14, '0'); return [id, conv(id, [m('d' + i, ['Label_E'], { From: ME, To: 'colbe.essai@example.net' })], '700')]; }));
  const { ctx, log } = essaiBac({ threads: many });
  ctx.Gmail.Users.Threads.list = (_me, opt = {}) => { log.lists.push(opt); const all = Object.keys(many).map((id) => ({ id, historyId: '700' }));
    const start = opt.pageToken ? Number(opt.pageToken) : 0; return { threads: all.slice(start, start + 50), nextPageToken: start + 50 < all.length ? String(start + 50) : undefined }; };
  const h = appel(ctx, await signe({ start_history_id: '100', max: 50 }, 'history'));
  assert.equal(h.threads.length + h.remaining.length, 60);
  assert.ok(log.lists.length === 2 && log.lists.every((o) => JSON.stringify(o.labelIds) === '["Label_E"]'));
});
t('relecture de ea7147b : seul le refus « conversation hors essai » porte le code hors_essai ; mail-sync n’écarte que lui, toute autre erreur reste visible', async () => {
  const { ctx } = essaiBac();
  const hors = appel(ctx, await signe({ thread_id: 'bb02bb02bb02bb02' }, 'thread'));
  assert.equal(hors.code, 'hors_essai'); assert.equal(horsEssai(hors), true);
  const dest = appel(ctx, await signe({ mode: 'new', to: 'vrai.contact@example.com', subject: 'x', html: 'x' }, 'compose'));
  assert.equal(dest.code, 'essai'); assert.equal(horsEssai(dest), false);
  const { ctx: mal } = essaiBac({ props: { MODE_ESSAI: 'oui' } });
  const cfg = appel(mal, await signe({ thread_id: 'aa01aa01aa01aa01' }, 'thread'));
  assert.equal(cfg.code, 'essai'); assert.equal(horsEssai(cfg), false);
  assert.equal(horsEssai({ ok: false, error: 'Conversation hors essai (mode essai)' }), false, 'jamais d’après le texte');
  const src = readFileSync(new URL('../../supabase/functions/mail-sync/index.ts', import.meta.url), 'utf8');
  assert.match(src, /catch \(e\) \{ if \(ESSAI && e instanceof HorsEssai\) continue; throw e; \}/);
  assert.ok(!/hors essai\|mode essai/i.test(src), 'plus aucun filtrage sur le texte');
});
t('relecture de ea7147b : retrait du libellé refusé malgré caractères invisibles ou formes larges (NFKC)', async () => {
  const { ctx, log } = essaiBac();
  for (const x of ['Label_E​', '﻿Label_E', ' Matrice-essai‍', 'Ｌａｂｅｌ_Ｅ', 'Matrice­-essai'])
    assert.match(appel(ctx, await signe({ thread_id: 'aa01aa01aa01aa01', remove: [x] }, 'modify')).error || '', /ne se retire pas/, JSON.stringify(x));
  assert.equal(log.modified.length, 0);
  assert.equal(appel(ctx, await signe({ thread_id: 'aa01aa01aa01aa01', remove: ['Label_1'] }, 'modify')).ok, true, 'autre libellé : retrait possible');
});
t('vérification de 9712cb0 : caractères de format et ignorables retirés (200E, 200F, 202A, 2061, 034F, 180E, FE0F) — propriétés Unicode ET classe de secours, équivalentes', async () => {
  const CAS = ['‎', '‏', '‪', '⁡', '͏', '᠎', '️'];
  for (const secours of [false, true]) {
    const { ctx, log } = essaiBac();
    if (secours) ctx.INVISIBLES_ = ctx.INVISIBLES_SECOURS_;
    for (const c of CAS) for (const x of ['Label_E' + c, c + 'Matrice-essai', 'Matrice' + c + '-essai'])
      assert.match(appel(ctx, await signe({ thread_id: 'aa01aa01aa01aa01', remove: [x] }, 'modify')).error || '', /ne se retire pas/, (secours ? 'secours ' : '') + JSON.stringify(x));
    assert.equal(log.modified.length, 0);
  }
  const { ctx } = essaiBac();
  const prop = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u, sec = new RegExp(ctx.INVISIBLES_SECOURS_.source, 'u');
  let diff = 0;
  for (let c = 0; c <= 0x10FFFF; c++) { if (c >= 0xD800 && c <= 0xDFFF) continue; const ch = String.fromCodePoint(c); if (prop.test(ch) !== sec.test(ch)) diff++; }
  assert.equal(diff, 0, 'classe de secours identique aux propriétés Unicode');
});
t('mode essai mal configuré → TOUT bloqué (libellé absent, inexistant, système ; destinataires absents)', async () => {
  for (const props of [{ MODE_ESSAI: 'oui' }, { ...ESSAI, LIBELLE_ESSAI: 'Inexistant' }, { ...ESSAI, LIBELLE_ESSAI: 'INBOX' }, { ...ESSAI, DESTINATAIRES_ESSAI: '' }]) {
    const { ctx, log } = essaiBac({ props });
    for (const [a, p] of [...ACTIONS_BOITE, ['mail_by_msgid', { message_id: '<x@y.fr>' }]]) {
      const r = appel(ctx, await signe(p, a));
      assert.equal(r.refused, true, a + ' ' + JSON.stringify(props)); assert.match(r.error, /Mode essai/);
    }
    assert.match(appel(ctx, { action: 'mail', secret: 'secret-essai', to: 'colbe.essai@example.net', subject: 'x', html: 'x' }).error, /Mode essai/);
    assert.equal(log.created.length + log.modified.length + log.historyCalls, 0);
    assert.ok(appel(ctx, { action: 'ping', secret: 'secret-essai' }).mode_essai.startsWith('Mode essai'));
  }
});
t('mode essai : recherche par Message-ID (Apple Mail) limitée au libellé ; mail-sync refuse un script hors mode essai', async () => {
  const { ctx, log } = essaiBac();
  const r = appel(ctx, await signe({ message_id: '<h1@example.org>' }, 'mail_by_msgid'));
  assert.equal(r.found, false); assert.deepEqual(log.searches, ['rfc822msgid:h1@example.org label:"Matrice-essai"']);
  assert.equal(essaiOk({ essai: { libelle: 'Matrice-essai', id: 'Label_E' } }, 'Matrice-essai'), true);
  assert.equal(essaiOk({}, 'Matrice-essai'), false);
  assert.equal(essaiOk({ essai: { libelle: 'Autre', id: 'X' } }, 'Matrice-essai'), false);
  assert.equal(essaiOk({}, ''), true);
  assert.deepEqual(threadsEssai([{ id: 'a', labels: ['Label_E'] }, { id: 'b', labels: ['INBOX'] }, { id: 'c', missing: true }], 'Label_E').map((x) => x.id), ['a']);
});

let ok = 0;
for (const [nom, f] of cas) {
  try { await f(); ok++; console.log('  ✓ ' + nom); }
  catch (e) { console.error('  ✘ ' + nom + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 14).join('\n    ')); }
}
console.log(`Messagerie (règles serveur et script Google simulé) : ${ok}/${cas.length} cas vérifiés.`);
if (ok !== cas.length) process.exit(1);
