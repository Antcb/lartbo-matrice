// v1.60.3 — outil de rapprochement CNM (lecture seule) sur un extrait FICTIF : une ligne par coréalisation concernée, calcul actuel
// et calcul corrigé, solde déjà versé, payeur effectif seulement d'après une ligne payée. Aucun accès réseau extérieur.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('v1.60.3 outil de rapprochement CNM : lignes, double déduction, solde versé, payeur effectif, lecture seule', async () => {
  test.setTimeout(120_000);
  const dir = fileURLToPath(new URL('..', import.meta.url)), src = 'fixtures/rapprochement-cnm-fictif.json';
  const before = readFileSync(dir + src, 'utf8');
  const res = execFileSync(process.execPath, ['outils/rapprochement-cnm.mjs', src], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 100_000 });
  const [head, ...lines] = res.replace(/^﻿/, '').trim().split('\n');
  const cols = head.split(';'), rows = Object.fromEntries(lines.map(l => { const v = l.split(';'); const r = Object.fromEntries(cols.map((c, i) => [c, v[i]])); return [r.id, r]; }));
  expect(Object.keys(rows).sort()).toEqual(['fx-a', 'fx-b', 'fx-c', 'fx-e']);   // booking et cession exclus
  expect(rows['fx-a']).toMatchObject({ deduite_du_partage: 'oui', double_deduction: 'oui', depenses_actuel: '2280', depenses_corrige: '2000', reste_artiste_actuel: '808', reste_artiste_corrige: '1088', payeur_effectif: 'à préciser', commission: '772' });
  expect(rows['fx-b']).toMatchObject({ double_deduction: 'non', ecart_reste: '0', break_previsionnel: '216' });
  expect(rows['fx-c']).toMatchObject({ double_deduction: 'non', depenses_actuel: '2000' });
  expect(rows['fx-e']).toMatchObject({ double_deduction: 'oui', solde_verse: 'oui', solde_verse_montant: '1000', payeur_effectif: 'L\'ArtBo le 2026-05-20 (280)', remboursement: 'remboursé le 2026-05-25', ecart_apres_versement: '88' });
  expect(readFileSync(dir + src, 'utf8')).toBe(before);   // extrait inchangé
});
