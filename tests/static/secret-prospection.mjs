// v1.61.1 — réserves de sécurité du 10/11/2026 (décision d'Anthony : pas d'accès élargi, aucun envoi, aucune perte).
//  1. Le script de prospection (boîte anthony@) a un code secret DÉDIÉ (SECRET_PROSPECTION / prospect_script_secret) : le code du
//     script principal (WEBHOOK_SECRET / drive_webhook_secret) n'y vaut plus rien ; transition sans coupure par le relais.
//  2. Pièces jointes : fichier Drive seulement s'il est joint à un modèle de mail (contrôle du relais + liste signée), lien
//     temporaire du stockage « suivi » du projet seulement ; sinon la demande est refusée avant toute création.
// Vrai code du relais (identite.ts) et du script (exécuté avec des services Google simulés). Codes, clés et adresses fictifs.
// Usage : node --experimental-strip-types --no-warnings static/secret-prospection.mjs
import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const R = await import(join(ROOT, 'supabase/functions/script-google/identite.ts'));
const problems = [];
const fail = msg => problems.push(msg);
const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label} : obtenu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)}`); };

const COMMON = 'code-commun-fictif-des-scripts', DEDIE = 'code-dedie-fictif-prospection', KEY = 'cle-fictive-boite';
const ME = 'titulaire@exemple-fictif.fr';
const SB = 'https://abcdefghijklmnopqrst.supabase.co';
const ID1 = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', ID2 = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654';
const URL_OK = `${SB}/storage/v1/object/sign/suivi/projets/abc/fiche%20technique.pdf?token=eyJhbGciOi.eyJ1cmwiOi.sig-_x`;

/** Script réel ; journal des effets (lecture Drive, lien récupéré, brouillon créé, envoi) */
function script({ props = { SECRET_PROSPECTION: DEDIE, WEBHOOK_SECRET: COMMON, CLE_BOITE: KEY } } = {}){
  const fx = [];
  const blob = n => ({ getContentType: () => 'application/pdf', getName: () => n, getBytes: () => [1, 2, 3], setName(x) { return blob(x); } });
  const ctx = { Logger: { log() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => ME }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null }) },
    DriveApp: { getFileById: id => { fx.push('drive:' + id); return { getBlob: () => blob('d.pdf') }; } },
    UrlFetchApp: { fetch: u => { fx.push('url:' + u.slice(0, 40)); return { getBlob: () => blob('u.pdf') }; } },
    Gmail: { Users: { Drafts: { create: () => { fx.push('brouillon'); return { id: 'd1', message: { id: 'm1', threadId: 't1' } }; },
      send: () => { fx.push('envoi'); return { id: 'm1', threadId: 't1' }; } } } },
    GmailApp: { search: () => { fx.push('recherche'); return []; } },
    ContentService: { createTextOutput: s => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    Utilities: { formatDate: () => '', Charset: { UTF_8: 'utf8' }, base64Encode: () => 'eA==', base64EncodeWebSafe: () => 'eA', newBlob: () => ({ getBytes: () => [1], setDataFromString() { return { getBytes: () => [1] }; } }),
      computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v).digest()].map(b => (b > 127 ? b - 256 : b)) } };
  vm.createContext(ctx); vm.runInContext(readFileSync(join(ROOT, 'apps-script/Prospection.gs'), 'utf8'), ctx);
  const call = body => { const n = fx.length; const out = JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }));
    return { ok: out.ok === true, error: out.error || '', fx: fx.slice(n) }; };
  return call;
}
const relay = (payload, action = 'mail', code = DEDIE, now = Date.now(), key = KEY) => R.outgoingBody(payload, action, code, ME, key, now, 'prospect');
const MAIL = { to: 'org@exemple-fictif.fr', subject: 'Fictif', html: '<p>x</p>', send: true };

// 1. Code dédié : le code commun est refusé, rien n'est fait ; sans SECRET_PROSPECTION, tout est refusé (aucun repli)
{
  const s = script();
  const commun = s(await relay(MAIL, 'mail', COMMON));
  eq('code commun refusé, aucun effet', [commun.ok, commun.fx], [false, []]);
  if (commun.error === R.OLD_PROSPECT_REFUSAL || R.isOldProspectRefusal({ ok: false, error: commun.error })) fail('le nouveau script ne doit jamais renvoyer le refus de l’ancien (sinon le relais retenterait avec le code commun)');
  eq('code dédié accepté (ping)', s(await relay({}, 'ping')).ok, true);
  eq('code dédié accepté (mail envoyé)', s(await relay(MAIL)).fx, ['brouillon', 'envoi']);
  for (const [label, body] of [['sans code', { ...MAIL, action: 'mail' }], ['code en tableau', { ...MAIL, action: 'mail', secret: [DEDIE] }], ['code vide', { ...MAIL, action: 'mail', secret: '' }]])
    eq(`${label} : refusé, aucun effet`, (r => [r.ok, r.fx])(s(body)), [false, []]);
  const sans = script({ props: { WEBHOOK_SECRET: COMMON, CLE_BOITE: KEY } });
  for (const code of [COMMON, DEDIE, '']) eq(`sans SECRET_PROSPECTION (${code || 'vide'}) : refusé, aucun effet`, (r => [r.ok, r.fx, /SECRET_PROSPECTION/.test(r.error)])(sans(await relay(MAIL, 'mail', code))), [false, [], true]);
  const gs = readFileSync(join(ROOT, 'apps-script/Prospection.gs'), 'utf8');
  if (/getProperty\('WEBHOOK_SECRET'\)/.test(gs)) fail('Prospection.gs ne doit plus lire WEBHOOK_SECRET');
}

// 2. Refus de l'ancien script : reconnu au texte exact seulement (repli de transition du relais)
eq('refus de l’ancien script reconnu', R.isOldProspectRefusal({ ok: false, error: 'Code secret du script de prospection incorrect' }), true);
for (const o of [{ ok: false, error: 'Code secret du script de prospection incorrect', sent: true }, { ok: true, error: 'Code secret du script de prospection incorrect' }, { ok: false, error: 'Autre' }, null, 'x'])
  eq(`autre réponse non prise pour l’ancien refus (${JSON.stringify(o)})`, R.isOldProspectRefusal(o), false);
{
  const src = readFileSync(join(ROOT, 'supabase/functions/script-google/index.ts'), 'utf8');
  const need = [["code dédié lu dans le coffre", /import_secret', \{ k: 'prospect_script_secret' \}/],
    ['code dédié absent → refus (aucun repli silencieux)', /if \(!secret\) return json\(\{ ok: false, error: 'Code secret de prospection absent/],
    ['pièces jointes contrôlées avant tout envoi', /attachmentsCheck\(payload\.attachments, new Set\(\[\.\.\.templateDriveIds\(tpls\), \.\.\.artistDriveIds\(arts\)\]\), URL_\)[\s\S]*if \(!chk\.ok\) return json[\s\S]*res = await send\(secret\)/],
    ['repli de transition limité à la cible « prospect » et au refus exact', /if \(prospect && res\.ok && isOldProspectRefusal\(res\.parsed\) && common\) res = await send\(common\);/],
    ['script principal inchangé (code commun)', /let secret = common;\s*if \(prospect\) \{/]];
  for (const [label, re] of need) if (!re.test(src)) fail(`relais script-google : ${label}`);
  if ((src.match(/await send\(/g) || []).length !== 2) fail('relais script-google : deux envois au plus (code dédié, puis code commun seulement sur refus de l’ancien script)');
  if (src.indexOf("rpc('is_team')") > src.indexOf("k: 'prospect_script_secret'")) fail('relais script-google : is_team doit rester vérifié avant tout');
  const mig = readFileSync(join(ROOT, 'supabase/migrations/2026-11-10_v1.61.1_secret_prospection.sql'), 'utf8');
  const code = mig.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  if (!/'prospect_script_secret', replace\(gen_random_uuid\(\)::text \|\| gen_random_uuid\(\)::text, '-', ''\)/.test(code) || !/on conflict \(key\) do nothing/.test(code)) fail('migration secret_prospection : code tiré au hasard, créé une seule fois');
  if (/\b(drop|delete|truncate|update)\b|do update/i.test(code)) fail('migration secret_prospection : aucune suppression ni modification');
  if (/drive_webhook_secret|mailbox_sign_key/.test(code)) fail('migration secret_prospection : ne touche à aucun autre secret');
}

// 3. Relais : contrôle des pièces jointes (modèles de mail, stockage « suivi » du projet)
{
  const allowed = R.templateDriveIds([{ attachments: [{ id: ID1, url: 'https://drive.google.com/file/d/' + ID1, name: 'x' }, { path: 'a/b.pdf', name: 'b' }] }, { attachments: null }, {}]);
  eq('identifiants Drive des modèles', [...allowed], [ID1]);
  eq('sans pièce jointe', R.attachmentsCheck(undefined, allowed, SB), { ok: true });
  eq('liste autorisée, nettoyée', R.attachmentsCheck([{ id: ID1, extra: 1 }, { url: URL_OK, name: 'F.pdf', id2: 'x' }], allowed, SB), { ok: true, attachments: [{ id: ID1 }, { url: URL_OK, name: 'F.pdf' }] });
  const refus = [['fichier Drive hors modèles', [{ id: ID2 }]], ['identifiant Drive illisible', [{ id: '../x' }]], ['id et url ensemble', [{ id: ID1, url: URL_OK }]],
    ['autre projet Supabase', [{ url: URL_OK.replace('abcdefghijklmnopqrst', 'zzzzzzzzzzzzzzzzzzzz'), name: 'x' }]],
    ['autre stockage', [{ url: URL_OK.replace('/sign/suivi/', '/sign/autre/'), name: 'x' }]], ['lien public non signé', [{ url: `${SB}/storage/v1/object/public/suivi/a.pdf`, name: 'x' }]],
    ['sans jeton', [{ url: URL_OK.split('?')[0], name: 'x' }]], ['adresse quelconque', [{ url: 'https://exemple-fictif.fr/a.pdf', name: 'x' }]], ['http', [{ url: URL_OK.replace('https:', 'http:'), name: 'x' }]],
    ['identifiants dans l’adresse', [{ url: URL_OK.replace('https://', 'https://u:p@'), name: 'x' }]], ['lien temporaire non obtenu', [{ url: null, name: 'x' }]], ['pièce vide', [{}]], ['pièce non objet', ['x']],
    ['liste non tableau', { id: ID1 }], ['trop de pièces', Array(21).fill({ id: ID1 })]];
  for (const [label, list] of refus) { const r = R.attachmentsCheck(list, allowed, SB); eq(`relais : ${label} → refusé`, [r.ok, /Rien n’a été créé ni envoyé/.test(r.error || '')], [false, true]); }
}

// 4. Script : pièces jointes vérifiées AVANT toute création (signature de la liste Drive, lien de la Matrice)
{
  const s = script(), now = Date.now();
  const ok = s(await relay({ ...MAIL, attachments: [{ id: ID1 }, { url: URL_OK, name: 'F.pdf' }] }, 'mail', DEDIE, now));
  eq('liste signée par le relais : fichier lu, mail envoyé', [ok.ok, ok.fx], [true, ['drive:' + ID1, 'url:' + URL_OK.slice(0, 40), 'brouillon', 'envoi']]);
  const signed = JSON.parse(await relay({ ...MAIL, attachments: [{ id: ID1 }] }, 'mail', DEDIE, now));
  eq('signature de la liste (texte matrice-pj-v1)', signed.att_sig, createHmac('sha256', KEY).update(['matrice-pj-v1', 'prospect', 'anthony', String(now), ID1].join('|')).digest('hex'));
  if (JSON.stringify(signed).includes(KEY)) fail('la clé CLE_BOITE ne doit jamais être transmise');
  eq('sans fichier Drive : pas de signature de liste', 'att_sig' in JSON.parse(await relay({ ...MAIL, attachments: [{ url: URL_OK, name: 'F' }] })), false);
  const essais = [
    ['autre fichier que la liste signée', { ...signed, attachments: [{ id: ID2 }] }],
    ['fichier ajouté à la liste signée', { ...signed, attachments: [{ id: ID1 }, { id: ID2 }] }],
    ['sans signature (appel direct avec le code dédié)', { ...signed, att_sig: undefined }],
    ['horodatage modifié', { ...signed, caller_ts: now + 1 }],
    ['demande expirée', JSON.parse(await relay({ ...MAIL, attachments: [{ id: ID1 }] }, 'mail', DEDIE, now - 6 * 60 * 1000))],
    ['signée avec une autre clé', JSON.parse(await relay({ ...MAIL, attachments: [{ id: ID1 }] }, 'mail', DEDIE, now, 'autre-cle'))],
    ['lien hors Matrice', JSON.parse(await relay({ ...MAIL, attachments: [{ url: 'https://exemple-fictif.fr/a.pdf', name: 'x' }] }))],
    ['lien d’un autre stockage', JSON.parse(await relay({ ...MAIL, attachments: [{ url: URL_OK.replace('/sign/suivi/', '/sign/autre/'), name: 'x' }] }))],
    ['remontée de dossier', JSON.parse(await relay({ ...MAIL, attachments: [{ url: `${SB}/storage/v1/object/sign/suivi/../autre/a.pdf?token=x`, name: 'x' }] }))],
    ['pièce sans fichier', JSON.parse(await relay({ ...MAIL, attachments: [{ name: 'x' }] }))],
    ['liste non tableau', JSON.parse(await relay({ ...MAIL, attachments: { id: ID1 } }))],
    ['trop de pièces', JSON.parse(await relay({ ...MAIL, attachments: Array(21).fill({ url: URL_OK, name: 'x' }) }))]];
  for (const [label, body] of essais) eq(`script : ${label} → refusé, rien lu, rien créé`, (r => [r.ok, r.fx, /Rien n’a été créé ni envoyé/.test(r.error)])(s(body)), [false, [], true]);
  const rep = s({ ...signed, action: 'reply', thread_id: 't1', attachments: [{ id: ID2 }] });
  eq('relance (reply) : même contrôle', [rep.ok, rep.fx], [false, []]);
  const sansCle = script({ props: { SECRET_PROSPECTION: DEDIE } });
  eq('sans CLE_BOITE : fichier Drive refusé, rien lu', (r => [r.ok, r.fx, /CLE_BOITE/.test(r.error)])(sansCle(signed)), [false, [], true]);
  eq('sans CLE_BOITE : lien de la Matrice accepté', sansCle(await relay({ ...MAIL, attachments: [{ url: URL_OK, name: 'F' }] })).ok, true);
  // même règle des deux côtés (CONVENTIONS §8.4)
  const gs = readFileSync(join(ROOT, 'apps-script/Prospection.gs'), 'utf8');
  eq('même forme d’identifiant Drive (relais / script)', (gs.match(/var DRIVE_ID_RE_ = (\/.+\/);/) || [])[1], String(R.DRIVE_ID_RE));
  eq('même nombre maximal de pièces (relais / script)', Number((gs.match(/var ATT_MAX_ = (\d+);/) || [])[1]), R.ATT_MAX);
  const reGs = new RegExp((gs.match(/var MATRICE_URL_RE_ = \/(.+)\/;/) || [])[1] || '^$');
  if (!reGs.test(URL_OK) || !R.matriceUrlOk(URL_OK, SB)) fail('lien de la Matrice : accepté des deux côtés');
}

if (problems.length) { console.error('✗ Code dédié et pièces jointes du script de prospection :\n  - ' + problems.join('\n  - ')); process.exit(1); }
console.log('✓ Script de prospection : code dédié (code commun refusé, transition par le relais), pièces jointes limitées aux modèles et au stockage de la Matrice, rien créé sur refus');

// (messagerie, 15/11/2026) documents de la fiche artiste joignables : stockage « artiste » signé et fichiers Drive des artist_docs
{
  const m = await import('../../supabase/functions/script-google/identite.ts');
  const U = 'https://abcdefghijklmnopqrst.supabase.co';
  const ok1 = m.matriceUrlOk(U + '/storage/v1/object/sign/artiste/p1/doc.pdf?token=x.y', U);
  const no1 = m.matriceUrlOk(U + '/storage/v1/object/sign/rh/p1/doc.pdf?token=x.y', U);
  const ids = m.artistDriveIds([{ artist_docs: [{ file_id: 'A'.repeat(30) }, { path: 'x' }] }]);
  const chk = m.attachmentsCheck([{ id: 'A'.repeat(30) }], ids, U), refus = m.attachmentsCheck([{ id: 'B'.repeat(30) }], ids, U);
  if (!ok1 || no1 || !chk.ok || refus.ok) { console.error('ÉCHEC : pièces jointes des documents artistes', { ok1, no1, chk, refus }); process.exit(1); }
  console.log('✓ Pièces jointes : documents de la fiche artiste acceptés, autres stockages et fichiers Drive inconnus refusés');
}
