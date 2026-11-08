// v1.60.4 — décision d'Anthony du 08/11/2026 : la recherche par Message-ID dans la boîte anthony@ (script de prospection) est
// réservée à son titulaire ; is_team ne suffit pas, connaître un Message-ID (ou le code secret des scripts) n'autorise pas à
// consulter la boîte. production@ garde les droits d'équipe. Relecture de 3ca7f59 (B1) : signature avec une CLÉ DÉDIÉE jamais
// transmise (mailbox_sign_key → propriété CLE_BOITE), sur adresse + action + Message-ID + horodatage, fenêtre de 5 minutes,
// signature à usage unique. Vrai code du relais (identite.ts) et des deux scripts (exécutés avec des services Google simulés).
// Adresses, clés et codes fictifs ; aucun appel réel.
// Usage : node --experimental-strip-types --no-warnings static/acces-boite.mjs
import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { callerSig, outgoingBody } = await import(join(ROOT, 'supabase/functions/script-google/identite.ts'));
const problems = [];
const fail = msg => problems.push(msg);
const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} : obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)}`); };

const SECRET = 'secret-fictif-des-scripts';          // code secret des scripts (WEBHOOK_SECRET), partagé et transmis à chaque appel
const KEY = 'cle-dediee-fictive-de-la-boite';        // clé dédiée (mailbox_sign_key / CLE_BOITE), jamais transmise
const ANTHONY = 'titulaire@exemple-fictif.fr', AUTRE = 'collegue@exemple-fictif.fr';
const IDA = '<a-fictif-0001@exemple-fictif.fr>', IDB = '<b-fictif-0002@exemple-fictif.fr>';
const DEP = 'AKfycbFICTIF-anthony_0001', OTHER = 'AKfycbFICTIF-detourne_0002';
const URL_PERSO = `https://script.google.com/macros/s/${DEP}/exec`, URL_WS = `https://script.google.com/a/macros/exemple-fictif.fr/s/${DEP}/exec`;

/** Script Google réel, compte d'exécution « owner » ; GmailApp simulé (renvoie le message demandé) ; cache partagé si fourni */
function script(file, owner, { key = KEY, cache = {}, selfUrl = URL_WS, lock = { ok: true, log: [] } } = {}){
  const searches = [];
  const props = { WEBHOOK_SECRET: SECRET, ...(key ? { CLE_BOITE: key } : {}) };
  const msg = id => ({ getHeader: () => id, isDraft: () => false, getRawContent: () => `Message-ID: ${id}\r\n\r\nx`, getSubject: () => 'Fictif', getFrom: () => 'x@exemple-fictif.fr', getDate: () => new Date('2026-11-03T09:00:00Z') });
  const ctx = { Logger: { log() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
    GmailApp: { search: q => { searches.push(q); return [{ getMessages: () => [msg('<' + q.replace('rfc822msgid:', '') + '>')] }]; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, getProperties: () => props }) },
    CacheService: { getScriptCache: () => ({ get: k => { lock.log.push('get' + (lock.held ? '' : ' HORS VERROU')); return cache[k] ?? null; }, put: (k, v) => { lock.log.push('put' + (lock.held ? '' : ' HORS VERROU')); cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: ms => { lock.log.push('tryLock'); lock.wait = ms; lock.held = lock.ok; return lock.ok; }, releaseLock: () => { lock.log.push('release'); lock.held = false; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => { if (selfUrl instanceof Error) throw selfUrl; return selfUrl; } }) },
    ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    // même calcul que Google : octets signés (-128…127)
    Utilities: { formatDate: () => '', Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v).digest()].map(b => (b > 127 ? b - 256 : b)) } };
  vm.createContext(ctx); vm.runInContext(readFileSync(join(ROOT, file), 'utf8'), ctx);
  return body => { const n = searches.length; const out = JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }));
    return { ok: out.ok, found: out.found === true, refused: out.refused === true, searched: searches.length - n, error: out.error || '' }; };
}
const relay = (email, id = IDA, now = Date.now(), extra = {}, url = URL_PERSO) => outgoingBody({ message_id: id, ...extra }, 'mail_by_msgid', SECRET, email, KEY, url, now);
const ACCEPTED = { ok: true, found: true, refused: false, searched: 1, error: '' };
const isRefused = r => [r.ok, r.refused, r.searched, /rien n’a été consulté/.test(r.error)];

// 1. Relais : la clé dédiée n'est jamais transmise ; signature = HMAC(clé, adresse|action|Message-ID|horodatage)
{
  const body = JSON.parse(await relay(' Titulaire@Exemple-Fictif.fr ', IDA, 1_800_000_000_000));
  eq('relais : corps envoyé', [body.caller, body.caller_ts, body.action], [ANTHONY, 1_800_000_000_000, 'mail_by_msgid']);
  eq('relais : signature (destinataire = identifiant de déploiement)', body.caller_sig, createHmac('sha256', KEY).update(['matrice-boite-v2', ANTHONY, 'mail_by_msgid', IDA, '1800000000000', DEP].join('|')).digest('hex'));
  const { deploymentId } = await import(join(ROOT, 'supabase/functions/script-google/identite.ts'));
  eq('relais : identifiant de déploiement (variantes d’adresse)', [deploymentId(URL_PERSO), deploymentId(URL_WS), deploymentId(URL_PERSO + '?x=1'), deploymentId('https://exemple.fr/macros/s/X/exec'), deploymentId('')], [DEP, DEP, DEP, '', '']);
  eq('relais : adresse illisible, aucune signature', JSON.parse(await outgoingBody({ message_id: IDA }, 'mail_by_msgid', SECRET, ANTHONY, KEY, 'https://exemple.fr/x')).caller_sig, '');
  if (JSON.stringify(body).includes(KEY)) fail('relais : la clé dédiée ne doit jamais figurer dans une requête');
  const forged = JSON.parse(await relay(AUTRE, IDA, Date.now(), { caller: ANTHONY, caller_sig: 'x', caller_ts: 1, secret: 'y', action: 'ping' }));
  eq('relais : le navigateur ne remplace ni l’identité ni sa signature', [forged.caller, forged.action, forged.secret, forged.caller_sig === await callerSig(KEY, AUTRE, 'mail_by_msgid', IDA, forged.caller_ts, DEP)], [AUTRE, 'mail_by_msgid', SECRET, true]);
  eq('relais : sans clé dédiée, aucune signature', JSON.parse(await outgoingBody({ message_id: IDA }, 'mail_by_msgid', SECRET, ANTHONY, '', URL_PERSO)).caller_sig, '');
  const src = readFileSync(join(ROOT, 'supabase/functions/script-google/index.ts'), 'utf8');
  if (!/user\.auth\.getUser\(jwt\)/.test(src) || !/import_secret', \{ k: 'mailbox_sign_key' \}/.test(src) || !/outgoingBody\(payload, body\.action, secret, email, String\(signKey \|\| ''\), url\)/.test(src) || !/body: outgoing,/.test(src))
    fail('relais script-google : adresse de la session vérifiée (getUser), clé dédiée lue par import_secret, corps signé (outgoingBody)');
  if (src.indexOf("rpc('is_team')") < 0 || src.indexOf("rpc('is_team')") > src.indexOf('getUser(jwt)')) fail('relais script-google : is_team doit rester vérifié avant tout');
  const mig = readFileSync(join(ROOT, 'supabase/migrations/2026-11-08_v1.60.4_cle_boite.sql'), 'utf8');
  if (!/'mailbox_sign_key'/.test(mig) || !/on conflict \(key\) do nothing/.test(mig) || /on conflict \(key\) do update/.test(mig)) fail('migration cle_boite : clé créée une seule fois, jamais régénérée');
}

// 2. Boîte anthony@ (Prospection.gs) : seul son titulaire, via le relais, au moment de la demande, une seule fois
const P = 'apps-script/Prospection.gs';
{
  const run = script(P, ANTHONY);
  eq('titulaire accepté', run(await relay(ANTHONY)), ACCEPTED);
  eq('titulaire, adresse en majuscules', run(await relay('TITULAIRE@exemple-fictif.fr', IDB)).found, true);
}
{
  const run = script(P, ANTHONY), now = Date.now();
  const captured = JSON.parse(await relay(ANTHONY, IDA, now));
  const cases = {
    'autre membre de l’équipe (via le relais)': await relay(AUTRE),
    'appel direct avec le code secret des scripts (ancienne signature)': { action: 'mail_by_msgid', secret: SECRET, message_id: IDA, caller: ANTHONY, caller_ts: now, caller_sig: createHmac('sha256', SECRET).update('matrice-caller:' + ANTHONY).digest('hex') },
    'appel direct, signature faite avec le code secret des scripts': { action: 'mail_by_msgid', secret: SECRET, message_id: IDA, caller: ANTHONY, caller_ts: now, caller_sig: await callerSig(SECRET, ANTHONY, 'mail_by_msgid', IDA, now, DEP) },
    'signature destinée à un autre script (adresse de prospection détournée)': await relay(ANTHONY, IDA, now, {}, `https://script.google.com/macros/s/${OTHER}/exec`),
    'rejeu sur un autre Message-ID': { ...captured, message_id: IDB },
    'rejeu avec un autre horodatage': { ...captured, caller_ts: now + 1 },
    'horodatage expiré (6 minutes)': await relay(ANTHONY, IDA, now - 6 * 60 * 1000),
    'horodatage dans le futur (6 minutes)': await relay(ANTHONY, IDA, now + 6 * 60 * 1000),
    'ancien relais (aucune identité)': { action: 'mail_by_msgid', secret: SECRET, message_id: IDA },
    'signature en majuscules': { ...captured, caller_sig: captured.caller_sig.toUpperCase() },
    'adresse non texte': { ...captured, caller: [ANTHONY] },
  };
  for (const [label, body] of Object.entries(cases)) eq(`refusé : ${label}`, isRefused(run(body)), [false, true, 0, true]);
  // même demande signée rejouée telle quelle : acceptée une fois, refusée ensuite
  eq('première utilisation acceptée', run(captured).found, true);
  eq('rejeu à l’identique refusé', isRefused(run(captured)), [false, true, 0, true]);
}
{
  eq('propriété CLE_BOITE absente : refusé, message clair', (r => [r.refused, r.searched, /CLE_BOITE/.test(r.error)])(script(P, ANTHONY, { key: '' })(await relay(ANTHONY))), [true, 0, true]);
  eq('autre clé que celle du relais : refusé', isRefused(script(P, ANTHONY, { key: 'autre-cle' })(await relay(ANTHONY))), [false, true, 0, true]);
  eq('ping inchangé (sans identité)', script(P, ANTHONY)({ action: 'ping', secret: SECRET }).ok, true);
}
// destinataire : même déploiement sous ses deux formes d'adresse accepté ; adresse propre illisible → refus
{
  eq('relais en adresse Workspace, script en adresse personnelle', script(P, ANTHONY, { selfUrl: URL_PERSO })(await relay(ANTHONY, IDA, Date.now(), {}, URL_WS)), ACCEPTED);
  eq('adresse propre du script illisible : refusé', isRefused(script(P, ANTHONY, { selfUrl: new Error('indisponible') })(await relay(ANTHONY))), [false, true, 0, true]);
}
// usage unique atomique : lecture et écriture du cache sous verrou, verrou rendu ; verrou indisponible → refus propre, rien consulté
{
  const lock = { ok: true, log: [] };
  eq('verrou : accepté', script(P, ANTHONY, { lock })(await relay(ANTHONY)), ACCEPTED);
  eq('verrou : get et put entre la prise et la remise', lock.log, ['tryLock', 'get', 'put', 'release']);
  if (!(lock.wait > 0 && lock.wait <= 5000)) fail(`verrou : attente courte attendue (obtenu ${lock.wait} ms)`);
  const busy = { ok: false, log: [] }, r = script(P, ANTHONY, { lock: busy })(await relay(ANTHONY));
  eq('verrou indisponible : refus propre, cache non touché', [r.ok, r.refused, r.searched, /occupé : réessaie/.test(r.error), busy.log], [false, true, 0, true, ['tryLock']]);
}

// 3. production@ (Code.gs) : droits d'équipe inchangés — tout membre de l'équipe accepté, aucun lien avec anthony@
{
  const run = script('apps-script/Code.gs', 'production@exemple-fictif.fr', { key: '' });
  for (const [label, body] of [['autre membre', await relay(AUTRE)], ['titulaire d’anthony@', await relay(ANTHONY, IDB)], ['sans identité (ancien relais)', { action: 'mail_by_msgid', secret: SECRET, message_id: IDA }]])
    eq(`production@ : ${label}`, run(body), ACCEPTED);
  eq('production@ : code secret faux', run({ action: 'mail_by_msgid', secret: 'faux', message_id: IDA }).searched, 0);
}

console.log('Accès aux boîtes Google (v1.60.4) : clé dédiée jamais transmise, anthony@ réservé à son titulaire (5 min, usage unique), production@ inchangé.');
if (problems.length) { console.error(`\n${problems.length} problème(s) :\n` + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('✓ Aucun problème.');
