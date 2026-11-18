// Règles de la synchronisation Brevo (v1.60.2, structures inactives ; 08/11/2026, ajout et retrait des rattachements, fonctions par
// structure ; contacts « hors prospection », option B) sur de FAUSSES données : aucun appel à Brevo ni à la base (faux client Brevo en mémoire).
// Lancé par « npm test » (node --experimental-strip-types). Module testé : supabase/functions/brevo-sync/regles.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECREATION, aAjouter, attributes, desabonnee, fonctionsParStructure, fonctionsTexte, horsProspection, lireReglages, listeEssai, listeProtegees, mailsAutorises, names, onlyInactive, supprimerContact, syncContact as syncReel } from '../../supabase/functions/brevo-sync/regles.ts';

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
    // PUT /contacts/{email} : seuls les champs envoyés changent ; EMAIL renomme LA MÊME fiche (listes, désabonnement gardés)
    modifier: async (email, corps) => {
      appels.push(['modifier', email, structuredClone(corps)]);
      if (!base.has(email)) return rep(404, 'not found');
      const { EMAIL, ...reste } = corps.attributes;
      if (EMAIL && EMAIL !== email) {
        if (base.has(EMAIL)) return rep(400, '{"code":"duplicate_parameter"}');
        // comme Brevo (documentation de PUT /contacts, constaté à l'essai réel du 16/11) : le désabonnement global saute au renommage
        base.set(EMAIL, { ...base.get(email), emailBlacklisted: false }); base.delete(email); email = EMAIL;
      }
      Object.assign(base.get(email).attributes, reste);
      return rep(204);
    },
    creer: async (corps) => {
      appels.push(['creer', corps.email, structuredClone(corps)]);
      if (base.has(corps.email)) return rep(400, '{"code":"duplicate_parameter","message":"Contact already exist"}');
      base.set(corps.email, { attributes: { ...corps.attributes }, listIds: [...(corps.listIds || [])], emailBlacklisted: false });
      return rep(201, '{"id":1}');
    },
    supprimer: async (email) => { appels.push(['supprimer', email]); if (!base.has(email)) return rep(404); base.delete(email); return rep(204); },
  };
  // tout autre appel (désabonnement, retrait de liste…) n'existe pas : y accéder fait échouer le test
  const garde = new Proxy(client, { get: (o, k) => { if (!(k in o) && typeof k === 'string' && k !== 'then') throw new Error(`appel interdit : ${k}`); return o[k]; } });
  return { client: garde, base, appels };
}
// Faux registre (table brevo_fiches) en mémoire, mêmes règles que celui de la fonction serveur : écritures conditionnelles.
// contacts : les contacts MATRICE (pour savoir qui porte chaque adresse).
function fauxRegistre(lignes = [], contacts = () => []) {
  const m = new Map(lignes.map((f) => [f.email, { champ: null, origine: 'matrice', statut: 'active', detail: null, ...f }]));
  const traces = [];
  const egal = (f, att) => Object.entries(att).every(([k, v]) => (f[k] ?? null) === v);
  return { m, traces,
    deContact: async (id) => [...m.values()].filter((f) => f.contact_id === id).map((f) => ({ ...f })),
    lire: async (e) => (m.has(e) ? { ...m.get(e) } : null),
    changer: async (e, att, patch) => { const f = m.get(e); if (!f || !egal(f, att)) return false; Object.assign(f, patch); return true; },
    reserver: async (f) => { const x = m.get(f.email); if (!x) { m.set(f.email, { detail: null, ...f }); return true; } if (x.statut !== 'supprimee') return false; Object.assign(x, f); return true; },
    renommer: async (a, n, id) => { const t = m.get(n); if (t && t.statut !== 'supprimee') return false; const f = m.get(a); if (!f || f.contact_id !== id || !['active', 'conflit', 'detachee', 'renommage'].includes(f.statut)) return false; m.delete(n); m.delete(a); m.set(n, { ...f, email: n, statut: 'renommage' }); return true; },
    porteurs: async (emails) => { const r = new Map(); for (const e of emails) { const ids = contacts().filter((k) => [k.email, k.email_2].map((x) => String(x || '').trim().toLowerCase()).includes(e)).map((k) => k.id); if (ids.length) r.set(e, ids); } return r; },
    journal: async (e, id, action, detail) => { traces.push([e, id, action, detail]); },
  };
}
// ancienne écriture des tests (ensemble « ours » = adresses créées par MATRICE) : convertie en registre, gardé d'un appel à l'autre
const REG = new WeakMap();
const syncContact = (o) => {
  let r = o.registre;
  if (!r) {
    const cle = o.ours || {};
    r = REG.get(cle) || fauxRegistre([...(o.ours || [])].map((e) => ({ email: e, contact_id: o.c.id, champ: String(o.c.email_2 || '').trim().toLowerCase() === e ? 'email_2' : 'email' })), () => [o.c]);
    REG.set(cle, r);
  }
  return syncReel({ ...o, registre: r });
};
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
t('v1.64 : suppression seulement par supprimerFiche ; jamais de désabonnement, de réabonnement ni de changement de liste', async () => {
  const b = fauxBrevo({ 'lea@x.invalid': {} });
  await sync(b, C(), [], ['lea@x.invalid']);
  assert.deepEqual([...new Set(b.appels.map(a => a[0]))].sort(), ['lire', 'modifier']);
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  const code = src.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
  assert.equal((code.match(/method: "DELETE"/g) || []).length, 1, 'un seul appel de suppression (client.supprimer)');
  assert.doesNotMatch(code, /\/contacts\/lists\/[^`"]*\/contacts\/remove|unlinkListIds|smsBlacklisted|emailBlacklisted\s*:|"emailBlacklisted"/);
  assert.match(src, /syncContact\(\{ client: client\(key\), registre/);
  const reg = readFileSync(new URL('../../supabase/functions/brevo-sync/regles.ts', import.meta.url), 'utf8').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
  assert.doesNotMatch(reg, /unlinkListIds|emailBlacklisted\s*:|listIds:\s*\[\]/);
  assert.equal((reg.match(/client\.supprimer\(/g) || []).length, 1, 'supprimer : uniquement dans supprimerFiche');
  assert.ok(reg.indexOf('client.supprimer(') > reg.indexOf('export async function supprimerFiche') && reg.indexOf('client.supprimer(') < reg.indexOf('async function quitter'));
  // toute mise à jour n'envoie QUE des champs ; une liste n'est donnée qu'à la création
  for (const m of reg.matchAll(/client\.modifier\([^,]+, (\{[^\n]*?\})\)/g)) assert.match(m[1], /^\{ attributes: /);
  const lignes = reg.split('\n').filter(l => /listIds/.test(l));
  for (const l of lignes) assert.ok(/listIds\?: number\[\] \}\): Promise<Rep>|listIds: number\[\]; adoption|const \{ client, registre, c, links, champs, listIds \}|client\.creer\(\{ email, attributes: aCreer, \.\.\.\(listIds\.length && !sansListe \? \{ listIds \} : \{\}\) \}\)/.test(l), l);
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
  assert.match(src, /"brevo_essai_emails"/);
  const un = src.slice(src.indexOf('// Un contact'));
  const garde = 'if (!mailsAutorises(c as Contact, essai).length && !fiches.some((f) => !essai || essai.has(f.email))) return';
  assert.ok(un.indexOf(garde) > 0 && un.indexOf(garde) < un.indexOf('await attrNames(key)'));
  assert.ok(un.indexOf('await attrNames(key)') < un.indexOf('syncContact('));
  assert.match(un, /champs: a, listIds, essai, protegees, adoption \}\)/);
  const tout = src.slice(src.indexOf('if (body.all) {'), src.indexOf('// Un contact'));
  assert.match(src, /const \{ m: s, essai \} = await settings\(\);/);   // valeur brute (objet, nombre… = bloqué), par appel (lireReglages)
  assert.ok(tout.indexOf('if (essai) return json({ ok: false') >= 0 && tout.indexOf('if (essai) return json({ ok: false') < tout.indexOf('await attrNames(key)'));
  assert.equal((src.match(/await attrNames\(key\)/g) || []).length, 3);   // un contact, tout envoyer, adoption (refusée en mode essai avant tout appel)
  assert.ok(src.indexOf('adoption désactivée pendant l’essai') < src.indexOf('return json(await adopter('));
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
  assert.match(bk, /'prospection_memoire',/); assert.match(bk, /'brevo_fiches', 'brevo_journal'\]/); assert.match(bk, /brevo_fiches: \['email'\]/); assert.match(bk, /prospection_memoire: \['email'\]/);
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

// ───────────── v1.64 (décisions d'Anthony du 16/11/2026) : MATRICE fait référence ─────────────
// Contacts MATRICE simulés (pour « qui porte cette adresse ») ; registre explicite ; fiches Brevo avec listes et désabonnements.
const P = { first: 'PRENOM', last: 'NOM', struct: 'STRUCTURE' };
const env = (fiches = {}, lignes = [], contacts = []) => {
  const b = fauxBrevo(fiches); const ks = [...contacts]; const r = fauxRegistre(lignes, () => ks);
  const run = (c, o = {}) => { const i = ks.findIndex(k => k.id === c.id); if (i >= 0) ks[i] = c; else ks.push(c);
    return syncReel({ client: b.client, registre: r, c, links: o.links || [LR('Salle A', false)], champs: P, listIds: [7], essai: o.essai ?? null, protegees: o.protegees || new Set(), adoption: !!o.adoption }); };
  const del = (id, o = {}) => { const i = ks.findIndex(k => k.id === id); if (i >= 0) ks.splice(i, 1);
    return supprimerContact({ client: b.client, registre: r, contactId: id, essai: o.essai ?? null, protegees: o.protegees || new Set() }); };
  return { b, r, ks, run, del };
};
const ecritures = (b) => b.appels.filter(a => a[0] !== 'lire');

t('v1.64 règle 1 : création puis modification = fiche créée (liste donnée UNE fois) puis champs à jour, registre « matrice »', async () => {
  const x = env();
  await x.run(C());
  assert.deepEqual(x.b.base.get('lea@x.invalid').listIds, [7]);
  assert.equal(x.r.m.get('lea@x.invalid').statut, 'active'); assert.equal(x.r.m.get('lea@x.invalid').origine, 'matrice');
  x.b.base.get('lea@x.invalid').listIds = [];   // la personne s'est retirée de la liste dans Brevo
  await x.run(C({ first_name: 'Léana' }));
  assert.equal(x.b.base.get('lea@x.invalid').attributes.PRENOM, 'Léana');
  assert.deepEqual(x.b.base.get('lea@x.invalid').listIds, [], 'jamais réinscrite dans une liste');
  assert.equal(x.b.appels.filter(a => a[0] === 'creer').length, 1);
});
t('v1.64 règles 2 et 9 : changement d’adresse (fiche abonnée) = MÊME fiche renommée (listes, champs gardés), aucun doublon', async () => {
  const x = env({ 'lea@x.invalid': { attributes: { PRENOM: 'Léa', PREF: 'mensuelle' }, listIds: [3] } },
    [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const r = await x.run(C({ email: 'lea.martin@x.invalid' }));
  assert.deepEqual(r.renamed, ['lea.martin@x.invalid']); assert.deepEqual(r.errors, []);
  assert.equal(x.b.base.has('lea@x.invalid'), false); assert.equal(x.b.base.size, 1);
  assert.deepEqual(x.b.base.get('lea.martin@x.invalid'), { attributes: { PRENOM: 'Léa', PREF: 'mensuelle', NOM: 'Martin', STRUCTURE: 'Salle A' }, listIds: [3], emailBlacklisted: false });
  assert.equal(x.r.m.has('lea@x.invalid'), false); assert.equal(x.r.m.get('lea.martin@x.invalid').statut, 'active');
  assert.equal(x.b.appels.filter(a => ['creer', 'supprimer'].includes(a[0])).length, 0);
});
t('v1.64 règle 9 : nouvelle adresse déjà présente dans Brevo = conflit signalé, aucune fusion ni suppression', async () => {
  const x = env({ 'lea@x.invalid': { listIds: [7] }, 'autre@x.invalid': { attributes: { PRENOM: 'Autre' }, listIds: [9] } },
    [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const avant = structuredClone([...x.b.base]);
  const r = await x.run(C({ email: 'autre@x.invalid' }));
  assert.deepEqual(r.conflicts, ['lea@x.invalid']);
  assert.deepEqual([...x.b.base], avant, 'Brevo inchangé');
  assert.equal(x.r.m.get('lea@x.invalid').statut, 'conflit'); assert.match(x.r.m.get('lea@x.invalid').detail, /autre@x\.invalid/);
  // l'autre fiche est libérée dans Brevo : le changement d'adresse se fait au passage suivant
  x.b.base.delete('autre@x.invalid');
  const r2 = await x.run(C({ email: 'autre@x.invalid' }));
  assert.deepEqual(r2.renamed, ['autre@x.invalid']); assert.equal(x.r.m.get('autre@x.invalid').statut, 'active');
});
t('v1.64 règles 3 et 2 : contact supprimé = fiche MATRICE supprimée ; désabonnée = conservée ; préexistante = jamais supprimée', async () => {
  const x = env({ 'a@x.invalid': {}, 'b@x.invalid': { emailBlacklisted: true }, 'c@x.invalid': { listUnsubscribed: [7] }, 'd@x.invalid': {} },
    [{ email: 'a@x.invalid', contact_id: 'k1' }, { email: 'b@x.invalid', contact_id: 'k1' }, { email: 'c@x.invalid', contact_id: 'k2' }, { email: 'd@x.invalid', contact_id: 'k3', origine: 'preexistante' }]);
  for (const id of ['k1', 'k2', 'k3']) await x.del(id);
  assert.deepEqual([...x.b.base.keys()].sort(), ['b@x.invalid', 'c@x.invalid', 'd@x.invalid']);
  assert.deepEqual(x.b.appels.filter(a => a[0] === 'supprimer').map(a => a[1]), ['a@x.invalid']);
  assert.equal(x.r.m.get('a@x.invalid').statut, 'supprimee');
  for (const e of ['b@x.invalid', 'c@x.invalid', 'd@x.invalid']) assert.equal(x.r.m.get(e).statut, 'detachee');
  assert.equal(x.r.m.get('d@x.invalid').contact_id, null);   // désabonnées : gardent leur contact et emplacement (reprise sans nouvelle fiche)
  assert.ok(x.r.traces.some(j => j[0] === 'a@x.invalid' && j[2] === 'supprimee'));
  assert.equal(desabonnee('pas du json'), true, 'réponse illisible : jamais de suppression');
});
t('v1.64 règle 7 (2e adresse) : retirer le mail 2 suit les règles de suppression ; le mail 1 est seulement mis à jour', async () => {
  const x = env({ 'lea@x.invalid': {}, 'perso@x.invalid': {} }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }, { email: 'perso@x.invalid', contact_id: 'k1', champ: 'email_2' }]);
  const r = await x.run(C({ email_2: null }));
  assert.deepEqual(r.removed, ['perso@x.invalid']); assert.deepEqual(r.updated, ['lea@x.invalid']);
  assert.equal(x.b.base.has('perso@x.invalid'), false); assert.equal(x.b.base.has('lea@x.invalid'), true);
});
t('v1.64 règle 4 : adresse partagée par plusieurs contacts = aucune opération (ni mise à jour, ni création, ni suppression)', async () => {
  const autre = { id: 'k2', email: 'lea@x.invalid', first_name: 'Autre', last_name: 'Personne', display_name: 'Autre Personne' };
  const x = env({ 'lea@x.invalid': { attributes: { PRENOM: 'Ancien' } } }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }], [autre]);
  const r = await x.run(C());
  assert.deepEqual(r.protected, ['lea@x.invalid']); assert.deepEqual(ecritures(x.b), []);
  assert.equal(x.b.base.get('lea@x.invalid').attributes.PRENOM, 'Ancien');
  // un contact qui porte l'adresse est supprimé : la fiche revient à l'autre contact, jamais supprimée
  const s = await x.del('k1');
  assert.deepEqual(s.fiches, [{ email: 'lea@x.invalid', action: 'transferee' }]);
  assert.equal(x.r.m.get('lea@x.invalid').contact_id, 'k2'); assert.equal(x.b.base.has('lea@x.invalid'), true);
  const x2 = env({}, [], [autre]);
  await x2.run(C()); assert.equal(x2.b.base.size, 0, 'adresse partagée absente de Brevo : pas créée');
});
t('v1.64 règle 5 : adresse protégée (anthony@) = aucun appel, même pas une lecture, ni à la suppression', async () => {
  const prot = listeProtegees('anthony@lartboristerie.com');
  const x = env({ 'anthony@lartboristerie.com': { attributes: { PRENOM: 'Anthony' } } }, [{ email: 'anthony@lartboristerie.com', contact_id: 'k1', champ: 'email' }]);
  await x.run(C({ email: 'anthony@lartboristerie.com' }), { protegees: prot });
  await x.run(C({ email: 'nouvelle@x.invalid' }), { protegees: prot });   // même un changement d'adresse ne la renomme pas
  await x.del('k1', { protegees: prot });
  assert.ok(x.b.appels.every(a => a[1] !== 'anthony@lartboristerie.com'));
  assert.deepEqual(x.b.base.get('anthony@lartboristerie.com').attributes, { PRENOM: 'Anthony' });
});
t('v1.64 règle 6 : fiche gérée supprimée à la main dans Brevo = jamais recréée automatiquement (signalée)', async () => {
  const x = env({}, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const r = await x.run(C()); const r2 = await x.run(C({ first_name: 'Léa2' }));
  assert.deepEqual(r.deletedInBrevo, ['lea@x.invalid']); assert.deepEqual(r2.deletedInBrevo, ['lea@x.invalid']);
  assert.equal(x.b.appels.filter(a => a[0] === 'creer').length, 0); assert.equal(x.r.m.get('lea@x.invalid').statut, 'supprimee_brevo');
  // fiche détachée (désabonnée conservée) supprimée ensuite dans Brevo, puis reprise par un contact : pas recréée non plus
  const y = env({}, [{ email: 'lea@x.invalid', contact_id: null, statut: 'detachee' }]);
  await y.run(C()); assert.equal(y.b.base.size, 0); assert.equal(y.r.m.get('lea@x.invalid').statut, 'supprimee_brevo');
  // recréation volontaire (brevo_recreer : statut remis à « supprimee ») : recréée
  x.r.m.get('lea@x.invalid').statut = 'supprimee';
  await x.run(C()); assert.equal(x.b.base.has('lea@x.invalid'), true);
});
t('v1.64 règle 7 : import en masse aux mêmes règles (registre « matrice », protégées, partagées, fiches supprimées dans Brevo écartées)', () => {
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  const tout = src.slice(src.indexOf('if (body.all) {'), src.indexOf('// Un contact'));
  assert.match(tout, /if \(known\.has\(e\) \|\| seen\.has\(e\) \|\| protegees\.has\(e\) \|\| \(porteurs\.get\(e\) \|\| \[\]\)\.length > 1\) continue;/);
  assert.match(tout, /if \(f && f\.statut !== "supprimee"\) continue;/);
  assert.match(tout, /registre\.reserver\(\{ email: x\.email, contact_id: x\.c\.id, champ: x\.champ, origine: "matrice", statut: "creation" \}\)/);
  assert.ok(tout.indexOf('registre.reserver(') < tout.indexOf('/contacts/import'), 'réservé au registre avant l’import');
  assert.match(tout, /updateExistingContacts: false/);
});
t('v1.64 adoption : fiche préexistante jamais touchée sans autorisation ; adoptée = mise à jour et renommage, jamais supprimée', async () => {
  const x = env({ 'lea@x.invalid': { attributes: { PRENOM: 'Ancien' }, listIds: [2] } });
  await x.run(C());
  assert.deepEqual(ecritures(x.b), []); assert.equal(x.r.m.size, 0);
  await x.run(C(), { adoption: true });
  assert.equal(x.r.m.get('lea@x.invalid').origine, 'preexistante'); assert.equal(x.b.base.get('lea@x.invalid').attributes.PRENOM, 'Léa');
  await x.run(C({ email: 'lea2@x.invalid' }), { adoption: true });
  assert.equal(x.b.base.has('lea2@x.invalid'), true); assert.deepEqual(x.b.base.get('lea2@x.invalid').listIds, [2]);
  await x.del('k1');
  assert.equal(x.b.base.has('lea2@x.invalid'), true); assert.equal(x.r.m.get('lea2@x.invalid').statut, 'detachee');
  assert.equal(x.b.appels.filter(a => a[0] === 'supprimer').length, 0);
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  assert.match(src, /body\.adoption === "executer" && body\.confirmer === "ADOPTER"/);
  assert.match(src, /adoption = String\(s\.brevo_adoption \|\| ""\)\.trim\(\) === "oui"/);
});
t('v1.64 modifications concurrentes : deux synchronisations simultanées = une seule création, un seul renommage', async () => {
  const x = env();
  await Promise.all([x.run(C()), x.run(C())]);
  assert.equal(x.b.appels.filter(a => a[0] === 'creer').length, 1); assert.equal(x.b.base.size, 1);
  await Promise.all([x.run(C({ email: 'n@x.invalid' })), x.run(C({ email: 'n@x.invalid' }))]);
  assert.equal(x.b.appels.filter(a => a[0] === 'modifier' && a[2].attributes.EMAIL).length, 1);
  assert.deepEqual([...x.b.base.keys()], ['n@x.invalid']);
});
t('v1.64 règles 8 et 10 : rien ne remonte de Brevo vers MATRICE ; la prospection Gmail ignore les désabonnements Brevo', () => {
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  const ecr = [...src.matchAll(/sb\.from\("([a-z_]+)"\)\.(update|insert|upsert|delete)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ecr)].sort(), ['brevo_fiches', 'brevo_journal', 'contacts', 'settings']);
  assert.match(src, /sb\.from\("contacts"\)\.update\(\{ brevo_at: new Date\(\)\.toISOString\(\), brevo_error: err \}\)/);
  for (const f of ['js/prospection.js', 'js/mailbox.js', 'apps-script/Prospection.gs']) {
    const t2 = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(t2, /brevo_fiches|emailBlacklisted|desabonn/i, f);
  }
});
t('v1.64 SQL : registre amorcé sans rien supprimer ; contact supprimé relayé ; recréation réservée à l’équipe', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/2026-11-16_v1.64.0_brevo_reference.sql', import.meta.url), 'utf8');
  const code = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /\bdrop table|\bdelete from|\btruncate|alter table public\.contacts/i);
  assert.match(code, /create trigger brevo_contact_supprime after delete on public\.contacts/);
  assert.match(code, /on conflict \(email\) do nothing/);
  assert.match(code, /'brevo_protegees', to_jsonb\('anthony@lartboristerie\.com'::text\)\)\s*on conflict \(key\) do nothing/);
  assert.match(code, /function public\.brevo_recreer[\s\S]*?if not public\.is_team\(\)/);
  assert.match(code, /grant execute on function public\.brevo_porteurs\(text\[\]\) to service_role;/);
  assert.doesNotMatch(code, /insert into public\.settings \(key, value\) values \('brevo_adoption'/, 'adoption jamais activée par la migration');
});

// ───────────── relecture indépendante v1.64 (16/11) : 3 bloquants corrigés ─────────────
t('relecture B1 : adresse mal saisie = rien supprimé ; corrigée ensuite = MÊME fiche renommée (pas de suppression puis création)', async () => {
  const x = env({ 'lea@x.invalid': { listIds: [7] } }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const r = await x.run(C({ email: 'lea@nouveau' }));
  assert.deepEqual(r.removed, []); assert.deepEqual(ecritures(x.b), []); assert.match(x.r.m.get('lea@x.invalid').detail, /non valide/);
  const r2 = await x.run(C({ email: 'lea@nouveau.fr' }));
  assert.deepEqual(r2.renamed, ['lea@nouveau.fr']); assert.deepEqual([...x.b.base.keys()], ['lea@nouveau.fr']);
  assert.deepEqual(x.b.base.get('lea@nouveau.fr').listIds, [7]);
});
t('relecture B1 + décision du 17/11 : adresse désabonnée vidée et autre adresse saisie — même enregistrement = remplacement BLOQUÉ ; deux enregistrements = nouvelle adresse créée SANS liste', async () => {
  // a) même enregistrement : remplacement → conflit, rien créé, fiche désabonnée intacte
  const x = env({ 'lea@x.invalid': { listIds: [], listUnsubscribed: [7] } }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const r = await x.run(C({ email: null, email_2: 'perso@x.invalid' }));
  assert.deepEqual(r.conflicts, ['lea@x.invalid']); assert.deepEqual(r.created, []); assert.deepEqual(r.enAttente, ['perso@x.invalid']);
  assert.deepEqual(ecritures(x.b), [], 'aucune écriture dans Brevo');
  assert.equal(x.r.m.get('lea@x.invalid').statut, 'conflit'); assert.match(x.r.m.get('lea@x.invalid').detail, /remplacement bloqué/);
  await x.run(C({ email: null, email_2: 'perso@x.invalid', first_name: 'Autre' }));   // toujours bloqué
  assert.deepEqual(ecritures(x.b), []);
  // b) deux enregistrements : adresse vidée (fiche désabonnée conservée), puis vraie nouvelle adresse = créée SANS liste
  const y = env({ 'lea@x.invalid': { listIds: [], listUnsubscribed: [7] } }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  await y.run(C({ email: null }));
  assert.equal(y.r.m.get('lea@x.invalid').statut, 'detachee'); assert.equal(y.b.base.has('lea@x.invalid'), true);
  const r2 = await y.run(C({ email: null, email_2: 'perso@x.invalid' }));
  assert.deepEqual(r2.created, ['perso@x.invalid']); assert.deepEqual(y.b.base.get('perso@x.invalid').listIds, [], 'jamais inscrite à une liste');
  assert.ok(y.r.traces.some(j => j[0] === 'perso@x.invalid' && j[2] === 'creee' && /sans liste/.test(j[3])));
  assert.deepEqual(y.b.base.get('lea@x.invalid').listUnsubscribed, [7], 'désabonnement intact');
  // c) même emplacement repris par une nouvelle adresse : renommage bloqué (option 2), rien créé
  const r3 = await y.run(C({ email: 'lea.nouvelle@x.invalid', email_2: 'perso@x.invalid' }));
  assert.deepEqual(r3.renamed, []); assert.equal(y.b.base.has('lea.nouvelle@x.invalid'), false);
});

t('relecture B2 : changement vers une adresse partagée ou protégée = conflit, l’ancienne fiche n’est jamais supprimée', async () => {
  const autre = { id: 'k2', email: 'commune@x.invalid', first_name: 'A', last_name: 'B', display_name: 'A B' };
  const x = env({ 'lea@x.invalid': {} }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }], [autre]);
  const r = await x.run(C({ email: 'commune@x.invalid' }));
  assert.deepEqual(r.removed, []); assert.deepEqual(r.conflicts, ['lea@x.invalid']); assert.equal(x.b.base.has('lea@x.invalid'), true);
  assert.deepEqual(ecritures(x.b), []);
  const y = env({ 'lea@x.invalid': {} }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  await y.run(C({ email: 'anthony@lartboristerie.com' }), { protegees: listeProtegees('anthony@lartboristerie.com') });
  assert.equal(y.b.base.has('lea@x.invalid'), true); assert.deepEqual(ecritures(y.b), []); assert.equal(y.r.m.get('lea@x.invalid').statut, 'conflit');
});
t('relecture B3 : synchronisation pendant un renommage = opération en cours respectée, jamais « supprimée dans Brevo » à tort', async () => {
  const x = env({ 'lea@x.invalid': {} }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const modif = x.b.client.modifier; let lache; const verrou = new Promise(r => { lache = r; });
  x.b.client.modifier = async (e, corps) => { if (corps.attributes.EMAIL) await verrou; return modif(e, corps); };
  const c = C({ email: 'lea.neuf@x.invalid' });
  const p1 = x.run(c);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(x.r.m.get('lea.neuf@x.invalid').statut, 'renommage');
  const r2 = await x.run(c);   // deuxième synchronisation (rattachements) pendant le PUT
  assert.deepEqual(r2.deletedInBrevo, []); assert.equal(x.b.appels.filter(a => a[0] === 'creer').length, 0);
  lache(); await p1;
  assert.equal(x.r.m.get('lea.neuf@x.invalid').statut, 'active'); assert.deepEqual([...x.b.base.keys()], ['lea.neuf@x.invalid']);
});

t('relecture 2 (16/11) : fiche désabonnée détachée dont l’adresse est reprise par un AUTRE contact = jamais renommée ni réinscrite', async () => {
  const ks = [];
  const x = env({ 'a@x.invalid': { listIds: [], listUnsubscribed: [7] } }, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email' }], ks);
  await x.run(C({ email: null }));                           // k1 perd a (désabonnée) : détachée, gardée
  x.ks.push({ id: 'kX', email: 'a@x.invalid', first_name: 'X', last_name: 'Y', display_name: 'X Y' });   // un autre contact porte a
  const r = await x.run(C({ email: 'n@x.invalid' }));        // k1 reçoit n : PAS de renommage de a
  assert.deepEqual(r.renamed, []); assert.deepEqual(x.b.base.get('a@x.invalid').listUnsubscribed, [7]);
  assert.equal(x.b.base.has('a@x.invalid'), true);
  const r2 = await x.run({ id: 'kX', email: 'a@x.invalid', first_name: 'X', last_name: 'Y', display_name: 'X Y' });
  assert.equal(x.b.appels.filter(a => a[0] === 'creer' && a[1] === 'a@x.invalid').length, 0, 'jamais recréée abonnée');
  assert.equal(x.b.base.get('a@x.invalid').listUnsubscribed.length, 1);
});
t('relecture 2 : erreur réseau pendant un renommage ou une création = registre remis en l’état, rien de bloqué', async () => {
  const x = env({ 'lea@x.invalid': {} }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  x.b.client.modifier = async () => { throw new Error('réseau coupé'); };
  const r = await x.run(C({ email: 'neuf@x.invalid' }));
  assert.equal(r.errors.length, 1); assert.equal(x.r.m.get('lea@x.invalid').statut, 'active'); assert.equal(x.r.m.has('neuf@x.invalid'), false);
  const y = env();
  y.b.client.creer = async () => { throw new Error('réseau coupé'); };
  const r2 = await y.run(C());
  assert.equal(r2.errors.length, 1); assert.equal(y.r.m.get('lea@x.invalid').statut, 'supprimee');
});

t('décision du 16/11 : fiche supprimée dans Brevo = nouvelle adresse du contact NON créée non plus ; « Recréer » la débloque', async () => {
  // a) déjà notée supprimée dans Brevo, puis changement d'adresse
  const x = env({}, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email', statut: 'supprimee_brevo' }]);
  const r = await x.run(C({ email: 'lea.neuf@x.invalid' }));
  assert.equal(x.b.appels.filter(a => a[0] === 'creer').length, 0); assert.deepEqual(r.deletedInBrevo, ['lea.neuf@x.invalid']);
  assert.equal(x.r.m.get('lea.neuf@x.invalid').statut, 'supprimee_brevo');
  await x.run(C({ email: 'lea.neuf@x.invalid', first_name: 'Autre' }));
  assert.equal(x.b.appels.filter(a => a[0] === 'creer').length, 0, 'toujours bloquée aux passages suivants');
  Object.assign(x.r.m.get('lea.neuf@x.invalid'), { statut: 'supprimee', contact_id: null, champ: null, detail: RECREATION });   // brevo_recreer
  await x.run(C({ email: 'lea.neuf@x.invalid' })); assert.equal(x.b.base.has('lea.neuf@x.invalid'), true);
  // b) découverte au moment du renommage (404) : ni recréée, ni nouvelle fiche
  const y = env({}, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  await y.run(C({ email: 'lea.neuf@x.invalid' }));
  assert.equal(y.b.appels.filter(a => a[0] === 'creer').length, 0); assert.equal(y.b.base.size, 0);
  assert.equal(y.r.m.get('lea@x.invalid').statut, 'supprimee_brevo'); assert.equal(y.r.m.get('lea.neuf@x.invalid').statut, 'supprimee_brevo');
  assert.ok(y.r.traces.some(t => t[2] === 'bloquee'));
});

t('relecture 3 : le blocage d’une fiche supprimée dans Brevo ne passe jamais à une autre adresse gérée du contact', async () => {
  const x = env({ 'b@x.invalid': {} }, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email', statut: 'supprimee_brevo' }, { email: 'b@x.invalid', contact_id: 'k1', champ: 'email_2' }]);
  await x.run(C({ email: 'b@x.invalid', email_2: null }));   // a retiré, b remonte en mail 1
  const r = await x.run(C({ email: 'e@x.invalid', email_2: null }));
  assert.deepEqual(r.renamed, ['e@x.invalid']); assert.deepEqual(r.removed, []); assert.deepEqual([...x.b.base.keys()], ['e@x.invalid']);
  // nouvelle adresse déjà connue comme « supprimée par MATRICE » : le blocage s'applique quand même
  const y = env({}, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email', statut: 'supprimee_brevo' }, { email: 'n@x.invalid', contact_id: null, statut: 'supprimee' }]);
  await y.run(C({ email: 'n@x.invalid' }));
  assert.equal(y.b.appels.filter(a => a[0] === 'creer').length, 0); assert.equal(y.r.m.get('n@x.invalid').statut, 'supprimee_brevo');
});

t('décision du 16/11 — cas ambigu des deux adresses : rien supprimé, rien renommé, rien créé tant que le conflit n’est pas résolu', async () => {
  const deux = () => env({ 'a@x.invalid': { listIds: [7] }, 'b@x.invalid': { listIds: [], listUnsubscribed: [7] } },
    [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email' }, { email: 'b@x.invalid', contact_id: 'k1', champ: 'email_2' }]);
  // a) mail 1 vidé et mail 2 changé dans le même enregistrement
  const x = deux();
  const r = await x.run(C({ email: null, email_2: 'c@x.invalid' }));
  assert.deepEqual(r.removed, []); assert.deepEqual(r.renamed, []); assert.deepEqual(r.created, []); assert.deepEqual(r.enAttente, ['c@x.invalid']);
  assert.deepEqual(ecritures(x.b), [], 'aucune écriture dans Brevo');
  assert.deepEqual([...x.b.base.keys()].sort(), ['a@x.invalid', 'b@x.invalid']);
  assert.equal(x.r.m.get('a@x.invalid').statut, 'conflit'); assert.equal(x.r.m.get('b@x.invalid').statut, 'conflit');
  assert.match(x.r.m.get('a@x.invalid').detail, /Remets l’une des deux anciennes adresses/);
  assert.equal(x.r.m.has('c@x.invalid'), false);
  // une nouvelle synchronisation (rattachement…) sans correction : toujours rien
  await x.run(C({ email: null, email_2: 'c@x.invalid', first_name: 'Autre' }));
  assert.deepEqual(ecritures(x.b), []);
  // résolution : l'équipe remet b en mail 2, enregistre (a retiré seul = règle de retrait), puis change b
  const r2 = await x.run(C({ email: null, email_2: 'b@x.invalid' }));
  assert.deepEqual(r2.removed, ['a@x.invalid']); assert.equal(x.r.m.get('b@x.invalid').statut, 'active');
  const r3 = await x.run(C({ email: null, email_2: 'c@x.invalid' }));   // b est désabonnée : changement bloqué (option 2)
  assert.deepEqual(r3.renamed, []); assert.deepEqual(r3.conflicts, ['b@x.invalid']); assert.equal(x.b.base.has('c@x.invalid'), false);
  assert.deepEqual(x.b.base.get('b@x.invalid').listUnsubscribed, [7], 'désabonnement gardé');
  // b) mail 2 remonté en mail 1 et nouveau mail 2 : ambigu aussi
  const y = deux();
  const s = await y.run(C({ email: 'b@x.invalid', email_2: 'd@x.invalid' }));
  assert.deepEqual(s.removed, []); assert.deepEqual(s.renamed, []); assert.deepEqual(s.created, []);
  assert.deepEqual(ecritures(y.b).filter(a => a[0] !== 'modifier' || a[2].attributes.EMAIL), [], 'seule la mise à jour des champs de b');
  assert.equal(y.r.m.get('a@x.invalid').statut, 'conflit'); assert.equal(y.b.base.has('a@x.invalid'), true);
  const s2 = await y.run(C({ email: 'b@x.invalid', email_2: 'd@x.invalid', first_name: 'Autre' }));   // synchronisation suivante : toujours gelé
  assert.deepEqual(s2.removed, []); assert.deepEqual(s2.created, []); assert.equal(y.b.base.has('a@x.invalid'), true);
  assert.equal(y.r.m.get('b@x.invalid').champ, 'email_2', 'emplacements du registre inchangés pendant le conflit');
  // c) cas NON ambigus inchangés : un seul emplacement changé = renommage ; inversion mail 1 / mail 2 = rien ; retrait seul = retrait
  const z = env({ 'a@x.invalid': { listIds: [7] }, 'b@x.invalid': { listIds: [7] } },   // b abonnée ici (la désabonnée est bloquée : option 2)
    [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email' }, { email: 'b@x.invalid', contact_id: 'k1', champ: 'email_2' }]);
  const u = await z.run(C({ email: 'a@x.invalid', email_2: 'e@x.invalid' }));
  assert.deepEqual(u.renamed, ['e@x.invalid']); assert.deepEqual(u.conflicts, []);
  const w = deux();
  const v = await w.run(C({ email: 'b@x.invalid', email_2: 'a@x.invalid' }));
  assert.deepEqual(v.removed, []); assert.deepEqual(v.conflicts, []); assert.deepEqual(v.renamed, []);
  const q = deux();
  const qq = await q.run(C({ email: 'b@x.invalid', email_2: null }));
  assert.deepEqual(qq.removed, ['a@x.invalid']); assert.deepEqual(qq.conflicts, []);
});

t('option 2 (16/11) : fiche désabonnée (globalement ou d’une liste) = changement d’adresse bloqué, rien créé, abonnement jamais touché', async () => {
  for (const etat of [{ emailBlacklisted: true }, { listUnsubscribed: [7] }]) {
    const x = env({ 'lea@x.invalid': { listIds: [3], ...etat } }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
    const avant = structuredClone([...x.b.base]);
    const r = await x.run(C({ email: 'lea.neuf@x.invalid' }));
    assert.deepEqual(r.renamed, []); assert.deepEqual(r.created, []); assert.deepEqual(r.removed, []); assert.deepEqual(r.conflicts, ['lea@x.invalid']);
    assert.deepEqual([...x.b.base], avant, 'Brevo strictement inchangé');
    assert.deepEqual(ecritures(x.b), [], 'aucune écriture dans Brevo');
    assert.equal(x.r.m.get('lea@x.invalid').statut, 'conflit'); assert.match(x.r.m.get('lea@x.invalid').detail, /désabonnée.*bloqué/);
    assert.equal(x.r.m.has('lea.neuf@x.invalid'), false);
    // synchronisations suivantes sans correction : toujours bloqué, aucun doublon au journal
    await x.run(C({ email: 'lea.neuf@x.invalid', first_name: 'Autre' })); await x.run(C({ email: 'lea.neuf@x.invalid' }));
    assert.deepEqual(ecritures(x.b), []);
    assert.equal(x.r.traces.filter(j => j[2] === 'conflit').length, 1, 'une seule ligne au journal');
    // retour à l'ancienne adresse : conflit levé, champs mis à jour, abonnement inchangé
    await x.run(C());
    assert.equal(x.r.m.get('lea@x.invalid').statut, 'active'); assert.deepEqual(x.b.base.get('lea@x.invalid').listIds, [3]);
    assert.equal(!!x.b.base.get('lea@x.invalid').emailBlacklisted, !!etat.emailBlacklisted);
  }
});
t('journal : un conflit inchangé n’ajoute aucune ligne (cas ambigu, adresse déjà présente dans Brevo)', async () => {
  const x = env({ 'a@x.invalid': {}, 'b@x.invalid': {} }, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email' }, { email: 'b@x.invalid', contact_id: 'k1', champ: 'email_2' }]);
  for (let i = 0; i < 3; i++) await x.run(C({ email: null, email_2: 'c@x.invalid', first_name: 'N' + i }));
  assert.equal(x.r.traces.filter(j => j[2] === 'conflit').length, 2, 'une ligne par fiche, pas une par synchronisation');
  const y = env({ 'lea@x.invalid': {}, 'autre@x.invalid': {} }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  for (let i = 0; i < 3; i++) await y.run(C({ email: 'autre@x.invalid', first_name: 'N' + i }));
  assert.equal(y.r.traces.filter(j => j[2] === 'conflit').length, 1);
  y.b.base.set('autre2@x.invalid', { attributes: {}, listIds: [], emailBlacklisted: false });
  await y.run(C({ email: 'autre2@x.invalid' }));   // explication différente : nouvelle ligne (rien d'avalé)
  assert.equal(y.r.traces.filter(j => j[2] === 'conflit').length, 2);
});

t('décision du 17/11 : vraie deuxième adresse d’un contact désabonné = créée SANS liste, fiche désabonnée intacte ; suppression d’une adresse désabonnée = fiche gardée', async () => {
  const x = env({ 'lea@x.invalid': { listIds: [3], emailBlacklisted: true } }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const r = await x.run(C({ email_2: 'pro@x.invalid' }));
  assert.deepEqual(r.created, ['pro@x.invalid']); assert.deepEqual(x.b.base.get('pro@x.invalid').listIds, []);
  assert.equal(x.b.base.get('lea@x.invalid').emailBlacklisted, true); assert.deepEqual(x.b.base.get('lea@x.invalid').listIds, [3]);
  assert.equal(x.b.appels.filter(a => a[0] === 'modifier' && a[1] === 'lea@x.invalid' && a[2].attributes.EMAIL).length, 0);
  // l'adresse désabonnée retirée du contact : fiche gardée dans Brevo (historique du désabonnement conservé)
  const r2 = await x.run(C({ email: null, email_2: 'pro@x.invalid' }));
  assert.deepEqual(r2.created, []); assert.equal(x.b.base.has('lea@x.invalid'), true); assert.equal(x.b.base.get('lea@x.invalid').emailBlacklisted, true);
  assert.equal(x.r.m.get('lea@x.invalid').statut, 'detachee');
  // contact supprimé : la fiche désabonnée reste, l'autre (abonnée, créée par MATRICE) est supprimée
  await x.del('k1');
  assert.equal(x.b.base.has('lea@x.invalid'), true); assert.equal(x.b.base.has('pro@x.invalid'), false);
  // sans opposition : la liste est donnée comme avant
  const y = env({ 'lea@x.invalid': { listIds: [7] } }, [{ email: 'lea@x.invalid', contact_id: 'k1', champ: 'email' }]);
  await y.run(C({ email_2: 'pro@x.invalid' }));
  assert.deepEqual(y.b.base.get('pro@x.invalid').listIds, [7]);
});
t('décision du 17/11 : fiche supprimée à la main dans Brevo = AUCUNE nouvelle fiche pour ce contact, quel que soit l’emplacement ; « Recréer » ne débloque que son adresse', async () => {
  const x = env({ 'b@x.invalid': { listIds: [7] } }, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email', statut: 'supprimee_brevo' }, { email: 'b@x.invalid', contact_id: 'k1', champ: 'email_2' }]);
  // b remonte en mail 1, nouvelle adresse en mail 2 (cas de la relecture R2), puis une autre adresse encore
  const r = await x.run(C({ email: 'b@x.invalid', email_2: 'n@x.invalid', first_name: 'Neuf' }));
  assert.deepEqual(r.created, []); assert.ok(r.deletedInBrevo.includes('n@x.invalid'));
  assert.equal(x.r.m.get('n@x.invalid').statut, 'supprimee_brevo'); assert.equal(x.b.base.has('n@x.invalid'), false);
  assert.equal(x.b.base.get('b@x.invalid').attributes.PRENOM, 'Neuf', 'fiche existante toujours synchronisée'); assert.deepEqual(x.b.base.get('b@x.invalid').listIds, [7]);
  const y = env({}, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email', statut: 'supprimee_brevo' }]);
  await y.run(C({ email: 'a@x.invalid', email_2: 'm@x.invalid' }));   // a toujours portée en mail 1, m saisie en mail 2
  await y.run(C({ email: 'a@x.invalid', email_2: 'm@x.invalid' }));
  assert.equal(y.b.appels.filter(z => z[0] === 'creer').length, 0); assert.equal(y.r.m.get('m@x.invalid').statut, 'supprimee_brevo');
  // « Recréer » sur m seulement : m créée ; a reste bloquée, et une 3e adresse reste bloquée
  Object.assign(y.r.m.get('m@x.invalid'), { statut: 'supprimee', contact_id: null, champ: null, detail: RECREATION });
  const r3 = await y.run(C({ email: 'a@x.invalid', email_2: 'm@x.invalid' }));
  assert.deepEqual(r3.created, ['m@x.invalid']); assert.equal(y.b.base.has('a@x.invalid'), false);
  assert.equal(y.r.m.get('a@x.invalid').statut, 'supprimee_brevo');
});

t('relecture 17/11 (R4, R5) : fiche supprimée dans Brevo DÉCOUVERTE pendant le passage = aucune nouvelle adresse créée, quel que soit l’ordre ; fiche préexistante désabonnée = deuxième adresse sans liste', async () => {
  // R4a : a gérée (supprimée à la main dans Brevo), b nouvelle en mail 2
  const x = env({}, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email' }]);
  const r = await x.run(C({ email: 'a@x.invalid', email_2: 'b@x.invalid' }));
  assert.deepEqual(r.created, []); assert.deepEqual(x.b.appels.filter(z => z[0] === 'creer'), []);
  assert.equal(x.r.m.get('a@x.invalid').statut, 'supprimee_brevo'); assert.equal(x.r.m.get('b@x.invalid').statut, 'supprimee_brevo');
  // R4b : ordre inverse (nouvelle adresse en mail 1, fiche gérée en mail 2)
  const y = env({}, [{ email: 'a@x.invalid', contact_id: 'k1', champ: 'email_2' }]);
  const r2 = await y.run(C({ email: 'n@x.invalid', email_2: 'a@x.invalid' }));
  assert.deepEqual(r2.created, []); assert.equal(y.r.m.get('n@x.invalid').statut, 'supprimee_brevo');
  // R5 : fiche préexistante (hors registre, non adoptée) désabonnée portée par le contact → b créée SANS liste, p jamais touchée
  const z = env({ 'p@x.invalid': { listIds: [3], emailBlacklisted: true } });
  const r3 = await z.run(C({ email: 'p@x.invalid', email_2: 'b@x.invalid' }));
  assert.deepEqual(r3.created, ['b@x.invalid']); assert.deepEqual(z.b.base.get('b@x.invalid').listIds, []);
  assert.deepEqual(z.b.appels.filter(a => a[1] === 'p@x.invalid' && a[0] !== 'lire'), [], 'fiche préexistante jamais modifiée');
  // préexistante abonnée : liste donnée comme avant
  const w = env({ 'p@x.invalid': { listIds: [3] } });
  await w.run(C({ email: 'p@x.invalid', email_2: 'b@x.invalid' }));
  assert.deepEqual(w.b.base.get('b@x.invalid').listIds, [7]);
});

let ko = 0;
for (const [nom, f] of cas) { try { await f(); console.log('  ✓ ' + nom); } catch (e) { ko++; console.error('  ✗ ' + nom + '\n    ' + e.message); } }
console.log(`Règles Brevo : ${cas.length - ko}/${cas.length} cas vérifiés.`);
if (ko) process.exit(1);
