// v1.60.4 — décision d'Anthony du 08/11/2026 : la recherche par Message-ID dans la boîte anthony@ (script de prospection) est
// réservée à son titulaire ; is_team ne suffit pas, connaître un Message-ID n'autorise pas à consulter la boîte. production@ garde
// les droits d'équipe. Contrôle côté serveur : le relais script-google signe l'adresse du compte connecté (identite.ts, vrai code
// du relais) ; le script vérifie la signature et la compare au compte Google qui l'exécute (Prospection.gs, vrai code exécuté
// avec des services Google simulés). Adresses fictives, code secret fictif, aucun appel réel.
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

const SECRET = 'secret-fictif-de-test';
const ANTHONY = 'titulaire@exemple-fictif.fr', AUTRE = 'collegue@exemple-fictif.fr';   // titulaire de la boîte / autre membre de l'équipe
const ID = '<abc-fictif-0001@exemple-fictif.fr>';
const RAW = `From: x@exemple-fictif.fr\r\nSubject: Fictif\r\nMessage-ID: ${ID}\r\n\r\nTexte\r\n`;

/** Exécute un script Google (vrai code) dont le compte d'exécution est « owner » ; GmailApp simulé, recherches relevées */
function runScript(file, owner, bodyJson){
  const searches = [];
  const msg = { getHeader: () => ID, isDraft: () => false, getRawContent: () => RAW, getSubject: () => 'Fictif', getFrom: () => 'x@exemple-fictif.fr', getDate: () => new Date('2026-11-03T09:00:00Z') };
  const props = { WEBHOOK_SECRET: SECRET };
  const ctx = { Logger: { log() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
    GmailApp: { search: q => { searches.push(q); return [{ getMessages: () => [msg] }]; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], getProperties: () => props }) },
    ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    // même calcul que Google : octets signés (-128…127)
    Utilities: { formatDate: () => '', Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v).digest()].map(b => (b > 127 ? b - 256 : b)) } };
  vm.createContext(ctx); vm.runInContext(readFileSync(join(ROOT, file), 'utf8'), ctx);
  const out = JSON.parse(ctx.doPost({ postData: { contents: bodyJson } }));
  return { ok: out.ok, found: out.found === true, refused: out.refused === true, searches: searches.length, error: out.error || '' };
}
const ask = email => outgoingBody({ message_id: ID }, 'mail_by_msgid', SECRET, email);

// 1. Relais : signature identique au calcul attendu ; ni l'identité ni sa signature ne peuvent venir du navigateur
eq('signature du relais', await callerSig(SECRET, ' Titulaire@Exemple-Fictif.fr '), createHmac('sha256', SECRET).update('matrice-caller:' + ANTHONY).digest('hex'));
const forged = JSON.parse(await outgoingBody({ message_id: ID, caller: ANTHONY, caller_sig: 'falsifiée', secret: 'x', action: 'ping' }, 'mail_by_msgid', SECRET, AUTRE));
eq('demande du navigateur qui se fait passer pour le titulaire', [forged.caller, forged.action, forged.secret, forged.caller_sig === createHmac('sha256', SECRET).update('matrice-caller:' + AUTRE).digest('hex')], [AUTRE, 'mail_by_msgid', SECRET, true]);
const relay = readFileSync(join(ROOT, 'supabase/functions/script-google/index.ts'), 'utf8');
if (!/user\.auth\.getUser\(jwt\)/.test(relay) || !/outgoingBody\(payload, body\.action, secret, email\)/.test(relay) || !/body: outgoing,/.test(relay))
  fail('relais script-google : l’adresse doit venir de la session vérifiée (getUser) et partir signée (outgoingBody)');
if (relay.indexOf("rpc('is_team')") < 0 || relay.indexOf("rpc('is_team')") > relay.indexOf('getUser(jwt)')) fail('relais script-google : is_team doit rester vérifié avant tout');

// 2. Boîte anthony@ (Prospection.gs) : seul son titulaire est accepté, côté script
const P = 'apps-script/Prospection.gs';
eq('titulaire accepté', runScript(P, ANTHONY, await ask(ANTHONY)), { ok: true, found: true, refused: false, searches: 1, error: '' });
eq('titulaire, adresse en majuscules', runScript(P, ANTHONY, await ask('TITULAIRE@exemple-fictif.fr')).found, true);
const refusals = {
  'autre membre de l’équipe': await ask(AUTRE),
  'navigateur qui se fait passer pour le titulaire': await outgoingBody({ message_id: ID, caller: ANTHONY, caller_sig: 'x' }, 'mail_by_msgid', SECRET, AUTRE),
  'ancien relais (aucune identité)': JSON.stringify({ message_id: ID, action: 'mail_by_msgid', secret: SECRET }),
  'signature fausse': JSON.stringify({ message_id: ID, action: 'mail_by_msgid', secret: SECRET, caller: ANTHONY, caller_sig: '00'.repeat(32) }),
  'signature d’un autre code secret': JSON.stringify({ message_id: ID, action: 'mail_by_msgid', secret: SECRET, caller: ANTHONY, caller_sig: await callerSig('autre-secret', ANTHONY) }),
};
for (const [label, body] of Object.entries(refusals)){
  const r = runScript(P, ANTHONY, body);
  eq(`refusé : ${label}`, [r.ok, r.refused, r.searches, /réservée à son titulaire/.test(r.error)], [false, true, 0, true]);
}
// les autres actions du script de prospection ne changent pas (ping sans identité)
eq('ping inchangé', runScript(P, ANTHONY, JSON.stringify({ action: 'ping', secret: SECRET })).ok, true);

// 3. production@ (Code.gs) : droits d'équipe inchangés — tout membre de l'équipe passé par le relais est accepté
const C = 'apps-script/Code.gs';
for (const [label, body] of [['autre membre', await ask(AUTRE)], ['titulaire d’anthony@', await ask(ANTHONY)], ['sans identité (ancien relais)', JSON.stringify({ message_id: ID, action: 'mail_by_msgid', secret: SECRET })]])
  eq(`production@ : ${label}`, runScript(C, 'production@exemple-fictif.fr', body), { ok: true, found: true, refused: false, searches: 1, error: '' });
// et sans le code secret, toujours rien
eq('production@ : code secret faux', runScript(C, 'production@exemple-fictif.fr', JSON.stringify({ message_id: ID, action: 'mail_by_msgid', secret: 'faux' })).searches, 0);

console.log('Accès aux boîtes Google (v1.60.4) : relais signé, anthony@ réservé à son titulaire, production@ inchangé.');
if (problems.length) { console.error(`\n${problems.length} problème(s) :\n` + problems.map(p => ' - ' + p).join('\n')); process.exit(1); }
console.log('✓ Aucun problème.');
