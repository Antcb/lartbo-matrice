// Chargement de chaque module JavaScript de l'application (dans la page, avec la carte d'import versionnée)
import { test, expect } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, expectClean } from './helpers.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
// Pages publiques autonomes (démarrent leur propre écran) : testées à part dans pages-publiques.spec.js
const ENTRY = new Set(['js/app.js', 'js/fiche.js', 'js/rh.js', 'js/artiste.js']);
const MODULES = walk(join(ROOT, 'js')).map(p => relative(ROOT, p).split('\\').join('/')).filter(m => !ENTRY.has(m)).sort();

test(`les ${MODULES.length} modules se chargent sans erreur`, async ({ page }) => {
  expect(MODULES.length).toBeGreaterThan(40);
  const ctx = await openApp(page);
  const failed = await page.evaluate(async mods => {
    const out = [];
    for (const m of mods) { try { await import('./' + m); } catch (e) { out.push(m + ' : ' + e.message); } }
    return out;
  }, MODULES);
  expect(failed).toEqual([]);
  expectClean(ctx);
});
