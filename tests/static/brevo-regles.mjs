// Règles de la synchronisation Brevo (v1.60.2, structures inactives) sur de FAUSSES données : aucun appel à Brevo ni à la base.
// Lancé par « npm test » (node --experimental-strip-types). Module testé : supabase/functions/brevo-sync/regles.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aAjouter, names, onlyInactive } from '../../supabase/functions/brevo-sync/regles.ts';

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
t('fonction serveur : un mail déjà présent n’est jamais modifié ni désabonné ; seul l’ajout est retenu', () => {
  const src = readFileSync(new URL('../../supabase/functions/brevo-sync/index.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(held\) \{ skipped\.push\(email\); continue; \}/);
  // le contrôle « held » vient APRÈS la branche « déjà dans Brevo » (qui ne crée rien) et AVANT la création
  assert.ok(src.indexOf('if (g.ok) {') < src.indexOf('if (held)') && src.indexOf('if (held)') < src.indexOf('method: "POST", headers: { "api-key": key, "content-type": "application/json", accept'));
  assert.doesNotMatch(src, /\/contacts\/lists\/[^`"]*\/contacts\/remove|method: "DELETE"|emailBlacklisted/);
});

let ko = 0;
for (const [nom, f] of cas) { try { f(); console.log('  ✓ ' + nom); } catch (e) { ko++; console.error('  ✗ ' + nom + '\n    ' + e.message); } }
console.log(`Règles Brevo : ${cas.length - ko}/${cas.length} cas vérifiés.`);
if (ko) process.exit(1);
