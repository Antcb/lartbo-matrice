// Outils communs : ouverture d'une page avec la fausse base, blocage de tout accès extérieur,
// relevé des erreurs JavaScript et des tentatives de connexion à un service réel.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const MOCK = readFileSync(new URL('../fixtures/mock-supabase.js', import.meta.url), 'utf8');
const LEAFLET_JS = readFileSync(require.resolve('leaflet/dist/leaflet.js'), 'utf8');
const LEAFLET_CSS = readFileSync(require.resolve('leaflet/dist/leaflet.css'), 'utf8');

// Services réels qui ne doivent JAMAIS être contactés pendant les tests
const FORBIDDEN = /supabase\.co|script\.google\.com|(?<!fonts\.)googleapis\.com|brevo\.com|sendinblue|pennylane\.com|notion\.(so|com)|anthropic\.com/i;

export async function preparePage(page, { session = true } = {}) {
  const errors = [], external = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => { errors.push('fenêtre native : ' + d.type() + ' — ' + d.message()); d.dismiss().catch(() => {}); });
  if (!session) await page.addInitScript(() => { window.__NO_SESSION = true; });
  // Les SharedWorker échappent au routage de Playwright : interdits dans les tests (l'application n'en utilise pas)
  await page.addInitScript(() => { window.SharedWorker = function () { throw new Error('SharedWorker interdit pendant les tests'); }; });
  // Blocage au niveau du navigateur entier (onglets ouverts par un lien compris), y compris les WebSockets
  const context = page.context();
  context.on('page', p => p.on('request', r => { if (FORBIDDEN.test(r.url())) external.push('nouvel onglet : ' + r.url().replace(/[?#].*$/, '')); }));
  await context.routeWebSocket(/.*/, ws => { external.push('websocket : ' + ws.url().replace(/[?#].*$/, '')); ws.close(); });
  await context.route('**/*', route => {
    const u = route.request().url();
    // Supabase JS (copie locale assets/vendor) : remplacé par la fausse base, comme l'ancienne adresse jsDelivr
    if (/\/assets\/vendor\/supabase-js-[^/]+\/supabase\.js/.test(u)) return route.fulfill({ body: MOCK, contentType: 'text/javascript' });
    if (u.startsWith('http://127.0.0.1:4173/')) return route.continue();
    if (/supabase-js/.test(u)) return route.fulfill({ body: MOCK, contentType: 'text/javascript' });
    if (/leaflet[^/]*\.js/.test(u)) return route.fulfill({ body: LEAFLET_JS, contentType: 'text/javascript' });
    if (/leaflet[^/]*\.css/.test(u)) return route.fulfill({ body: LEAFLET_CSS, contentType: 'text/css' });
    if (FORBIDDEN.test(u)) external.push(u.replace(/[?#].*$/, ''));
    return route.fulfill({ status: 204, body: '' });   // polices, tuiles de carte, géocodage… : neutralisés
  });
  return { errors, external };
}

/** Ouvre l'application connectée (fausse session) et attend la fin du chargement */
export async function openApp(page, opts = {}) {
  const ctx = await preparePage(page, opts);
  await page.goto('/index.html');
  await expect(page.locator('nav.tabs')).toBeVisible();
  return ctx;
}

/** Aucune erreur JavaScript, aucune fenêtre native, aucun appel à un service réel */
export function expectClean({ errors, external }) {
  expect(errors, 'erreurs JavaScript ou fenêtres natives').toEqual([]);
  expect(external, 'appels à un service réel (interdits en test)').toEqual([]);
}

export const VIEWS = ['booking', 'production', 'ticketing', 'communication', 'projects', 'todo', 'prospects', 'contacts', 'structures', 'settings', 'employees'];
