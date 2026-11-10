// Sauvegardes : démarrage réel (décision d'Anthony du 09/11/2026), sans base ni réseau. Lancé par « npm test »
// (node --experimental-strip-types). Les essais sur une vraie base PostgreSQL jetable sont dans
// supabase/repetitions/2026-11-09_sauvegarde_declenchement_essai.sh (hors CI : ils demandent PostgreSQL et le dépôt de sauvegarde).
//  1. fonction serveur « sauvegarde-fenetre » : comparaison du secret, validation stricte des demandes ;
//  2. règle durable du schéma privé : chaque table privée créée par une migration est CLASSÉE (lecture accordée au rôle
//     « sauvegarde » dans une migration, ou exclusion décidée) ; aucun droit par défaut sur le schéma privé ;
//  3. migration : fenêtre plafonnée à 1 h, fonctions fermées au navigateur, secret jamais dans une réponse ni un journal.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { lireDemande, secretOk } from '../../supabase/functions/sauvegarde-fenetre/regles.ts';

const racine = new URL('../../', import.meta.url);
const lire = (p) => readFileSync(new URL(p, racine), 'utf8');
const cas = [];
const t = (nom, f) => cas.push([nom, f]);
const S = 'a'.repeat(64);

// ── 1. Fonction serveur ─────────────────────────────────────────────────────────────────────────────────────────────────────
t('secret : seul le secret exact passe', () => {
  assert.equal(secretOk(S, S), true);
  assert.equal(secretOk('a'.repeat(63) + 'b', S), false);
  assert.equal(secretOk(S + 'a', S), false);
  assert.equal(secretOk(undefined, S), false);
  assert.equal(secretOk('', ''), false, 'secret absent du coffre : tout est refusé');
  assert.equal(secretOk('court', 'court'), false, 'secret trop court (moins de 32 caractères) : refusé');
  assert.equal(secretOk(S, null), false);
});
t('démarrage : valeurs valides, durée 45 min par défaut, forcer seulement si vrai', () => {
  const d = lireDemande({ action: 'demarrer', type: 'complete', run_id: '42581699238', tentative: 1, origine: 'schedule' });
  assert.deepEqual(d, { action: 'demarrer', p: { type: 'complete', run_id: '42581699238', tentative: 1, origine: 'schedule', forcer: false, duree_minutes: 45 } });
  assert.equal(lireDemande({ action: 'demarrer', type: 'json', run_id: '1', tentative: 2, origine: 'workflow_dispatch', forcer: 'true' }).p.forcer, false);
});
t('démarrage : durée au-delà de 45 min refusée (45 min + 15 min de fermeture de secours = 1 h au plus)', () => {
  assert.equal(lireDemande({ action: 'demarrer', type: 'complete', run_id: '1', tentative: 1, origine: 'schedule', duree_minutes: 46 }), 'durée invalide (5 à 45 min)');
  assert.equal(lireDemande({ action: 'demarrer', type: 'complete', run_id: '1', tentative: 1, origine: 'schedule', duree_minutes: 45 }).p.duree_minutes, 45);
});
t('démarrage : type, exécution, tentative, origine contrôlés', () => {
  const base = { action: 'demarrer', type: 'complete', run_id: '1', tentative: 1, origine: 'schedule' };
  assert.equal(lireDemande({ ...base, type: 'autre' }), 'type inconnu');
  assert.equal(lireDemande({ ...base, run_id: "1'; drop table x" }), 'run_id invalide');
  assert.equal(lireDemande({ ...base, run_id: 1 }), 'run_id invalide');
  assert.equal(lireDemande({ ...base, tentative: 0 }), 'tentative invalide');
  assert.equal(lireDemande({ ...base, tentative: 1.5 }), 'tentative invalide');
  assert.equal(lireDemande({ ...base, origine: 'push' }), 'origine inconnue');
});
t('fermeture et fin : identifiant entier, statut succes / echec seulement, détail nettoyé et borné', () => {
  assert.deepEqual(lireDemande({ action: 'fermer', id: 7 }), { action: 'fermer', p: { id: 7 } });
  assert.equal(lireDemande({ action: 'fermer', id: '7' }), 'id invalide');
  assert.equal(lireDemande({ action: 'terminer', id: 7, statut: 'abandon' }), 'statut inconnu');
  const d = lireDemande({ action: 'terminer', id: 7, statut: 'succes', detail: 'copie : success ; <script>' + 'x'.repeat(400) });
  assert.equal(d.p.detail.length, 300);
  assert.doesNotMatch(d.p.detail, /[<>]/);
  assert.equal(lireDemande({ action: 'ouvrir_tout' }), 'action inconnue');
  assert.equal(lireDemande(null), 'demande illisible');
});
t('fonction serveur : secret vérifié AVANT toute action, jamais renvoyé ni écrit dans le journal', () => {
  const src = lire('supabase/functions/sauvegarde-fenetre/index.ts');
  assert.ok(src.indexOf('secretOk(') < src.indexOf("rpc('sauvegarde_declenchement'"), 'contrôle du secret avant l’appel à la base');
  assert.match(src, /import_secret', \{ k: 'sauvegarde_declenchement_secret' \}/);
  assert.doesNotMatch(src, /console\.[a-z]+\([^)]*(secret|attendu|\bb\b)/, 'aucun secret ni corps de demande dans le journal');
  assert.doesNotMatch(src, /json\(\{[^}]*attendu/, 'aucun secret dans une réponse');
});
t('fonction serveur : réponses { ok:false, error } (§7.9), 503 si le coffre est illisible, aucun message brut de la base', () => {
  const src = lire('supabase/functions/sauvegarde-fenetre/index.ts');
  assert.match(src, /const refus = \(error: string, status: number\) => json\(\{ ok: false, error \}, status\)/);
  assert.match(src, /if \(errCoffre\) \{[^}]*return refus\('[^']+', 503\)/);
  assert.ok(src.indexOf('if (errCoffre)') < src.indexOf('secretOk('), 'coffre illisible : 503 (à réessayer), pas 403');
  assert.doesNotMatch(src, /refus\([^)]*(error|err)\.message/, 'message brut de la base jamais renvoyé');
  assert.doesNotMatch(src, /json\(\{ error/, 'toutes les erreurs au format { ok:false, error }');
  assert.match(src, /json\(\{ ok: true, \.\.\.\(data/);
});

// ── 2. Schéma privé : chaque table créée par une migration est classée ───────────────────────────────────────────────────────
// EXCLUSIONS DÉCIDÉES (même liste : dépôt lartbo-matrice-backup, outils/prive_classement.sql) : jamais copiées, présence seulement
const EXCLUES = ['import_secrets'];
const migrations = readdirSync(new URL('supabase/migrations/', racine)).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => [f, lire('supabase/migrations/' + f)]);
const tout = migrations.map(([, s]) => s).join('\n');
const creees = new Set([...tout.matchAll(/create table (?:if not exists )?private\.([a-z_]+)/gi)].map((m) => m[1]));
const lues = new Set([...tout.matchAll(/grant select on (?:sequence )?private\.([a-z_]+)[^;]*to sauvegarde/gi)].map((m) => m[1]));
for (const m of tout.matchAll(/foreach t in array array\[([^\]]+)\] loop\s+if to_regclass\('private\.' \|\| t\) is not null then execute format\('grant select on private\.%I to sauvegarde'/g))
  for (const n of m[1].matchAll(/'([a-z_]+)'/g)) lues.add(n[1]);
t('schéma privé : chaque table créée par une migration est classée (copiée ou exclusion décidée)', () => {
  assert.ok(creees.has('mailbox_owners') && creees.has('import_secrets') && creees.has('sauvegarde_executions'), 'relevé des tables privées');
  const sans = [...creees].filter((n) => !lues.has(n) && !EXCLUES.includes(n));
  assert.deepEqual(sans, [], 'table privée sans décision de sauvegarde : ajouter « grant select on private.<table> to sauvegarde » dans sa migration (aucun secret), ou l’ajouter aux exclusions décidées (ici ET dans outils/prive_classement.sql du dépôt de sauvegarde)');
  for (const n of EXCLUES) assert.ok(!lues.has(n), `exclusion décidée lisible par le rôle de sauvegarde : ${n}`);
});
t('schéma privé : aucun droit par défaut (une table de secrets ne serait jamais copiée sans décision)', () => {
  assert.doesNotMatch(tout, /alter default privileges[^;]*in schema private[^;]*to sauvegarde/i);
});
t('séquence d’identité de la table des exécutions lisible (sinon pg_dump échoue)', () => {
  assert.match(tout, /grant select on sequence private\.sauvegarde_executions_id_seq to sauvegarde/);
});

// ── 3. Migration ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const mig = lire('supabase/migrations/2026-11-09_v1.60.7_sauvegarde_declenchement.sql');
t('migration : connexion ouverte 1 h au plus, secours par l’interruption, verrou unique par type', () => {
  assert.match(mig, /least\(greatest\(coalesce\(p_duree, interval '45 minutes'\), interval '5 minutes'\), interval '45 minutes'\)/);
  assert.match(mig, /least\(coalesce\(\(p ->> 'duree_minutes'\)::integer, 45\), 45\)/);
  assert.match(mig, /create unique index if not exists sauvegarde_executions_une_en_cours on private\.sauvegarde_executions \(type\) where statut = 'en_cours'/);
  assert.match(mig, /coalesce\(f\.exceptionnelle_jusqu_a > now\(\), false\)/, 'l’interruption referme dès l’échéance passée');
});
t('migration : fermeture par la seule exécution qui tient la fenêtre ; 6 démarrages par jour au plus', () => {
  assert.match(mig, /set exceptionnelle_jusqu_a = v_jusqu, tenue_par = v_id;/);
  assert.match(mig, /if not exists \(select 1 from private\.sauvegarde_fenetre where tenue_par = p_id\) then\s+return jsonb_build_object\('etat', 'non_titulaire'\)/);
  assert.match(mig, /x\.jour = v_jour\) >= 6 then\s+return jsonb_build_object\('etat', 'limite'/);
  assert.match(mig, /function private\.sauvegarde_ouvrir\(duree interval default null\)[\s\S]*?least\(duree, interval '3 hours'\), tenue_par = null;/,
    'ouverture manuelle : tenue_par remis à vide (la fin d’une copie ne referme pas une fenêtre ouverte à la main)');
});
t('migration : fonctions fermées au navigateur, ouvertes au seul rôle serveur', () => {
  assert.match(mig, /revoke all on function public\.sauvegarde_declenchement\(text, jsonb\) from public, anon, authenticated;/);
  assert.match(mig, /grant execute on function public\.sauvegarde_declenchement\(text, jsonb\) to service_role;/);
  for (const f of ['sauvegarde_demarrer', 'sauvegarde_fermer', 'sauvegarde_terminer', 'sauvegarde_controler'])
    assert.match(mig, new RegExp(`revoke all on function private\\.${f}\\([^)]*\\) from public, anon, authenticated, service_role;`));
  assert.doesNotMatch(mig, /grant execute on function private\.sauvegarde_(demarrer|fermer|terminer)[^;]*to sauvegarde/, 'le rôle de sauvegarde ne s’ouvre pas lui-même');
});
t('migration : la fenêtre fixe n’est retirée que par l’opération d’activation', () => {
  assert.doesNotMatch(mig, /cron\.unschedule\('sauvegarde-(ouverture|fermeture)'\)/);
  const act = lire('supabase/operations/2026-11-09_sauvegarde_activation.sql');
  assert.match(act, /Activation refusée : aucune copie complète réussie/);
});
t('surveillance armée dès la migration (consigne du 09/11 11:05) : aucune attente d’une première exécution', () => {
  assert.match(mig, /create table if not exists private\.sauvegarde_surveillance/);
  assert.match(mig, /insert into private\.sauvegarde_surveillance \(id\) values \(true\)/);
  assert.doesNotMatch(mig, /continue when not exists \(select 1 from private\.sauvegarde_executions where type = ty\)/, 'plus d’armement par la première exécution');
  assert.match(mig, /if now\(\) < sv\.depuis \+ interval '24 hours' then/, 'seul un délai de grâce borné (24 h) après la mise en place');
  assert.match(mig, /if p_statut = 'echec' then[\s\S]*?'sauvegarde:echec:' \|\| p_id/, 'tout échec notifié tout de suite');
});
t('retour arrière : l’alerte est toujours coupée en premier', () => {
  const c = lire('supabase/retours-arriere/2026-11-09_sauvegarde_alerte_coupure.sql');
  assert.match(c, /update private\.sauvegarde_surveillance set active = false;/);
  assert.match(c, /cron\.unschedule\('sauvegarde-controle'\)/);
  const r = lire('supabase/retours-arriere/2026-11-09_sauvegarde_declenchement_retour_arriere.sql');
  assert.ok(r.indexOf('set active = false') < r.indexOf('drop function'), 'retour arrière complet : alerte coupée avant le reste');
  assert.match(lire('supabase/operations/2026-11-09_sauvegarde_installation.md'), /2026-11-09_sauvegarde_alerte_coupure\.sql/);
});
t('retrait de la fenêtre fixe : une seule transaction, fermeture faite par la copie elle-même', () => {
  const act = lire('supabase/operations/2026-11-09_sauvegarde_activation.sql');
  const debut = act.indexOf('\nbegin;'), fin = act.indexOf('\ncommit;');
  assert.ok(debut > 0 && fin > debut, 'begin … commit');
  for (const x of ['raise exception', "update private.sauvegarde_fenetre set debut = '00:00'", "cron.unschedule('sauvegarde-ouverture')"])
    assert.ok(act.indexOf(x) > debut && act.indexOf(x) < fin, `dans la transaction : ${x}`);
  assert.match(act, /fermeture_titulaire is not null and fin is not null and fermeture_titulaire <= fin/);
  assert.match(mig, /set fermeture_titulaire = now\(\) where id = p_id;/);
});
t('présence des secrets : nom et empreinte tronquée, jamais la valeur', () => {
  const f = mig.match(/function private\.sauvegarde_secrets_presence\(\)[\s\S]*?\$\$;/)[0];
  assert.match(f, /'cle', s\.key/);
  assert.match(f, /left\(pg_catalog\.encode\(pg_catalog\.sha256/);
  assert.doesNotMatch(f.replace(/convert_to\(s\.value/, ''), /s\.value/, 'la valeur n’est utilisée que pour l’empreinte');
});

let ko = 0;
for (const [nom, f] of cas) {
  try { f(); console.log('ok :', nom); } catch (e) { ko++; console.error('ÉCHEC :', nom, '—', e.message); }
}
console.log(`Sauvegardes (démarrage réel) : ${cas.length - ko}/${cas.length} essais réussis.`);
if (ko) process.exit(1);

// (10/11/2026, essai réel) Supabase refuse un UPDATE sans WHERE venant de l'API : la dernière définition de chaque fonction appelée par
// sauvegarde-fenetre ne doit contenir aucune mise à jour de private.sauvegarde_fenetre sans condition
{
  const fs = await import('node:fs');
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => /sauvegarde/.test(f)).sort();
  const last = {};
  for (const f of files) {
    const s = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of s.matchAll(/create or replace function private\.(sauvegarde_demarrer|sauvegarde_fermer)\([\s\S]*?end \$f\$;/g)) last[m[1]] = m[0];
  }
  for (const [n, body] of Object.entries(last)) {
    const sans = [...body.matchAll(/update private\.sauvegarde_fenetre set [^;]*;/g)].map((x) => x[0]).filter((u) => !/\bwhere\b/.test(u));
    if (sans.length) { console.error(`ÉCHEC : ${n} met à jour sauvegarde_fenetre sans WHERE (refusé par Supabase via l'API)`); process.exit(1); }
    console.log(`ok : ${n} : aucune mise à jour sans WHERE (exigence de l'API Supabase)`);
  }
}
