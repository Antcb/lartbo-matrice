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
import { acces, messageRows, same, scriptUrlOk, threadIds, threadRow } from '../../supabase/functions/mail-sync/regles.ts';

const cas = [];
const t = (nom, f) => cas.push([nom, f]);
const J = (x) => JSON.parse(JSON.stringify(x));   // valeurs venues du bac à sable du script (autre contexte JavaScript)

// ── 1. Règles de la fonction serveur ─────────────────────────────────────────────────────────────────────────────────
t('accès : sans justificatif, faux secret, secret vide → 403', () => {
  assert.equal(acces({ hook: '', hookSecret: 'abc', team: false, mode: 'sync' }).status, 403);
  assert.equal(acces({ hook: 'faux', hookSecret: 'abc', team: false, mode: 'sync' }).status, 403);
  assert.equal(acces({ hook: '', hookSecret: '', team: false, mode: 'sync' }).status, 403);
  assert.equal(acces({ hook: 'abc', hookSecret: null, team: false, mode: 'sync' }).status, 403);
});
t('accès : secret dédié → synchronisation planifiée seulement ; relire des conversations précises → équipe', () => {
  assert.equal(acces({ hook: 'abc', hookSecret: 'abc', team: false, mode: 'sync' }).ok, true);
  assert.equal(acces({ hook: 'abc', hookSecret: 'abc', team: false, mode: 'threads' }).status, 403);
  assert.equal(acces({ hook: '', hookSecret: 'abc', team: true, mode: 'threads' }).ok, true);
  assert.equal(same('abc', 'abd'), false); assert.equal(same('abc', 'abc'), true);
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
function bac({ threads = {}, history = null, historyError = false, driveFiles = {}, urls = {}, sendNoId = false, updateFails = false } = {}) {
  const log = { created: [], updated: [], sent: [], modified: [], trashed: [], untrashed: [], fetched: [] };
  const hdrs = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
  const Gmail = { Users: {
    Threads: {
      get: (_me, id) => { if (!threads[id]) throw new Error('Not Found'); return JSON.parse(JSON.stringify(threads[id])); },
      list: () => ({ threads: Object.keys(threads).map((id) => ({ id })) }),
      modify: (req, _me, id) => { log.modified.push({ id, ...req }); return { messages: [{ labelIds: ['INBOX'] }] }; },
      trash: (_me, id) => { log.trashed.push(id); }, untrash: (_me, id) => { log.untrashed.push(id); },
    },
    Drafts: {
      create: (req) => { log.created.push(req); return { id: 'dr-' + log.created.length, message: { id: 'msg-d', threadId: req.message.threadId || 'neuf' } }; },
      update: (req, _me, id) => { if (updateFails) throw new Error('Requested entity was not found.'); log.updated.push({ id, req }); return { id, message: { id: 'msg-d', threadId: req.message.threadId || 'neuf' } }; },
      send: (req) => { log.sent.push(req.id); return sendNoId ? {} : { id: 'envoye-1', threadId: 'th-envoi' }; },
    },
    History: { list: () => { if (historyError) throw new Error('historyId expiré'); return history || { history: [] }; } },
    Labels: { list: () => ({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_1', name: 'Booking 2027', type: 'user' }] }) },
    Messages: { Attachments: { get: () => ({ size: 10, data: 'eA' }) } },
    getProfile: () => ({ historyId: '999' }),
  } };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'secret-essai' }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => ME }) },
    ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    Logger: { log() {} },
    Utilities: {
      base64Encode: (x) => b64(x), base64EncodeWebSafe: (x) => Buffer.from(x).toString('base64url'),
      base64DecodeWebSafe: (s) => Buffer.from(s, 'base64url'), Charset: { UTF_8: 'UTF-8' },
      newBlob: (x) => blob(typeof x === 'string' ? Buffer.from(x, 'utf8') : x),
      formatDate: () => '08/11/2026 à 09:00',
    },
    UrlFetchApp: { fetch: (u) => { log.fetched.push(u); if (!urls[u]) throw new Error('404'); return { getBlob: () => blob(urls[u], 'x', 'application/pdf') }; } },
    DriveApp: { getFileById: (id) => { const f = driveFiles[id]; if (!f) throw new Error('Accès refusé');
      return { getBlob: () => blob(f.bytes, f.name, 'application/pdf'), getSize: () => f.size ?? f.bytes.length, getName: () => f.name, getMimeType: () => 'application/pdf' }; } },
    GmailApp: { getMessageById: () => ({ getAttachments: () => [blob(Buffer.alloc(100), 'origine.pdf', 'application/pdf')] }) },
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

let ok = 0;
for (const [nom, f] of cas) {
  try { f(); ok++; console.log('  ✓ ' + nom); }
  catch (e) { console.error('  ✘ ' + nom + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 14).join('\n    ')); }
}
console.log(`Messagerie (règles serveur et script Google simulé) : ${ok}/${cas.length} cas vérifiés.`);
if (ok !== cas.length) process.exit(1);
