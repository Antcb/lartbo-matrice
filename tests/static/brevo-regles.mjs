// Règles de la synchronisation Brevo (v1.60.2, structures inactives ; 08/11/2026, ajout et retrait des rattachements, fonctions par
// structure ; contacts « hors prospection », option B) sur de FAUSSES données : aucun appel à Brevo ni à la base (faux client Brevo en mémoire).
// Lancé par « npm test » (node --experimental-strip-types). Module testé : supabase/functions/brevo-sync/regles.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aAjouter, attributes, fonctionsParStructure, fonctionsTexte, horsProspection, lireReglages, listeEssai, mailsAutorises, names, onlyInactive, syncContact } from '../../supabase/functions/brevo-sync/regles.ts';

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
t('FONCTIONS (décision du 08/11) : champ texte lisible, structure par structure, ordre stable, sans doublon', async () => {
  const links = [LR('Théâtre Z', false, 'Directrice'), LR('Festival B', true, 'Programmatrice'), LR('Théâtre Z', false, 'Directrice'), LR('Salle Y', false, null)];
  assert.equal(fonctionsTexte(links), 'Festival B : Programmatrice ; Théâtre Z : Directrice');
  assert.equal(fonctionsTexte([...links].reverse()), 'Festival B : Programmatrice ; Théâtre Z : Directrice');
  assert.equal(fonctionsTexte([LR('Salle Y', false, '  ')]), '');
  const CF = { ...CH, fonctions: 'FONCTIONS' };
  // création (mail ajouté par la Matrice) : envoyé s'il n'est pas vide
  const b = fauxBrevo();
  await syncContact({ client: b.client, c: C(), links, champs: CF, listIds: [7], ours: new Set() });
  assert.equal(b.base.get('lea@x.invalid').attributes.FONCTIONS, 'Festival B : Programmatrice ; Théâtre Z : Directrice');
  assert.equal('FONCTIONS' in attributes(C(), [LR('Salle Y', false)], CF), false);
  // changement de fonction puis retrait de la dernière fonction : mis à jour, puis vidé ; listes, désabonnement, préférences intacts
  const b2 = fauxBrevo({ 'lea@x.invalid': { attributes: { FONCTIONS: 'Salle Y : Régie', OPT_IN: true }, listIds: [3], emailBlacklisted: true } });
  await syncContact({ client: b2.client, c: C(), links: [LR('Salle Y', false, 'Direction')], champs: CF, listIds: [7], ours: new Set(['lea@x.invalid']) });
  assert.equal(b2.base.get('lea@x.invalid').attributes.FONCTIONS, 'Salle Y : Direction');
  await syncContact({ client: b2.client, c: C(), links: [LR('Salle Y', false, null)], champs: CF, listIds: [7], ours: new Set(['lea@x.invalid']) });
  assert.deepEqual(b2.base.get('lea@x.invalid'), { attributes: { FONCTIONS: '', OPT_IN: true, STRUCTURE: 'Salle Y', PRENOM: 'Léa', NOM: 'Martin' }, listIds: [3], emailBlacklisted: true });
  // mail non créé par la Matrice : jamais touché
  const b3 = fauxBrevo({ 'lea@x.invalid': { attributes: { FONCTIONS: 'Ancienne' } } });
  await syncContact({ client: b3.client, c: C(), links, champs: CF, listIds: [7], ours: new Set() });
  assert.equal(b3.base.get('lea@x.invalid').attributes.FONCTIONS, 'Ancienne');
});
t('FONCTIONS absent du compte Brevo : rien d’envoyé (jamais créé par la Matrice) ; fonctions générales jamais envoyées', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': {} });
  await sync(b, C({ roles: ['Booker'] }), [LR('Salle A', false, 'Programmatrice')], ['lea@x.invalid']);
  assert.doesNotMatch(JSON.stringify(b.appels), /Programmatrice|Booker|FONCTIONS/);
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  assert.match(src, /fonctions: pick\(\["FONCTIONS"\]\)/);
  assert.doesNotMatch(src, /attributes\/normal\/FONCTIONS/);
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
t('déclencheur SQL : ajout, retrait et déplacement relancent la synchronisation, une fois par contact et par requête', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/2026-11-08_brevo_rattachements.sql', import.meta.url), 'utf8');
  const code = sql.replace(/^\s*--.*$/gm, '');
  // par requête (tables de transition), plus jamais ligne par ligne ; un trigger par événement
  assert.match(code, /create or replace trigger brevo_contact_structures after insert on public\.contact_structures\s+referencing new table as brevo_nouv for each statement/);
  assert.match(code, /create or replace trigger brevo_contact_structures_retrait after delete on public\.contact_structures\s+referencing old table as brevo_anc for each statement/);
  assert.match(code, /create or replace trigger brevo_contact_structures_modif after update on public\.contact_structures\s+referencing old table as brevo_anc new table as brevo_nouv for each statement/);
  assert.doesNotMatch(code, /on public\.contact_structures\s+for each row/);
  // une seule relance par contact ; en modification, seuls les couples (contact, structure) apparus ou disparus comptent
  assert.equal((code.match(/for c in select distinct/g) || []).length, 3);
  // fonction comprise (décision du 08/11) : un changement de fonction relance, une réécriture à l'identique non
  assert.match(code, /select n\.contact_id, n\.structure_id, n\.role from brevo_nouv n except select o\.contact_id, o\.structure_id, o\.role from brevo_anc o/);
  assert.doesNotMatch(code, /\bdrop\b|\btruncate\b|brevo_contact_trg\(\) returns/i);
  // seules suppressions : dans la mémoire des exclusions (remise en prospection, part automatique levée), jamais de données métier
  assert.deepEqual([...new Set(code.match(/delete from \w+/gi))], ['delete from prospection_memoire']);
  // décision du 09/11 : mémoire par adresse, illisible par l'API, reprise après la garde (ordre alphabétique des déclencheurs BEFORE)
  assert.match(code, /create table if not exists public\.prospection_memoire/);
  assert.match(code, /revoke all on public\.prospection_memoire from public, anon, authenticated, service_role;/);
  assert.match(code, /alter table public\.prospection_memoire enable row level security;/);
  assert.match(code, /create or replace trigger contacts_prospection_oubli after delete or update of email, email_2 on public\.contacts/);
  // liste d'opposition minimale : adresse, origine, date, raison, dernier motif — pas le journal du contact
  assert.doesNotMatch(code.slice(code.indexOf('create table if not exists public.prospection_memoire'), code.indexOf('comment on table public.prospection_memoire')), /historique|jsonb|ancien_contact/);
  assert.match(code, /create or replace trigger contacts_prospection_memoire before insert or update of email, email_2 on public\.contacts/);
  assert.ok(['contacts_clean', 'contacts_prospection_guard', 'contacts_prospection_memoire'].every((x, i, a) => !i || a[i - 1] < x));
  // effacement de la part manuelle de la mémoire : seulement dans set_prospection
  const setp = code.slice(code.indexOf('function public.set_prospection'), code.indexOf('revoke all on function public.set_prospection'));
  assert.match(setp, /delete from prospection_memoire where email = any\(mails\);/);
  const lever = code.slice(code.indexOf('function public.prospection_memoire_lever_auto'));
  assert.match(lever, /delete from prospection_memoire where email = any\(mails\) and exclue_manuelle_at is null;/);
  // seules écritures : le marqueur hors_prospection_at (posé / effacé), jamais une autre colonne de contacts
  // seules écritures : les marqueurs de prospection (automatique, manuel) et leur journal, jamais une autre colonne de contacts
  assert.deepEqual([...new Set((code.match(/update contacts (?:k )?set [^;]*?where/g) || []).flatMap(u => u.match(/\b(\w+) = /g)).map(x => x.replace(' = ', '')))].sort(),
    ['hors_prospection_at', 'prospection_exclue_at', 'prospection_history']);
  // décisions du 09/11 : un rattachement actif ou une réactivation ne lèvent que le marqueur automatique
  const levees = code.split('prospection_entree(\'remise\', \'structure\'');
  assert.equal(levees.length, 3);   // rattachement actif, réactivation
  for (const avant of levees.slice(0, -1)) { const stmt = avant.slice(avant.lastIndexOf('update contacts')); assert.match(stmt, /^update contacts k set hors_prospection_at = null,/); assert.doesNotMatch(stmt, /prospection_exclue_at/); }
  // garde : écriture directe des colonnes de prospection par l'API refusée ; seul chemin d'équipe : set_prospection (motif, tracé)
  assert.match(code, /create or replace trigger contacts_prospection_guard before insert or update on public\.contacts/);
  assert.match(code, /current_user::text in \('anon', 'authenticated'\)/);
  assert.doesNotMatch(code.slice(code.indexOf('function public.contacts_prospection_guard'), code.indexOf('create or replace trigger contacts_prospection_guard')), /security definer/);
  assert.match(code, /grant execute on function public\.set_prospection\(uuid, boolean, text, uuid\[\]\) to authenticated/);
  assert.doesNotMatch(code.slice(code.indexOf('function public.set_prospection'), code.indexOf('revoke all on function public.set_prospection')), /emailBlacklisted|unsubscri|blacklist/i);
  assert.match(code, /create or replace trigger brevo_structure_deleted before delete on public\.structures/);
  // mode essai (relecture B2) : liste blanche ni modifiée ni effacée par l'API de l'équipe tant qu'une clé est enregistrée
  assert.match(code, /create or replace trigger brevo_essai_guard before update or delete on public\.settings/);
  assert.match(code, /coalesce\(public\.brevo_key_status\(\), true\)/);
  // essai en base jetable : tests/outils/brevo-declencheurs-pg.sh (50 rattachements, structure de 40 contacts, réécriture à l'identique)
  assert.match(readFileSync(new URL('../outils/brevo-declencheurs-pg.sh', import.meta.url), 'utf8'), /fonction et structure réécrites à l’identique : aucun appel[\s\S]*suppression d’une structure inactive : ses contacts uniquement inactifs marqués[\s\S]*contact créé sans structure : pas marqué/);
});
t('option B (08/11) et exclusion manuelle (09/11) : contact devenu sans structure après sa dernière structure inactive = toujours hors Brevo ; créé sans structure = ajouté', async () => {
  const M = '2026-11-08T10:00:00Z';
  assert.equal(horsProspection([], M), true);
  assert.equal(horsProspection([], null), false);
  assert.equal(horsProspection([LR('Ouverte', false)], M), false);        // rattaché à une structure active : prospectable
  assert.equal(horsProspection([LR('Fermée', true)], null), true);        // règle v1.60.2 inchangée
  // exclusion MANUELLE (09/11) : hors prospection quelles que soient les structures, même actives
  assert.equal(horsProspection([LR('Ouverte', false)], null, M), true);
  assert.equal(horsProspection([], null, M), true);
  // marqué, sans structure : ni création, ni liste
  const b = fauxBrevo();
  const r = await sync(b, C({ hors_prospection_at: M }), []);
  assert.equal(b.base.size, 0); assert.deepEqual(r.skipped, ['lea@x.invalid']);
  // déjà dans Brevo (créé par la Matrice) : gardé, champs à jour, listes et désabonnement intacts (aucune liste ajoutée)
  const b2 = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Fermée' }, listIds: [], emailBlacklisted: true } });
  await sync(b2, C({ hors_prospection_at: M }), [], ['lea@x.invalid']);
  assert.deepEqual(b2.base.get('lea@x.invalid'), { attributes: { STRUCTURE: '', PRENOM: 'Léa', NOM: 'Martin' }, listIds: [], emailBlacklisted: true });
  // créé sans structure (jamais marqué) : ajouté comme avant
  const b3 = fauxBrevo();
  await sync(b3, C(), []);
  assert.deepEqual(b3.base.get('lea@x.invalid').listIds, [7]);
  // « tout envoyer » : même règle
  const links = new Map([['k1', []], ['k2', []]]);
  const { list, skipped_inactive } = aAjouter([{ c: { id: 'k1', hors_prospection_at: M }, email: 'a@x.invalid' }, { c: { id: 'k2', hors_prospection_at: null }, email: 'b@x.invalid' }], links);
  assert.deepEqual(list.map(x => x.email), ['b@x.invalid']); assert.equal(skipped_inactive, 1);
  // même règle côté application (js/selectors.js)
  const sel = readFileSync(new URL('../../js/selectors.js', import.meta.url), 'utf8');
  assert.match(sel, /export const horsProspection = c => !!c\?\.prospection_exclue_at \|\| onlyInactive\(c\) \|\| \(!!c\?\.hors_prospection_at && !\(c\?\.id && linksOfContact\(c\.id\)\.length\)\);/);
  // exclu à la main, jamais créé dans Brevo (même rattaché à une structure active) ; déjà dans Brevo : rien d'autre que ses champs
  const b4 = fauxBrevo();
  const r4 = await sync(b4, C({ prospection_exclue_at: M }), [LR('Ouverte', false)]);
  assert.equal(b4.base.size, 0); assert.deepEqual(r4.skipped, ['lea@x.invalid']);
  const b5 = fauxBrevo({ 'lea@x.invalid': { attributes: {}, listIds: [], emailBlacklisted: true } });
  await sync(b5, C({ prospection_exclue_at: M }), [LR('Ouverte', false)], ['lea@x.invalid']);
  assert.equal(b5.base.get('lea@x.invalid').emailBlacklisted, true); assert.deepEqual(b5.base.get('lea@x.invalid').listIds, []);
});

t('MODE ESSAI (marche du 09/11) : seule l’adresse de la liste blanche est synchronisée, aucun appel pour les autres', async () => {
  assert.equal(listeEssai(''), null); assert.equal(listeEssai('   '), null); assert.equal(listeEssai(null), null); assert.equal(listeEssai(undefined), null);
  // relecture B2 : réglage rempli SANS adresse valide = tout bloqué (liste vide), jamais le mode normal
  for (const v of ['pas une adresse', 'ADRESSE+essai@DOMAINE', 'prenom+essai-matrice@gmail', 'prenom+essai@gmail,com', '<<ADRESSE D’ESSAI À REMPLACER>>', { a: 1 }, 5, [], ['x']])
    assert.deepEqual(listeEssai(v), new Set(), JSON.stringify(v));
  assert.deepEqual([...listeEssai('Prénom <Prenom+Essai@Gmail.com>')], ['prenom+essai@gmail.com']);
  assert.deepEqual([...listeEssai('"lea+essai@x.invalid"')], ['lea+essai@x.invalid']);
  assert.deepEqual([...listeEssai(['lea+essai@x.invalid'])], ['lea+essai@x.invalid']);
  const bloque = listeEssai('ADRESSE+essai@DOMAINE');
  assert.deepEqual(mailsAutorises(C({ email_2: 'lea+essai@x.invalid' }), bloque), []);
  const b0 = fauxBrevo({ 'lea@x.invalid': {} });
  await syncContact({ client: b0.client, c: C(), links: [], champs: CH, listIds: [7], ours: new Set(['lea@x.invalid']), essai: bloque });
  assert.deepEqual(b0.appels, []);
  // même règle côté application (js/selectors.js, listeEssaiBrevo) : même motif d'adresse et même cas « vide »
  const sel = readFileSync(new URL('../../js/selectors.js', import.meta.url), 'utf8');
  const reg = readFileSync(new URL('../../supabase/functions/brevo-sync/regles.ts', import.meta.url), 'utf8');
  const motif = t => (t.match(/\.filter\(\(?e\)? => (\/\^\[\^\\s@<>[^\n]*?\$\/)\.test\(e\)\)/) || [])[1];
  assert.ok(motif(reg)); assert.equal(motif(sel), motif(reg));
  assert.match(sel, /if \(v == null \|\| \(typeof v === 'string' && !v\.trim\(\)\)\) return null;/);
  assert.deepEqual([...listeEssai(' Prenom+Essai@X.invalid ; autre@x.invalid,')], ['prenom+essai@x.invalid', 'autre@x.invalid']);
  const essai = listeEssai('lea+essai@x.invalid');
  assert.deepEqual(mailsAutorises(C({ email_2: 'LEA+essai@x.invalid' }), essai), ['lea+essai@x.invalid']);
  assert.deepEqual(mailsAutorises(C(), essai), []);
  assert.deepEqual(mailsAutorises(C(), null), ['lea@x.invalid']);
  // contact réel (hors liste) : AUCUN appel, même pas une lecture
  const b = fauxBrevo({ 'lea@x.invalid': { attributes: { STRUCTURE: 'Ancienne' } } });
  const r = await syncContact({ client: b.client, c: C(), links: [], champs: CH, listIds: [7], ours: new Set(['lea@x.invalid']), essai });
  assert.deepEqual(b.appels, []); assert.deepEqual(r.done, []);
  // contact d'essai avec aussi une vraie adresse : seule l'adresse d'essai est touchée
  const b2 = fauxBrevo();
  await syncContact({ client: b2.client, c: C({ email_2: 'lea+essai@x.invalid' }), links: [LR('ESSAI A', false)], champs: CH, listIds: [], ours: new Set(), essai });
  assert.deepEqual([...b2.base.keys()], ['lea+essai@x.invalid']);
  assert.ok(b2.appels.every(a => a[1] === 'lea+essai@x.invalid'));
  // fonction serveur : en mode essai, le filtre passe AVANT tout appel à Brevo (y compris la lecture des champs) ; « tout envoyer » refusé
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  assert.match(src, /"brevo_essai_emails"\]/);
  const un = src.slice(src.indexOf('// Un contact'));
  assert.ok(un.indexOf('if (!mailsAutorises(c as Contact, essai).length) return') > 0 && un.indexOf('if (!mailsAutorises(c as Contact, essai).length) return') < un.indexOf('await attrNames(key)'));
  assert.ok(un.indexOf('await attrNames(key)') < un.indexOf('syncContact('));
  assert.match(un, /champs: a, listIds, ours, essai \}\)/);
  const tout = src.slice(src.indexOf('if (body.all) {'), src.indexOf('// Un contact'));
  assert.match(src, /const \{ m: s, essai \} = await settings\(\);/);   // valeur brute (objet, nombre… = bloqué), par appel (lireReglages)
  assert.ok(tout.indexOf('if (essai) return json({ ok: false') >= 0 && tout.indexOf('if (essai) return json({ ok: false') < tout.indexOf('await attrNames(key)'));
  assert.equal((src.match(/await attrNames\(key\)/g) || []).length, 2);
});

t('relecture B3 : réglages lus PAR APPEL — appels simultanés, l’un en échec de lecture : l’autre reste en mode essai, l’échec s’arrête', async () => {
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const ok = { data: [{ key: 'brevo_api_key', value: 'xkeysib-fictive' }, { key: 'brevo_essai_emails', value: 'lea+essai@x.invalid' }], error: null };
  // même forme que brevo-sync : lecture des réglages, puis d'autres attentes (corps de la requête, compte…), puis décision
  const appel = async (rep, attente) => { await pause(1); const r = lireReglages(rep); await pause(attente); return r.essai ? [...r.essai] : 'NORMAL'; };
  const res = await Promise.allSettled([appel(ok, 20), appel({ data: null, error: { message: 'délai dépassé' } }, 0), appel({ data: [], error: null }, 0), appel(ok, 5)]);
  assert.deepEqual(res[0], { status: 'fulfilled', value: ['lea+essai@x.invalid'] });
  assert.deepEqual(res[3], { status: 'fulfilled', value: ['lea+essai@x.invalid'] });
  for (const r of [res[1], res[2]]) { assert.equal(r.status, 'rejected'); assert.match(r.reason.message, /Lecture des réglages impossible : synchronisation Brevo arrêtée/); }
  assert.equal(lireReglages({ data: [{ key: 'brevo_api_key', value: 'k' }], error: null }).essai, null);   // sans réglage : normal
  assert.deepEqual(lireReglages({ data: [{ key: 'brevo_essai_emails', value: { a: 1 } }], error: null }).essai, new Set());   // valeur brute
  // fonction serveur : aucune variable de module pour les réglages ; settings() passe par lireReglages
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  assert.deepEqual([...src.matchAll(/^let (\w+)/gm)].map(m => m[1]), ['ATTRS']);   // seul cache : noms des champs du compte Brevo
  assert.doesNotMatch(src, /ESSAI_BRUT/);
  assert.match(src, /return lireReglages\(await sb\.from\("settings"\)/);
  assert.match(src, /const \{ m: s, essai \} = await settings\(\);/);
});
t('sauvegarde JSON : la liste d’opposition est exportée (lecture seule du rôle serveur)', () => {
  const bk = readFileSync(new URL('../../supabase/functions/backup-export/index.ts', import.meta.url), 'utf8');
  assert.match(bk, /'prospection_memoire'\]/); assert.match(bk, /prospection_memoire: \['email'\]/);
  const sql = readFileSync(new URL('../../supabase/migrations/2026-11-08_brevo_rattachements.sql', import.meta.url), 'utf8');
  assert.match(sql, /grant select on public\.prospection_memoire to service_role;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*prospection_memoire/i);
});

t('relecture du 09/11 : remise d’une adresse partagée — refusée sans la liste exacte des autres contacts exclus, puis commune ; garde B4', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/2026-11-08_brevo_rattachements.sql', import.meta.url), 'utf8');
  const setp = sql.slice(sql.indexOf('create or replace function public.set_prospection'), sql.indexOf('revoke all on function public.set_prospection'));
  assert.match(setp, /autres := prospection_partages\(p_contact\);/);
  assert.match(setp, /p_avec is null or array\(select unnest\(p_avec\) except select unnest\(autres\)\) <> '\{\}'/);
  assert.match(setp, /where c\.id = any\(tous\);/);
  assert.ok(setp.indexOf('raise exception \'Adresse aussi portée par') < setp.indexOf('delete from prospection_memoire'));   // refus AVANT toute écriture
  assert.match(sql, /with recursive comp\(id, mails\)/);
  // garde B4 en tête : avant toute écriture
  const b4 = sql.indexOf('Migration Brevo arrêtée : la table public.prospection_memoire existe dans une version antérieure');
  assert.ok(b4 > 0 && b4 < sql.indexOf('alter table public.contacts add column'));
  // même règle côté application
  const sel = readFileSync(new URL('../../js/selectors.js', import.meta.url), 'utf8');
  assert.match(sel, /export function contactsExclusPartages\(c\)/);
  const act = readFileSync(new URL('../../js/actions.js', import.meta.url), 'utf8');
  assert.match(act, /if \(ok !== 'tous'\) return;/);
});

let ko = 0;
for (const [nom, f] of cas) { try { await f(); console.log('  ✓ ' + nom); } catch (e) { ko++; console.error('  ✗ ' + nom + '\n    ' + e.message); } }
console.log(`Règles Brevo : ${cas.length - ko}/${cas.length} cas vérifiés.`);
if (ko) process.exit(1);
