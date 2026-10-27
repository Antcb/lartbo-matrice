// Lot S0-R8 : séparation complète entre la vraie Matrice (production) et l'espace de test (?test).
// Fausse base : chaque appel est relevé avec l'adresse du projet demandé (window.__clientUrls, __calls[].url), sans aucune connexion.
// Les 7 exigences d'Anthony (22/10/2026) : saisie de test jamais enregistrée en production ; brouillons séparés dans les deux sens ;
// résumé IA du test sans effet en production ; pages publiques dans le bon environnement ; liens de test sans effet en production ;
// pas de régression ; données du navigateur de la production intactes.
import { test, expect } from '@playwright/test';
import { openApp, preparePage, expectClean } from './helpers.js';

const PROD = 'ypvvjoqhzddzbmerypdc', TEST = 'dthfocplfzzmkgaxhmwk';   // références publiques des deux projets (js/config.js)
const MARK = 'SAISIE FAITE EN TEST';

/** Ouvre l'application dans un environnement (même navigateur, donc même stockage) */
async function openEnv(page, env) {
  await page.goto(`/index.html?${env}`);
  await expect(page.locator('nav.tabs')).toBeVisible();
  expect(await page.evaluate(() => import('./js/config.js').then(m => m.ENV))).toBe(env);
}
/** Tout le stockage du navigateur (copie) */
const storage = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
/** Ferme la fenêtre sans enregistrer et attend la fin de son retour d'historique (ui/history.js : history.back()) */
async function closeModal(page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).not.toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => !!history.state?.modal)).toBe(false);
  await page.waitForTimeout(100);
}
/** Ouvre la fiche d'une tâche, tape un titre, ferme sans enregistrer (le brouillon est gardé) */
async function draftTask(page, title) {
  await page.evaluate(() => import('./js/forms.js').then(m => m.editTask('tk-1')));
  await page.waitForTimeout(150);   // instantané initial de la fenêtre (drafts.js : 60 ms)
  await page.locator('#fld-title').fill(title);
  await closeModal(page);
}
const openTask = async page => { await page.evaluate(() => import('./js/forms.js').then(m => m.editTask('tk-1'))); await page.waitForTimeout(250); };

test('1. une saisie faite en test ne peut jamais être enregistrée en production', async ({ page }) => {
  const ctx = await openApp(page);
  await openEnv(page, 'test');
  await draftTask(page, MARK);
  const enTest = await storage(page);
  expect(Object.entries(enTest).filter(([, v]) => v.includes(MARK)).map(([k]) => k)).toEqual(['artbo-test.draft.modal.1.Tâche.tk-1']);

  await openEnv(page, 'prod');
  await openTask(page);
  await expect(page.locator('#modal .draft-bar')).toHaveCount(0);
  await expect(page.locator('#fld-title')).toHaveValue('Tâche en retard');
  await page.locator('#modal button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.table === 'tasks' && c.op === 'update').length)).toBeGreaterThan(0);
  const writes = await page.evaluate(() => window.__calls.filter(c => c.op && c.op !== 'select'));
  expect(JSON.stringify(writes)).not.toContain(MARK);
  expect(writes.every(c => c.url.includes(PROD))).toBe(true);
  expect(await page.evaluate(() => window.__DB.tasks.find(t => t.id === 'tk-1').title)).toBe('Tâche en retard');
  // aucune clé de production ne contient la saisie de test
  expect(Object.entries(await storage(page)).filter(([k, v]) => !k.startsWith('artbo-test.') && v.includes(MARK))).toEqual([]);
  expectClean(ctx);
});

test('2. un brouillon de production n’apparaît pas en test, et inversement ; chacun retrouve le sien', async ({ page }) => {
  const ctx = await openApp(page);
  await openEnv(page, 'prod');
  await draftTask(page, 'BROUILLON PRODUCTION');
  await openEnv(page, 'test');
  await openTask(page);
  await expect(page.locator('#modal .draft-bar')).toHaveCount(0);
  await expect(page.locator('#fld-title')).toHaveValue('Tâche en retard');
  await closeModal(page);
  await draftTask(page, 'BROUILLON TEST');
  await openEnv(page, 'prod');
  await openTask(page);
  await expect(page.locator('#modal .draft-bar')).toHaveCount(1);
  await expect(page.locator('#fld-title')).toHaveValue('BROUILLON PRODUCTION');
  await closeModal(page);
  await openEnv(page, 'test');
  await openTask(page);
  await expect(page.locator('#fld-title')).toHaveValue('BROUILLON TEST');
  await closeModal(page);
  // brouillon du journal d'un suivi (logdraft) : même séparation
  await page.evaluate(() => import('./js/views/suivi.js').then(m => m.setLogDraft('pr-1', { body: 'JOURNAL TEST' })));
  await openEnv(page, 'prod');
  expect(await page.evaluate(() => import('./js/views/suivi.js').then(m => m.hasLogDraft('pr-1')))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('artbo-test.logdraft.pr-1'))).toContain('"env":"test"');
  // brouillon de journal marqué « test » glissé sous la clé de production : effacé, jamais repris
  await page.evaluate(() => localStorage.setItem('artbo.logdraft.pr-2', JSON.stringify({ body: 'X', env: 'test' })));
  expect(await page.evaluate(() => import('./js/views/suivi.js').then(m => m.hasLogDraft('pr-2')))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('artbo.logdraft.pr-2'))).toBeNull();
  // contrôle en plus : un brouillon marqué « test » glissé sous une clé de production est effacé, jamais appliqué
  await page.evaluate(m => localStorage.setItem('artbo.draft.modal.1.Tâche.tk-1', JSON.stringify({ f: { title: m }, h: {}, env: 'test' })), MARK);
  await openTask(page);
  await expect(page.locator('#fld-title')).toHaveValue('Tâche en retard');
  expect(await page.evaluate(() => localStorage.getItem('artbo.draft.modal.1.Tâche.tk-1'))).toBeNull();
  await closeModal(page);
  expectClean(ctx);
});

test('3. un résumé IA mis en attente en test ne déclenche rien en production', async ({ page }) => {
  const ctx = await openApp(page);
  await openEnv(page, 'test');
  // l'IA « saturée » (erreur réseau de la bibliothèque) : le résumé part dans la file d'attente du test
  await page.evaluate(() => { window.__FN_ERROR = { 'resume-suivi': 'Failed to send a request to the Edge Function' }; });
  await page.evaluate(() => import('./js/data.js').then(m => m.refreshSummary('pr-1')));
  const q = JSON.parse(await page.evaluate(() => localStorage.getItem('artbo-test.summaryRetry')));
  expect(q['pr-1']).toMatchObject({ env: 'test' });
  expect(await page.evaluate(() => localStorage.getItem('artbo.summaryRetry'))).toBeNull();
  // pire cas : l'entrée du test recopiée sous la clé de production, échéance passée → jetée sans appel
  await page.evaluate(v => localStorage.setItem('artbo.summaryRetry', v), JSON.stringify({ 'pr-1': { ...q['pr-1'], at: Date.now() - 1000 } }));
  await openEnv(page, 'prod');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'resume-suivi'))).toEqual([]);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('artbo.summaryRetry')))).toEqual({});
  // ancienne entrée sans environnement noté : jetée aussi (un clic sur « Mettre à jour avec l’IA » suffit à relancer)
  await page.evaluate(() => localStorage.setItem('artbo.summaryRetry', JSON.stringify({ 'pr-1': { n: 1, at: Date.now() - 1000 } })));
  await openEnv(page, 'prod');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__calls.filter(c => c.fn === 'resume-suivi'))).toEqual([]);
  await expect(page.locator('.toast').last()).toContainText('résumé IA en attente');
  expectClean(ctx);
});

test('3 bis. non-régression : un résumé en attente en production est bien relancé en production', async ({ page }) => {
  const ctx = await openApp(page);
  await openEnv(page, 'prod');
  await page.evaluate(() => { window.__FN_ERROR = { 'resume-suivi': 'Failed to send a request to the Edge Function' }; });
  await page.evaluate(() => import('./js/data.js').then(m => m.refreshSummary('pr-1')));
  const q = JSON.parse(await page.evaluate(() => localStorage.getItem('artbo.summaryRetry')));
  expect(q['pr-1']).toMatchObject({ env: 'prod' });
  await page.evaluate(v => localStorage.setItem('artbo.summaryRetry', v), JSON.stringify({ 'pr-1': { ...q['pr-1'], at: Date.now() - 1000 } }));
  await openEnv(page, 'prod');
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.fn === 'resume-suivi').map(c => c.url)), { timeout: 8000 })
    .toEqual([expect.stringContaining(PROD)]);
  expectClean(ctx);
});

const PAGES = [['fiche.html', 'jeton-fiche-test-0001', 'fiche_get'], ['artiste.html', 'jeton-artiste-test-0001', 'artist_get'], ['rh.html', 'jeton-rh-test-00000001', 'rh_get']];
for (const [file, token, rpc] of PAGES) {
  test(`4. ${file} : l’environnement vient du lien seul, jamais du navigateur`, async ({ page }) => {
    const ctx = await openApp(page);
    await openEnv(page, 'test');                       // navigateur resté en test
    await page.goto(`/${file}?t=${token}`);            // vrai lien (sans « test »)
    await expect.poll(() => page.evaluate(n => window.__calls.filter(c => c.rpc === n).map(c => c.url), rpc)).toEqual([expect.stringContaining(PROD)]);
    expect(await page.evaluate(() => window.__clientUrls)).toEqual([expect.stringContaining(PROD)]);
    await expect(page.locator('.test-banner')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('artbo.env'))).toBe('test');   // choix de l'application non modifié
    await page.goto(`/${file}?t=${token}&test`);       // lien de test
    await expect.poll(() => page.evaluate(n => window.__calls.filter(c => c.rpc === n).map(c => c.url), rpc)).toEqual([expect.stringContaining(TEST)]);
    await expect(page.locator('.test-banner')).toContainText('Page de test');
    await page.evaluate(() => localStorage.removeItem('artbo.env'));                     // navigateur en production
    await page.goto(`/${file}?t=${token}&test`);
    await expect.poll(() => page.evaluate(n => window.__calls.filter(c => c.rpc === n).map(c => c.url), rpc)).toEqual([expect.stringContaining(TEST)]);
    expect(await page.evaluate(() => localStorage.getItem('artbo.env'))).toBeNull();      // un lien public ne bascule jamais le navigateur
    expectClean(ctx);
  });
}

test('5. les liens créés en test portent « test », ouvrent la base de test et n’écrivent jamais en production', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const ctx = await openApp(page);
  const links = async () => page.evaluate(async () => {
    const [{ ACTIONS }, sel, mail, proj, { EMP_ACTIONS }] = await Promise.all([import('./js/actions.js'), import('./js/selectors.js'),
      import('./js/mail.js'), import('./js/views/projects.js'), import('./js/views/employees.js')]);
    await ACTIONS.copyFiche({ dataset: { id: 'sh-1' } }); const fiche = await navigator.clipboard.readText();
    await EMP_ACTIONS.rhCopyLink({ dataset: { id: 'em-1', part: 'extra' } }); const rh = await navigator.clipboard.readText();
    return { fiche, rh, artiste: proj.artistLink(sel.byId('projects', 'art-a')), mail: (await mail.mailVars('sh-1')).lien_fiche };
  });
  await openEnv(page, 'prod');
  const prod = await links();
  for (const l of Object.values(prod)) expect(l).not.toMatch(/[?&]test\b/);
  await openEnv(page, 'test');
  const t = await links();
  for (const l of Object.values(t)) expect(l).toMatch(/[?&]test$/);
  await expect(page.locator('.toast').last()).toContainText('lien de TEST');
  // le lien de fiche de test, ouvert puis envoyé : tout part vers la base de test
  const u = new URL(t.fiche); await page.goto('/fiche.html' + u.search);
  await expect(page.locator('#fiche-form')).toBeVisible();
  await page.locator('#fiche-form input[required], #fiche-form textarea[required]').evaluateAll(els => els.forEach(e => { e.value = e.type === 'email' ? 'test@exemple.fr' : 'x'; }));   // v1.50 : un mail invalide est refusé avant l'envoi
  await page.locator('#fiche-form fieldset[data-req]').evaluateAll(fs => fs.forEach(f => { const i = f.querySelector('input'); if (i) i.checked = true; }));
  await page.locator('#fiche-form button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(c => c.rpc === 'fiche_submit').map(c => c.url))).toEqual([expect.stringContaining(TEST)]);
  expectClean(ctx);
});

test('7. les données du navigateur de la production restent intactes (anciennes clés reprises telles quelles)', async ({ page }) => {
  const ctx = await openApp(page);
  // état laissé par la version précédente (clés de production existantes)
  const OLD = {
    'artbo.view': 'booking', 'artbo.year': String(new Date().getFullYear()), 'artbo.todoWho': 'testeur@example.com', 'artbo.showInactive': '1',
    'artbo.mapHidden': '["Annulée"]', 'artbo.projects': '["art-a"]',
    'artbo.draft.modal.1.Tâche.tk-1': JSON.stringify({ f: { title: 'ANCIEN BROUILLON PROD' }, h: {} }),
    'artbo.logdraft.pr-1': JSON.stringify({ body: 'ANCIEN JOURNAL PROD' }),
    'fiche-brouillon-jeton-fiche-test-0001': JSON.stringify({ city_admin: 'ANCIENNE SAISIE ORGANISATEUR' }),
    'artiste.jeton-artiste-test-0001': JSON.stringify({ bio: 'ANCIENNE SAISIE ARTISTE' }),
    // session de connexion de la bibliothèque Supabase (valeur fictive) : jamais touchée par l'application
    'sb-ypvvjoqhzddzbmerypdc-auth-token': JSON.stringify({ fictif: true }),
  };
  await page.evaluate(o => { localStorage.clear(); Object.entries(o).forEach(([k, v]) => localStorage.setItem(k, v)); }, OLD);
  await openEnv(page, 'prod');
  // préférences reprises
  expect(await page.evaluate(() => import('./js/state.js').then(m => ({ view: m.S.view, who: m.S.todoWho, inactive: m.S.showInactive, projects: m.S.projects })))).toEqual(
    { view: 'booking', who: 'testeur@example.com', inactive: true, projects: ['art-a'] });
  // brouillons repris
  await openTask(page);
  await expect(page.locator('#modal .draft-bar')).toHaveCount(1);
  await expect(page.locator('#fld-title')).toHaveValue('ANCIEN BROUILLON PROD');
  await closeModal(page);
  expect(await page.evaluate(() => import('./js/views/suivi.js').then(m => m.logDraft('pr-1').body))).toBe('ANCIEN JOURNAL PROD');
  // pages publiques : brouillons des organisateurs et artistes repris (clés sans « artbo. »)
  expect(await page.evaluate(() => import('./js/storage.js').then(m => [m.localGet('fiche-brouillon-jeton-fiche-test-0001', { page: true }), m.localGet('artiste.jeton-artiste-test-0001', { page: true })])))
    .toEqual([OLD['fiche-brouillon-jeton-fiche-test-0001'], OLD['artiste.jeton-artiste-test-0001']]);
  // aller-retour par l'espace de test : aucune clé de production modifiée
  const before = await storage(page);
  await openEnv(page, 'test');
  await draftTask(page, 'AUTRE SAISIE TEST');
  await openEnv(page, 'prod');
  const after = await storage(page);
  const prodKeys = o => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('artbo-test.') && k !== 'artbo.env'));
  expect(prodKeys(after)).toEqual(prodKeys(before));
  for (const [k, v] of Object.entries(OLD)) if (k !== 'artbo.view') expect(after[k], k).toBe(v);
  expectClean(ctx);
});

test('7 bis. la page publique reprend le brouillon existant d’un organisateur', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/fiche.html?t=jeton-inconnu');
  const field = 'admin_city';
  await page.goto('/fiche.html?t=jeton-fiche-test-0001');
  await expect(page.locator('#fiche-form')).toBeVisible();
  const name = await page.locator('#fiche-form input[name]:not([type=radio]):not([disabled])').first().getAttribute('name');
  await page.evaluate(([n]) => localStorage.setItem('fiche-brouillon-jeton-fiche-test-0001', JSON.stringify({ [n]: 'SAISIE CONSERVÉE' })), [name || field]);
  await page.reload();
  await expect(page.locator(`#fiche-form [name="${name}"]`)).toHaveValue('SAISIE CONSERVÉE');
  expectClean(ctx);
});

test('6. messages de l’espace de test : exacts, affichés seulement en test (application, connexion)', async ({ page }) => {
  const ctx = await openApp(page);
  const { TEST_APP_NOTICE } = await page.evaluate(() => import('./js/ui/testbanner.js').then(m => ({ TEST_APP_NOTICE: m.TEST_APP_NOTICE })));
  await expect(page.locator('.test-banner')).toHaveCount(0);
  await openEnv(page, 'test');
  await expect(page.locator('.test-banner')).toContainText(TEST_APP_NOTICE);
  await expect(page.locator('body')).not.toContainText('rien de ce que tu fais ici ne touche');
  await expect(page.locator('body')).not.toContainText('${');
  expectClean(ctx);
});

test('6 bis. page de connexion en test : message exact', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/index.html?test');
  const notice = await page.evaluate(() => import('./js/ui/testbanner.js').then(m => m.TEST_APP_NOTICE));
  await expect(page.locator('.test-note')).toContainText(notice);
  await expect(page.locator('.test-note')).not.toContainText('sans effet sur la vraie');
  await expect(page.locator('body')).not.toContainText('${');
  await page.goto('/index.html?prod');
  await expect(page.locator('.test-note')).toHaveCount(0);
  expectClean(ctx);
});

test('4 bis. une adresse déguisée de page publique ne contourne pas la règle (adresse encodée)', async ({ page }) => {
  const ctx = await openApp(page);
  for (const path of ['/fich%65.html', '/fiche%2Ehtml']) {
    await openEnv(page, 'test');
    await page.goto(`${path}?t=jeton-fiche-test-0001`);
    await expect.poll(() => page.evaluate(() => window.__clientUrls), { message: path }).toEqual([expect.stringContaining(PROD)]);
    await page.evaluate(() => localStorage.removeItem('artbo.env'));
    await page.goto(`${path}?t=jeton-fiche-test-0001&test`);
    await expect.poll(() => page.evaluate(() => window.__clientUrls), { message: path }).toEqual([expect.stringContaining(TEST)]);
    expect(await page.evaluate(() => localStorage.getItem('artbo.env')), path).toBeNull();
  }
  expectClean(ctx);
});

test('4 ter. brouillon d’une page publique : séparé entre lien de test et vrai lien', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/fiche.html?t=jeton-fiche-test-0001&test');
  await expect(page.locator('#fiche-form')).toBeVisible();
  const input = page.locator('#fiche-form input[name]:not([type=radio]):not([disabled])').first();
  const name = await input.getAttribute('name');
  await input.fill(MARK);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['artbo-test.page.fiche-brouillon-jeton-fiche-test-0001']);
  await page.goto('/fiche.html?t=jeton-fiche-test-0001');
  await expect(page.locator(`#fiche-form [name="${name}"]`)).not.toHaveValue(MARK);
  await page.goto('/fiche.html?t=jeton-fiche-test-0001&test');
  await expect(page.locator(`#fiche-form [name="${name}"]`)).toHaveValue(MARK);
  expectClean(ctx);
});

// GitHub Pages peut servir une page publique sous d'autres adresses (sans « .html », majuscules selon le serveur…) :
// on simule ce serveur en renvoyant le vrai fiche.html / artiste.html / rh.html à ces adresses. Le marqueur de la page
// (<body class="fiche-page">) suffit : quelle que soit l'adresse, le navigateur resté en test n'influence jamais la page.
test('4 quater. adresses servies autrement par le site (sans .html, majuscules, barre finale) : bon environnement', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const ctx = await openApp(page);
  const VARIANTES = [['/fiche', 'fiche.html'], ['/FICHE.html', 'fiche.html'], ['/fiche/', 'fiche.html'], ['/Artiste', 'artiste.html'], ['/rh', 'rh.html'],
    ['/formulaire-organisateur', 'fiche.html']];   // adresse que seule la marque de la page permet de reconnaître
  for (const [path, file] of VARIANTES) {
    await page.route(u => new URL(u).pathname === path, r => r.fulfill({ contentType: 'text/html', body: readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
      .replace(/(href|src)="(?!https?:|\/)/g, '$1="/') }));
  }
  for (const [path] of VARIANTES) {
    await openEnv(page, 'test');
    await page.goto(`${path}?t=jeton-inconnu`);
    await expect.poll(() => page.evaluate(() => window.__clientUrls), { message: path }).toEqual([expect.stringContaining(PROD)]);
    expect(await page.evaluate(() => localStorage.getItem('artbo.env')), path).toBe('test');
    await page.evaluate(() => localStorage.removeItem('artbo.env'));
    await page.goto(`${path}?t=jeton-inconnu&test`);
    await expect.poll(() => page.evaluate(() => window.__clientUrls), { message: path }).toEqual([expect.stringContaining(TEST)]);
    expect(await page.evaluate(() => localStorage.getItem('artbo.env')), path).toBeNull();
  }
  expectClean(ctx);
});

// Après la régénération des jetons du projet de test (décision D1-b) : un jeton de test est inconnu en production.
// Un lien de test dont on retire « test » ouvre alors la page de production, qui refuse le jeton : aucune lecture, aucun envoi.
test('5 bis. lien de test sans « test » : la production refuse le jeton, aucune fiche lisible ni modifiable', async ({ page }) => {
  const ctx = await preparePage(page, { session: false });
  await page.goto('/fiche.html?t=jeton-du-projet-de-test-0001');   // jeton propre au test (inconnu de la production)
  await expect(page.locator('body')).toContainText('n’est pas valide');
  await expect(page.locator('#fiche-form')).toHaveCount(0);
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.filter(c => c.rpc === 'fiche_get').map(c => c.url)).toEqual([expect.stringContaining(PROD)]);
  expect(calls.filter(c => c.rpc === 'fiche_submit')).toEqual([]);
  expectClean(ctx);
});
