// v1.64 — Délais et automatismes : la règle est écrite deux fois (js/reminders.js DELAY_RULES et la fonction SQL delais_dossier de
// supabase/migrations/2026-11-09_v1.64_delais.sql). Contrôle sans base ni navigateur : mêmes règles, mêmes valeurs par défaut, mêmes
// bornes ; valeurs par défaut = règles d'avant le lot (solde J-7, facture à envoyer 3 j, impayé 10 j, boucle technique 4 mois…).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../../js/reminders.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../../supabase/migrations/2026-11-09_v1.64_delais.sql', import.meta.url), 'utf8');

const jsRules = [...js.matchAll(/\{key: '([a-z_]+)', label: [^\n]*?\bn: (\d+), unit: '(j|mois)'/g)].map(m => [m[1], Number(m[2]), m[3]]);
const def = sql.match(/with def\(k, n, mx\) as \(values ([\s\S]*?)\),\n\s+reg as/)[1];
const sqlRules = [...def.matchAll(/\('([a-z_]+)', (\d+), (\d+)\)/g)].map(m => [m[1], Number(m[2]), Number(m[3])]);
const max = {j: 365, mois: 24};

assert.equal(jsRules.length, 13, 'treize règles de rappel côté application');
assert.deepEqual(sqlRules.map(r => r[0]).sort(), jsRules.map(r => r[0]).sort(), 'mêmes règles en JS et en SQL');
for (const [k, n, unit] of jsRules){
  const s = sqlRules.find(r => r[0] === k);
  assert.equal(s[1], n, `${k} : même valeur par défaut`);
  assert.equal(s[2], max[unit], `${k} : même borne`);
}
// valeurs d'avant le lot (aucun délai changé par défaut)
const avant = {precontrat: 10, contrat_envoi: 10, contrat_signe: 10, contrat_cosigne: 10, facture_acompte: 0, solde_envoi: 7, booking_commission: 0,
  facture_envoi: 3, paiement: 10, commission: 10, commission_partenaire: 10, boucle_accueil: 4, boucle_com: 0};
assert.deepEqual(Object.fromEntries(jsRules.map(r => [r[0], r[1]])), avant, 'valeurs par défaut = règles en place');
assert.match(js, /export const DELAY_MAX = \{j: 365, mois: 24\}/);
// clé anti-doublon : constantes historiques dans la clé, jamais le délai réglé
for (const frag of ["id || ':' || (conf_kit_sent + 10)", "id || ':' || (cashed + 10)", "(faite_le + 3)", "(greatest(sent_at, reminded_at) + 10)", "id || ':' || (date - interval '4 months')::date"])
  assert.ok(sql.includes(frag), 'clé historique : ' + frag);
assert.ok(sql.includes("c.r || ':' || c.k || coalesce(':a' || c.reactiv, '')"), 'generate_reminders : clé règle:k[:a]');
console.log('délais : JS et SQL concordent (' + jsRules.length + ' règles)');
