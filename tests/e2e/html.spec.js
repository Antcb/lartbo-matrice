// Nettoyage du HTML des mails affichés dans le journal (safeHtml → DOMPurify, lot S5-a) et échappement du texte.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
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
  // liens détournés
  '<a href="java\tscript:window.__xss++" id="lien">tab</a>',
  '<a href="java&#x0A;script:window.__xss++" id="lien">saut de ligne</a>',
  '<a href="&#106;avascript:window.__xss++" id="lien">entité</a>',
  '<a href=" JaVaScRiPt:window.__xss++" id="lien">casse</a>',
  '<a href="data:text/html,<script>parent.__xss++</script>" id="lien">data</a>',
  '<a href="vbscript:msgbox(1)" id="lien">vbs</a>',
  // SVG et MathML
  '<svg><a xlink:href="javascript:window.__xss++"><text x="10" y="20" id="lien">svg</text></a></svg>',
  '<svg onload="window.__xss++"></svg>',
  '<svg><script>window.__xss++</script></svg>',
  '<svg><animate onbegin="window.__xss++" attributeName="x" dur="1s"/></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=window.__xss++></style></mglyph></table></mtext></math>',
  // mutations et contournements connus
  '<noscript><p title="</noscript><img src=x onerror=window.__xss++>"></p></noscript>',
  '<svg></p><style><a id="</style><img src=1 onerror=window.__xss++>">',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=window.__xss++>',
  '<template><img src=x onerror=window.__xss++></template>',
  // autres vecteurs
  '<iframe srcdoc="<script>parent.__xss++</script>"></iframe>',
  '<details open ontoggle="window.__xss++">x</details>',
  '<video><source onerror="window.__xss++"></video>',
  '<input autofocus onfocus="window.__xss++">',
  '<body onload="window.__xss++">',
  '<button formaction="javascript:window.__xss++" id="envoi">ok</button>',
  '<base href="javascript:/"><a href="x" id="lien">base</a>',
  '<meta http-equiv="refresh" content="0;url=javascript:window.__xss++">',
  '<img src="x:x" onerror="eval(\'window.__xss++\')">',
  '<a href="https://example.com" onclick="window.__xss++" id="lien">lien sûr, attribut piégé</a>',
  '<div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999" id="voile">voile</div>',
];

// Contenus légitimes d'un mail : doivent rester affichés
const LEGITIMES = [
  ['<p>Bonjour <b>Camille</b>,</p>', 'b'],
  ['<a href="https://example.com/devis">Devis</a>', 'a[href="https://example.com/devis"]'],
  ['<table><tr><td>Cachet</td><td>6 000 €</td></tr></table>', 'td'],
  ['<img src="https://example.com/logo.png" alt="logo">', 'img[src="https://example.com/logo.png"]'],
  ['<ul><li>Point 1</li></ul>', 'li'],
  ['<span style="color:#283c63">Signature</span>', 'span[style]'],
  ['<a href="/acces">accès</a>', 'a[href="/acces"]'],
  ['<a href="#bas">bas</a>', 'a[href="#bas"]'],
  ['<a href="mailto:camille@example.com">mail</a>', 'a[href="mailto:camille@example.com"]'],
  ['<a href="tel:+33100000000">tél.</a>', 'a[href="tel:+33100000000"]'],
  ['<table width="600" align="center"><tr><td colspan="2" valign="top">x</td></tr></table>', 'td[colspan="2"][valign="top"]'],
  ['<font color="#283c63" face="Arial">x</font>', 'font[color][face]'],
  ['<img src="cid:logo@example.com" width="80">', 'img[src="cid:logo@example.com"][width="80"]'],
];

test(`safeHtml neutralise ${PIEGES.length} entrées piégées`, async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async P => {
    const { safeHtml } = await import('./js/utils.js');
    window.__xss = 0;
    const box = document.createElement('div'); document.body.appendChild(box);
    const out = [];
    for (const p of P) {
      box.innerHTML = safeHtml(p);
      box.querySelectorAll('#clic,#lien,#envoi').forEach(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      const bad = [...box.querySelectorAll('*')].flatMap(el => [...el.attributes]
        .filter(a => /^on/i.test(a.name) || /^(srcdoc|formaction|xlink:href)$/i.test(a.name)
          // adresse avec un protocole autre que https, http, mailto, tel, cid (ou image data:) : interdite ; adresse relative : permise
          || (/^(href|src|action)$/i.test(a.name) && (v => /^[a-z][a-z0-9+.-]*:/i.test(v) && !/^(https?:|mailto:|tel:|cid:|data:image\/)/i.test(v))(a.value.replace(/[\s\u0000-\u001f]/g, ''))))
        .map(a => `${el.tagName.toLowerCase()}[${a.name}=${a.value.slice(0, 30)}]`));
      const fixed = [...box.querySelectorAll('[style]')].filter(el => /fixed|absolute/.test(el.style.position)).length;
      out.push({ p, scripts: box.querySelectorAll('script,iframe,object,embed,form,style,svg,math,base,meta,template,input,button').length, bad, fixed });
    }
    await new Promise(r => setTimeout(r, 300));
    box.remove();
    return { xss: window.__xss, out };
  }, PIEGES);
  expect(r.xss, 'code exécuté').toBe(0);
  for (const o of r.out) { expect(o.scripts, o.p).toBe(0); expect(o.bad, o.p).toEqual([]); expect(o.fixed, o.p).toBe(0); }
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

// Mails représentatifs (fictifs) : même texte et mêmes éléments utiles qu'avec l'ancien nettoyage (avant S5-a)
const MAILS = readdirSync(new URL('../fixtures/mails/', import.meta.url)).filter(f => f.endsWith('.html'))
  .map(f => [f, readFileSync(new URL('../fixtures/mails/' + f, import.meta.url), 'utf8')]);

test(`les ${MAILS.length} mails représentatifs gardent leur contenu`, async ({ page }) => {
  const ctx = await openApp(page);
  const r = await page.evaluate(async M => {
    const { safeHtml } = await import('./js/utils.js');
    // ancien nettoyage (v1.40.0), recopié ici pour comparer
    const ancien = html => { const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
      doc.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name); }));
      return doc.body.innerHTML; };
    const box = document.createElement('div');
    const resume = html => { box.innerHTML = html; return {
      texte: box.textContent.replace(/\s+/g, ' ').trim(),
      liens: [...box.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
      images: [...box.querySelectorAll('img[src]')].map(i => i.getAttribute('src').slice(0, 40)),
      cellules: box.querySelectorAll('td').length, puces: box.querySelectorAll('li').length, gras: box.querySelectorAll('b,strong').length,
      citations: box.querySelectorAll('blockquote').length, styles: box.querySelectorAll('[style]').length,
      // attributs de mise en page : leur valeur doit rester identique
      mise_en_page: [...box.querySelectorAll('*')].flatMap(el => ['width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'bgcolor', 'dir', 'lang',
        'color', 'face', 'size', 'start', 'type', 'border', 'cellpadding', 'cellspacing', 'nowrap', 'class']
        .filter(a => el.hasAttribute(a)).map(a => `${el.tagName.toLowerCase()}.${a}=${el.getAttribute(a)}`)) }; };
    return M.map(([f, html]) => ({ f, avant: resume(ancien(html)), apres: resume(safeHtml(html)) }));
  }, MAILS);
  for (const { f, avant, apres } of r) expect(apres, f).toEqual(avant);
  expectClean(ctx);
});

test('liens des mails : nouvel onglet, sans accès à la Matrice', async ({ page }) => {
  const ctx = await openApp(page);
  const rel = await page.evaluate(async () => {
    const { safeHtml } = await import('./js/utils.js');
    const box = document.createElement('div'); box.innerHTML = safeHtml('<a href="https://example.com">x</a>');
    const a = box.querySelector('a'); return [a.getAttribute('target'), a.getAttribute('rel')];
  });
  expect(rel).toEqual(['_blank', 'noopener noreferrer']);
  expectClean(ctx);
});
