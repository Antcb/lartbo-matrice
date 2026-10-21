// Nettoyage du HTML (mails importés affichés dans le journal) et échappement du texte.
// Socle F1-a : cas de base. Le lot S5-a (DOMPurify) ajoute la batterie complète d'entrées piégées.
import { test, expect } from '@playwright/test';
import { openApp, expectClean } from './helpers.js';

// Chaque entrée piégée tente d'incrémenter window.__xss : le compteur doit rester à 0 après insertion dans la page
const PIEGES = [
  '<script>window.__xss++</script>',
  '<img src="x" onerror="window.__xss++">',
  '<div onclick="window.__xss++" id="clic">clic</div>',
  '<a href="javascript:window.__xss++" id="lien">lien</a>',
  '<iframe src="javascript:parent.__xss++"></iframe>',
  '<object data="javascript:window.__xss++"></object>',
  '<form action="javascript:window.__xss++"><button id="envoi">ok</button></form>',
  '<style>body{display:none}</style><b>texte</b>',
];

// Contenus légitimes d'un mail : doivent rester affichés
const LEGITIMES = [
  ['<p>Bonjour <b>Camille</b>,</p>', 'b'],
  ['<a href="https://example.com/devis">Devis</a>', 'a[href="https://example.com/devis"]'],
  ['<table><tr><td>Cachet</td><td>6 000 €</td></tr></table>', 'td'],
  ['<img src="https://example.com/logo.png" alt="logo">', 'img[src="https://example.com/logo.png"]'],
  ['<ul><li>Point 1</li></ul>', 'li'],
  ['<span style="color:#283c63">Signature</span>', 'span[style]'],
];

test('safeHtml neutralise les entrées piégées de base', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async P => {
    const { safeHtml } = await import('./js/utils.js');
    window.__xss = 0;
    const box = document.createElement('div'); document.body.appendChild(box);
    const out = [];
    for (const p of P) {
      box.innerHTML = safeHtml(p);
      box.querySelectorAll('#clic,#lien,#envoi').forEach(el => el.click());
      const bad = [...box.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)).map(a => a.name));
      out.push({ p, scripts: box.querySelectorAll('script,iframe,object,embed,form,style').length, bad });
    }
    await new Promise(r => setTimeout(r, 300));
    box.remove();
    return { xss: window.__xss, out };
  }, PIEGES);
  expect(r.xss, 'code exécuté').toBe(0);
  for (const o of r.out) { expect(o.scripts, o.p).toBe(0); expect(o.bad, o.p).toEqual([]); }
  expectClean(ctx);
});

test('safeHtml conserve l’affichage légitime d’un mail', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async L => {
    const { safeHtml } = await import('./js/utils.js');
    const box = document.createElement('div');
    return L.map(([html, sel]) => { box.innerHTML = safeHtml(html); return [sel, !!box.querySelector(sel)]; });
  }, LEGITIMES);
  for (const [sel, ok] of r) expect(ok, sel).toBe(true);
  expectClean(ctx);
});

test('esc et md échappent le texte saisi', async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async () => {
    const { esc, md } = await import('./js/utils.js');
    const box = document.createElement('div');
    box.innerHTML = md('**gras** <img src=x onerror=alert(1)> [lien](javascript:alert(1)) https://example.com');
    return { esc: esc(`<b>"l'été" & co</b>`), imgs: box.querySelectorAll('img').length,
      liens: [...box.querySelectorAll('a')].map(a => a.getAttribute('href')), gras: box.querySelector('b')?.textContent };
  });
  expect(r).toEqual({ esc: '&lt;b&gt;&quot;l&#39;été&quot; &amp; co&lt;/b&gt;', imgs: 0, liens: ['https://example.com'], gras: 'gras' });
  expectClean(ctx);
});
