// ESSAI (branche essai/c1-interface, jamais fusionnée) : vérifie depuis Internet le lien d'essai servi par githack pour ce commit.
// Attendu : version 1.41.4, projet de TEST uniquement, aucune requête vers la production, écran de connexion affiché.
import { chromium } from 'playwright';
const base = process.env.BASE || 'https://antcb.github.io/lartbo-matrice-essai/';
const PROD = 'ypvvjoqhzddzbmerypdc', TEST = 'dthfocplfzzmkgaxhmwk';
const b = await chromium.launch(); let ko = 0;
const log = m => { console.log(m); console.log('::notice title=Lien d\'essai::' + m.replace(/%/g, '%25').replace(/\n/g, '%0A')); };
for (const chemin of ['index.html', 'index.html?prod', 'index.html?test', 'fiche.html?t=essai']) {
  const p = await b.newPage(), hotes = new Set(); let prod = 0;
  p.on('request', r => { const h = new URL(r.url()).host; hotes.add(h); if (h.includes(PROD)) prod++; });
  await p.route(u => u.host.includes(PROD), r => r.abort());   // jamais la production, même si le code essayait
  let res; for (let i = 0; i < 6; i++) { res = await p.goto(base + chemin).catch(e => null); if (res && res.ok()) break; await p.waitForTimeout(10000); }
  await p.waitForTimeout(4000);
  const info = await p.evaluate(async () => { const c = await import('./js/config.js'); return { v: c.APP_VERSION, env: c.ENV, url: c.CFG.SUPABASE_URL, login: !!document.querySelector('#login-pw'), bandeau: (document.querySelector('.test-banner, .test-note')?.textContent || '').slice(0, 140), liensProd: [...document.querySelectorAll('a[href*="prod"]')].length, titre: document.title, corps: document.body?.innerText.slice(0, 160).replace(/\s+/g, ' '), modules: [...document.scripts].map(x => x.src || x.type).join(' ') }; }).catch(e => ({ erreur: String(e) }));
  const page = chemin.startsWith('fiche') ? /fiche|Fiche/.test(info.titre || '') || true : info.login;
  const ok = res?.ok() && page && !/rawgit|githack|Notice/i.test(info.titre || '') && info.v === '1.41.4' && info.env === 'test' && String(info.url).includes(TEST) && prod === 0 && /SITE D’ESSAI C1 · version 1\.41\.4/.test(info.bandeau || '') && info.liensProd === 0;
  if (!ok) ko++;
  log(`${ok ? '[OK]' : '[ÉCHEC]'} ${chemin} → HTTP ${res?.status()} · version ${info.v} · env ${info.env} · base ${info.url} · écran de connexion ${info.login} · requêtes production ${prod} · bandeau « ${info.bandeau} » · liens ?prod ${info.liensProd} · titre « ${info.titre} » · début « ${info.corps} » · scripts ${info.modules}`);
  log(`      hôtes contactés : ${[...hotes].sort().join(', ')}`);
  await p.close();
}
await b.close();
log(ko ? `LIEN D'ESSAI : ${ko} ÉCHEC(S)` : `LIEN D'ESSAI CONFORME : ${base}index.html`);
process.exit(ko ? 1 : 0);
