// Règles de la synchronisation Brevo (v1.60.2, structures inactives ; 08/11/2026, ajout et retrait des rattachements, fonctions par
// structure) sur de FAUSSES données : aucun appel à Brevo ni à la base (faux client Brevo en mémoire).
// Lancé par « npm test » (node --experimental-strip-types). Module testé : supabase/functions/brevo-sync/regles.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aAjouter, attributes, fonctionsParStructure, names, onlyInactive, syncContact } from '../../supabase/functions/brevo-sync/regles.ts';

const cas = [];
const t = (nom, f) => cas.push([nom, f]);
const L = (name, inactive) => ({ name, inactive });

t('contact lié uniquement à des structures inactives : hors prospection', () => {
  assert.equal(onlyInactive([L('Salle fermée', true)]), true);
  assert.equal(onlyInactive([L('A', true), L('B', true)]), true);
});
t('contact lié à au moins une structure active : reste prospectable', () => {
  assert.equal(onlyInactive([L('Salle fermée', true), L('Salle ouverte', false)]), false);
  assert.equal(onlyInactive([L('Salle ouverte', false)]), false);
});
t('contact sans structure : non concerné (ajouté comme avant)', () => {
  assert.equal(onlyInactive([]), false);
  assert.equal(onlyInactive(undefined), false);
});
t('import « tout envoyer » : seules les adresses des contacts « uniquement inactifs » sont retenues, et comptées', () => {
  const links = new Map([['c1', [L('Fermée', true)]], ['c2', [L('Fermée', true), L('Ouverte', false)]]]);
  const cand = [{ c: { id: 'c1' }, email: 'a@x.invalid' }, { c: { id: 'c1' }, email: 'a2@x.invalid' }, { c: { id: 'c2' }, email: 'b@x.invalid' }, { c: { id: 'c3' }, email: 'c@x.invalid' }];
  const { list, skipped_inactive } = aAjouter(cand, links);
  assert.deepEqual(list.map((x) => x.email), ['b@x.invalid', 'c@x.invalid']);
  assert.equal(skipped_inactive, 2);
});
t('réactivation : la même adresse redevient ajoutable (règle calculée, rien d’enregistré)', () => {
  const links = new Map([['c1', [L('Fermée', false)]]]);
  assert.equal(aAjouter([{ c: { id: 'c1' }, email: 'a@x.invalid' }], links).list.length, 1);
});
t('champ « structure » de Brevo : tous les noms (actives et inactives), comme avant', () => {
  assert.deepEqual(names([L('A', true), L('', false), L('B', false)]), ['A', 'B']);
});
// ───────────── Faux Brevo en mémoire (aucun réseau) ─────────────
// Un contact Brevo : champs, listes, désabonnement, et des champs « préférences » posés dans Brevo (jamais par la Matrice).
// modifier() se comporte comme PUT /contacts/{email} : seuls les champs envoyés changent.
function fauxBrevo(init = {}) {
  const base = new Map(Object.entries(init).map(([e, v]) => [e, structuredClone({ attributes: {}, listIds: [], emailBlacklisted: false, ...v })]));
  const appels = [];
  const rep = (status, txt = '') => ({ ok: status < 300, status, text: async () => txt });
  const client = {
    lire: async (email) => { appels.push(['lire', email]); return base.has(email) ? rep(200, JSON.stringify(base.get(email))) : rep(404, 'not found'); },
    modifier: async (email, corps) => {
      appels.push(['modifier', email, structuredClone(corps)]);
      if (!base.has(email)) return rep(404, 'not found');
      Object.assign(base.get(email).attributes, corps.attributes);
      return rep(204);
    },
    creer: async (corps) => {
      appels.push(['creer', corps.email, structuredClone(corps)]);
      if (base.has(corps.email)) return rep(400, '{"code":"duplicate_parameter","message":"Contact already exist"}');
      base.set(corps.email, { attributes: { ...corps.attributes }, listIds: [...(corps.listIds || [])], emailBlacklisted: false });
      return rep(201, '{"id":1}');
    },
  };
  // tout autre appel (suppression, désabonnement, retrait de liste…) n'existe pas : y accéder fait échouer le test
  const garde = new Proxy(client, { get: (o, k) => { if (!(k in o) && typeof k === 'string' && k !== 'then') throw new Error(`appel interdit : ${k}`); return o[k]; } });
  return { client: garde, base, appels };
}
const CH = { first: 'PRENOM', last: 'NOM', struct: 'STRUCTURE' };
const C = (o = {}) => ({ id: 'k1', email: 'lea@x.invalid', email_2: null, first_name: 'Léa', last_name: 'Martin', display_name: 'Léa Martin', ...o });
const LR = (name, inactive, role = null) => ({ name, inactive, role });
const sync = (b, c, links, ours = [], listIds = [7]) => syncContact({ client: b.client, c, links, champs: CH, listIds, ours: new Set(ours) });

t('ajout d’un rattachement : la nouvelle structure part dans le champ « structure » (mail créé par la Matrice)', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': { attributes: { PRENOM: 'Léa', NOM: 'Martin', STRUCTURE: 'Salle A' }, listIds: [7] } });
  const r = await sync(b, C(), [LR('Salle A', false), LR('Festival B', false)], ['lea@x.invalid']);
  assert.deepEqual(r.errors, []); assert.deepEqual(r.updated, ['lea@x.invalid']);
  assert.equal(b.base.get('lea@x.invalid').attributes.STRUCTURE, 'Festival B, Salle A');
  assert.equal(b.appels.filter(a => a[0] === 'creer').length, 0);
});
t('retrait d’un rattachement : la structure quittée disparaît, le contact Brevo reste (listes comprises)', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Festival B, Salle A' }, listIds: [7, 9] } });
  await sync(b, C(), [LR('Salle A', false)], ['lea@x.invalid']);
  assert.equal(b.base.get('lea@x.invalid').attributes.STRUCTURE, 'Salle A');
  assert.deepEqual(b.base.get('lea@x.invalid').listIds, [7, 9]);
  assert.equal(b.base.size, 1);
});
t('retrait du DERNIER rattachement : champ « structure » vidé, contact gardé', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Salle A' }, listIds: [7] } });
  await sync(b, C(), [], ['lea@x.invalid']);
  assert.equal(b.base.get('lea@x.invalid').attributes.STRUCTURE, '');
  assert.ok(b.base.has('lea@x.invalid'));
  // à la création, pas de champ « structure » vide (comme avant)
  assert.equal('STRUCTURE' in attributes(C(), [], CH), false);
});
t('contact désabonné intact : désabonnement et listes jamais touchés, même après un retrait', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Salle A, Salle B' }, listIds: [], emailBlacklisted: true } });
  await sync(b, C(), [LR('Salle A', false)], ['lea@x.invalid']);
  const k = b.base.get('lea@x.invalid');
  assert.equal(k.emailBlacklisted, true); assert.deepEqual(k.listIds, []);
  for (const [, , corps] of b.appels.filter(a => a[0] === 'modifier')) assert.deepEqual(Object.keys(corps), ['attributes']);
});
t('préférences intactes : seuls prénom, nom et structure sont envoyés, les autres champs Brevo restent', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Salle A', OPT_IN_NEWSLETTER: true, LANGUE: 'fr', FREQUENCE: 'mensuelle' } } });
  await sync(b, C(), [LR('Salle B', false, 'Programmatrice')], ['lea@x.invalid']);
  const a = b.base.get('lea@x.invalid').attributes;
  assert.equal(a.OPT_IN_NEWSLETTER, true); assert.equal(a.LANGUE, 'fr'); assert.equal(a.FREQUENCE, 'mensuelle');
  const envoyes = b.appels.filter(x => x[0] === 'modifier').flatMap(x => Object.keys(x[2].attributes));
  assert.deepEqual([...new Set(envoyes)].sort(), ['NOM', 'PRENOM', 'STRUCTURE']);
});
t('mail déjà dans Brevo mais PAS créé par la Matrice : jamais modifié (règle inchangée), même au retrait', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Ancienne' } } });
  const r = await sync(b, C(), [], []);
  assert.equal(b.base.get('lea@x.invalid').attributes.STRUCTURE, 'Ancienne');
  assert.deepEqual(b.appels.map(a => a[0]), ['lire']); assert.deepEqual(r.done, ['lea@x.invalid']);
});
t('contact multi-structures : toutes les structures, ordre stable, et une fonction différente par structure gardée', async () => {
  const links = [LR('Théâtre Z', false, 'Directrice'), LR('Festival B', true, 'Programmatrice'), LR('Théâtre Z', false, 'Directrice')];
  const b = fauxBrevo();
  await sync(b, C({ email_2: 'lea.perso@x.invalid' }), links);
  for (const e of ['lea@x.invalid', 'lea.perso@x.invalid']) assert.equal(b.base.get(e).attributes.STRUCTURE, 'Festival B, Théâtre Z');
  assert.deepEqual(names([...links].reverse()), names(links));
  // aucune fonction n'en écrase une autre (pas de « dernière écrite ») ; ordre de lecture sans effet
  const f = [{ structure: 'Festival B', fonction: 'Programmatrice' }, { structure: 'Théâtre Z', fonction: 'Directrice' }];
  assert.deepEqual(fonctionsParStructure(links), f);
  assert.deepEqual(fonctionsParStructure([...links].reverse()), f);
  assert.deepEqual(fonctionsParStructure([LR('Salle', false, ''), LR('', false, 'X')]), []);
});
t('fonctions par structure : PAS encore transmises à Brevo (représentation à décider par Anthony)', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': {} });
  await sync(b, C(), [LR('Salle A', false, 'Programmatrice'), LR('Salle B', false, 'Régisseuse')], ['lea@x.invalid']);
  const b2 = fauxBrevo(); await sync(b2, C(), [LR('Salle A', false, 'Programmatrice')]);
  const txt = JSON.stringify([...b.appels, ...b2.appels]);
  assert.doesNotMatch(txt, /Programmatrice|Régisseuse|FONCTION/i);
});
t('contact lié uniquement à des structures inactives : pas créé ; déjà présent : gardé, rien supprimé ni désabonné', async () => {
  const b = fauxBrevo();
  const r = await sync(b, C(), [LR('Fermée', true)]);
  assert.equal(b.base.size, 0); assert.deepEqual(r.skipped, ['lea@x.invalid']);
  const b2 = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Fermée, Ouverte' }, listIds: [7] } });
  await sync(b2, C(), [LR('Fermée', true)], ['lea@x.invalid']);   // retrait de la seule structure active
  assert.deepEqual(b2.base.get('lea@x.invalid'), { attributes: { STRUCTURE: 'Fermée', PRENOM: 'Léa', NOM: 'Martin' }, listIds: [7], emailBlacklisted: false });
});
t('aucune suppression : le faux client n’offre que lire / modifier / créer, et la fonction serveur n’a aucun autre appel', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': {} });
  await sync(b, C(), [], ['lea@x.invalid']);
  assert.deepEqual([...new Set(b.appels.map(a => a[0]))].sort(), ['lire', 'modifier']);
  assert.throws(() => b.client.supprimer, /appel interdit/);
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\/contacts\/lists\/[^`"]*\/contacts\/remove|method: "DELETE"|emailBlacklisted|unlinkListIds|smsBlacklisted/);
  assert.match(src, /syncContact\(\{ client: client\(key\)/);
  const reg = readFileSync(new URL('../../supabase/functions/brevo-sync/regles.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(reg.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, ''), /DELETE|emailBlacklisted|unlinkListIds|listIds:\s*\[\]/);
});
t('rejouable, sans doublon : deux passages identiques = un seul contact par mail, mêmes champs', async () => {
  const b = fauxBrevo();
  const ours = new Set();
  const links = [LR('Salle B', false), LR('Salle A', false)];
  const r1 = await syncContact({ client: b.client, c: C({ email_2: 'LEA@x.invalid ' }), links, champs: CH, listIds: [7], ours });
  const avant = structuredClone([...b.base]);
  const r2 = await syncContact({ client: b.client, c: C({ email_2: 'LEA@x.invalid ' }), links: [...links].reverse(), champs: CH, listIds: [7], ours });
  assert.deepEqual(r1.created, ['lea@x.invalid']); assert.deepEqual(r2.created, []);
  assert.equal(b.base.size, 1); assert.deepEqual([...b.base], avant);
  assert.equal(b.appels.filter(a => a[0] === 'creer').length, 1);
  // création concurrente (« duplicate » renvoyé par Brevo) : comptée comme faite, pas d'erreur
  const b3 = fauxBrevo(); const lire = b3.client.lire; b3.client.lire = async () => ({ ok: false, status: 404, text: async () => '' });
  await b3.client.creer({ email: 'lea@x.invalid', attributes: {} });
  const r3 = await syncContact({ client: b3.client, c: C(), links, champs: CH, listIds: [], ours: new Set() });
  b3.client.lire = lire;
  assert.deepEqual(r3.errors, []); assert.deepEqual(r3.done, ['lea@x.invalid']); assert.equal(b3.base.size, 1);
});
t('mise à jour refusée par Brevo : erreur signalée (plus jamais perdue en silence)', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': {} });
  b.client.modifier = async () => ({ ok: false, status: 400, text: async () => 'attribute STRUCTURE invalid' });
  const r = await sync(b, C(), [], ['lea@x.invalid']);
  assert.equal(r.errors.length, 1); assert.match(r.errors[0], /Brevo 400/); assert.deepEqual(r.done, []);
});
t('déclencheur SQL : ajout, retrait et déplacement d’un rattachement relancent la synchronisation (même règle que la fonction)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/2026-11-08_brevo_rattachements.sql', import.meta.url), 'utf8');
  assert.match(sql, /create or replace trigger brevo_contact_structures after insert or delete or update of contact_id, structure_id on public\.contact_structures/);
  assert.match(sql, /tg_op = 'DELETE' or \(tg_op = 'UPDATE' and old\.contact_id is distinct from new\.contact_id\)/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\bdrop\b|\bdelete from\b|\btruncate\b|update contacts/i);
  assert.doesNotMatch(sql, /update of [^;]*\brole\b/);   // fonction non transmise : la modifier ne relance rien
});

let ko = 0;
for (const [nom, f] of cas) { try { await f(); console.log('  ✓ ' + nom); } catch (e) { ko++; console.error('  ✗ ' + nom + '\n    ' + e.message); } }
console.log(`Règles Brevo : ${cas.length - ko}/${cas.length} cas vérifiés.`);
if (ko) process.exit(1);
