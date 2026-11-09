// v1.60.7 — décision d'Anthony du 09/11/2026 : un mail glissé depuis Apple Mail importe toute sa CONVERSATION Gmail (reçus et envoyés).
// Vrai code des deux scripts Google (action « thread_by_msgid »), exécuté avec des services Google simulés qui relèvent tout appel
// autre qu'une lecture. Conversation fictive : 3 messages (dont 1 envoyé), puis une 4e réponse ; brouillon exclu ; passes au-delà de
// 20 Mo ; message trop lourd ; conversation choisie par son identifiant Gmail, jamais par l'objet ; titulaire seul pour anthony@.
// Usage : node --experimental-strip-types --no-warnings static/conversation.mjs
import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { outgoingBody } = await import(join(ROOT, 'supabase/functions/script-google/identite.ts'));
const problems = [];
const fail = m => problems.push(m);
const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} : obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)}`); };

const SECRET = 'secret-fictif', KEY = 'cle-fictive', OWNER = 't1@exemple-fictif.fr', T2 = 't2@exemple-fictif.fr', AUTRE = 'collegue@exemple-fictif.fr';
const msg = (n, from, to, date, extra = {}) => ({ gid: '18f0000000000a0' + n, mid: `<test-${n}@exemple-fictif.fr>`, subject: n === 1 ? 'TEST conversation' : 'Re: TEST conversation',
  from, to, cc: n === 3 ? 'copie@exemple-fictif.fr' : '', date, raw: `Message-ID: <test-${n}@exemple-fictif.fr>\r\nSubject: TEST\r\n\r\nMessage ${n}`, ...extra });
const M1 = msg(1, OWNER, T2, '2026-11-09T09:00:00Z'), M2 = msg(2, T2, OWNER, '2026-11-09T10:00:00Z', { att: 2 }), M3 = msg(3, OWNER, T2, '2026-11-09T11:00:00Z');   // M1, M3 envoyés
const M4 = msg(4, T2, OWNER, '2026-11-09T12:00:00Z');
const DRAFT = msg(9, OWNER, T2, '2026-11-09T13:00:00Z', { draft: true });
// autre conversation de même objet : jamais mêlée
const OTHER = { gid: '18f0000000000b01', mid: '<autre-1@exemple-fictif.fr>', subject: 'Re: TEST conversation', from: T2, to: OWNER, cc: '', date: '2026-11-09T09:30:00Z', raw: 'x' };

/** Script réel ; boîte simulée : conversations { id: [messages] } ; relevé des recherches, des contenus lus et des appels interdits */
function script(file, owner, threads){
  const log = { searches: [], raws: [], forbidden: [] };
  const guard = (obj, what) => new Proxy(obj, { get(t, k) { if (typeof k === 'symbol') return t[k];
    if (!(k in t)) { log.forbidden.push(`${what}.${String(k)}`); return () => { throw new Error(`appel interdit ${what}.${String(k)}`); }; } return t[k]; } });
  const threadObj = id => guard({ getId: () => id, getMessages: () => threads[id].map(message(id)) }, 'conversation');
  const message = tid => m => guard({ getId: () => m.gid, getHeader: h => /^message-id$/i.test(h) ? m.mid : '', isDraft: () => !!m.draft,
    getSubject: () => m.subject, getFrom: () => m.from, getTo: () => m.to, getCc: () => m.cc, getDate: () => new Date(m.date),
    getThread: () => threadObj(tid), getRawContent: () => { log.raws.push(m.gid); return m.raw; },
    getAttachments: o => { if (!o || o.includeInlineImages !== false) log.forbidden.push('getAttachments sans includeInlineImages:false'); return Array(m.att || 0).fill({}); } }, 'message');
  const GmailApp = guard({ search: (q, a, b) => { log.searches.push(q); const mid = '<' + q.replace('rfc822msgid:', '') + '>';
    return Object.keys(threads).filter(id => threads[id].some(m => m.mid === mid)).map(threadObj); } }, 'GmailApp');
  const props = { WEBHOOK_SECRET: SECRET, CLE_BOITE: KEY }, cache = {};
  const ctx = { GmailApp, Logger: { log() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, getProperties: () => props }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    Utilities: { formatDate: () => '', Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v).digest()].map(b => (b > 127 ? b - 256 : b)) } };
  vm.createContext(ctx); vm.runInContext(readFileSync(join(ROOT, file), 'utf8'), ctx);
  return { log, call: body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })) };
}
const P = 'apps-script/Prospection.gs', C = 'apps-script/Code.gs';
let tick = 0;   // chaque demande du relais a son horodatage (usage unique de la signature)
const ask = (email, payload, target = 'prospect') => outgoingBody(payload, 'thread_by_msgid', SECRET, email, KEY, Date.now() + (tick++), target);

for (const [name, file, signed] of [['anthony@ (Prospection.gs)', P, true], ['production@ (Code.gs)', C, false]]){
  const body = async payload => signed ? await ask(OWNER, payload) : { ...payload, action: 'thread_by_msgid', secret: SECRET };
  // 1. conversation de 3 messages (dont 1 envoyé) + un brouillon + une autre conversation de même objet ; dépôt du message 2
  let s = script(file, OWNER, { t1: [M3, M1, DRAFT, M2], t2: [OTHER] });
  let r = s.call(await body({ message_id: M2.mid }));
  eq(`${name} : description de la conversation (ordre chronologique, brouillon exclu, sans contenu)`,
    [r.ok, r.found, r.thread_id, r.messages.map(m => m.gmail_id), r.messages.every(m => !('raw' in m)), s.log.raws, r.truncated],
    [true, true, 't1', ['18f0000000000a01', '18f0000000000a02', '18f0000000000a03'], true, [], false]);
  eq(`${name} : champs de chaque message`, r.messages[2], { gmail_id: '18f0000000000a03', message_id: M3.mid, subject: M3.subject, from: OWNER, to: T2, cc: 'copie@exemple-fictif.fr', date: '2026-11-09T11:00:00.000Z', att: 0 });
  eq(`${name} : nombre de pièces jointes (images intégrées exclues)`, r.messages[1].att, 2);
  eq(`${name} : une seule recherche, par l'identifiant exact`, s.log.searches, ['rfc822msgid:test-2@exemple-fictif.fr']);
  // 2. contenus demandés : seulement ceux de CETTE conversation et demandés (l'autre conversation et un identifiant inventé : ignorés)
  r = s.call(await body({ message_id: M2.mid, want: ['18f0000000000a01', '18f0000000000a02', '18f0000000000a03', '18f0000000000b01', 'zz'] }));
  eq(`${name} : contenus (.eml) des messages demandés`, [r.messages.map(m => typeof m.raw === 'string'), s.log.raws.sort(), r.rest], [[true, true, true], ['18f0000000000a01', '18f0000000000a02', '18f0000000000a03'], []]);
  // 3. 4e réponse arrivée : la même conversation en a 4 ; un nouveau dépôt (même d'un message déjà importé) la retrouve entière
  s = script(file, OWNER, { t1: [M1, M2, M3, M4] });
  r = s.call(await body({ message_id: M1.mid }));
  eq(`${name} : 4e réponse visible, conversation entière depuis un message déjà importé`, r.messages.map(m => m.gmail_id), ['18f0000000000a01', '18f0000000000a02', '18f0000000000a03', '18f0000000000a04']);
  r = s.call(await body({ message_id: M1.mid, want: ['18f0000000000a04'] }));
  eq(`${name} : seul le message manquant est lu`, [r.messages.filter(m => m.raw).map(m => m.gmail_id), s.log.raws], [['18f0000000000a04'], ['18f0000000000a04']]);
  // 4. plus de 20 Mo : passes successives ; un message seul de plus de 20 Mo est signalé, jamais renvoyé
  const big = n => ({ ...msg(n, T2, OWNER, `2026-11-09T1${n}:00:00Z`), raw: 'x'.repeat(12 * 1024 * 1024) });
  s = script(file, OWNER, { t3: [big(1), big(2), { ...big(3), raw: 'y'.repeat(21 * 1024 * 1024) }] });
  r = s.call(await body({ message_id: '<test-1@exemple-fictif.fr>', want: ['18f0000000000a01', '18f0000000000a02', '18f0000000000a03'] }));
  eq(`${name} : 20 Mo au plus par appel, le reste à la passe suivante`, [r.messages.map(m => !!m.raw), r.rest, r.messages[2].too_big], [[true, false, false], ['18f0000000000a02'], 21]);
  // 4b. (relecture de 0e9d3cc, B1) conversation de 150 messages : les 99 plus récents ET toujours le message glissé, dans l'ordre
  const many = Array.from({ length: 150 }, (_, i) => ({ ...msg(i + 1, i % 2 ? T2 : OWNER, i % 2 ? OWNER : T2, new Date(Date.UTC(2026, 10, 1) + i * 3600e3).toISOString()),
    gid: '18f00000' + String(i + 1).padStart(8, '0'), mid: `<long-${i + 1}@exemple-fictif.fr>` }));
  s = script(file, OWNER, { tL: [...many].reverse() });
  r = s.call(await body({ message_id: '<long-4@exemple-fictif.fr>' }));
  eq(`${name} : 150 messages, dépôt du 4e : lui + les 99 plus récents, ordre chronologique`,
    [r.found, r.truncated, r.total, r.messages.length, r.messages[0].message_id, r.messages[1].message_id, r.messages[99].message_id],
    [true, true, 150, 100, '<long-4@exemple-fictif.fr>', '<long-52@exemple-fictif.fr>', '<long-150@exemple-fictif.fr>']);
  r = s.call(await body({ message_id: '<long-140@exemple-fictif.fr>' }));
  eq(`${name} : 150 messages, dépôt d'un récent : les 100 plus récents`, [r.messages.length, r.messages[0].message_id, r.total], [100, '<long-51@exemple-fictif.fr>', 150]);
  // 5. absent ; identifiant invalide refusé sans recherche ; aucun appel hors lecture
  s = script(file, OWNER, { t1: [M1] });
  eq(`${name} : message absent`, s.call(await body({ message_id: '<absent@exemple-fictif.fr>' })), { ok: true, found: false });
  r = s.call(await body({ message_id: 'pas-un-identifiant' }));
  eq(`${name} : identifiant invalide`, [r.ok, s.log.searches.length], [false, 1]);
  eq(`${name} : aucun appel hors lecture`, s.log.forbidden, []);
  // 6. même Message-ID dans deux conversations différentes : refusé (jamais un choix au hasard)
  s = script(file, OWNER, { t1: [M1], t9: [{ ...M1, gid: '18f0000000000c01' }] });
  r = s.call(await body({ message_id: M1.mid }));
  eq(`${name} : identifiant présent dans deux conversations`, [r.ok, /Plusieurs conversations/.test(r.error || '')], [false, true]);
}

// 7. anthony@ : titulaire seulement (signature v2), demande signée pour « main » refusée ; production@ : équipe
{
  const s = script(P, OWNER, { t1: [M1, M2, M3] });
  for (const [label, b] of [['autre membre', await ask(AUTRE, { message_id: M1.mid })], ['demande signée pour main', await ask(OWNER, { message_id: M1.mid }, 'main')],
    ['ancien relais (sans identité)', { action: 'thread_by_msgid', secret: SECRET, message_id: M1.mid }]]){
    const r = s.call(b);
    eq(`anthony@ refusé : ${label}`, [r.ok, r.refused, 'messages' in r], [false, true, false]);
  }
  eq('anthony@ : aucune recherche pour un refus', s.log.searches, []);
  const c = script(C, 'production@exemple-fictif.fr', { t1: [M1, M2] });
  eq('production@ : membre de l’équipe accepté', c.call(await ask(AUTRE, { message_id: M1.mid }, 'main')).found, true);
}

console.log('Conversation (v1.60.7) : 3 messages dont 1 envoyé, 4e réponse, passes de 20 Mo, deux scripts exécutés avec services simulés.');
if (problems.length) { console.error(`\n${problems.length} problème(s) :\n` + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('✓ Aucun problème.');
