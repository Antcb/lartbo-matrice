// Aperçu lisible sans JavaScript du prototype (pour ChatGPT ou toute personne sans accès à claude.ai).
// Génère prototype-ux/apercu/ : captures Mac et iPhone de chaque écran + texte de chaque écran, et un README.md d'index.
// Usage (serveur local lancé dans prototype-ux : python3 -m http.server 8765) :
//   node outils/apercu.mjs <chemin de playwright/index.mjs> [chemin de Chrome] [version] [commit]
// Données fictives uniquement ; aucune connexion à un service.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [pw, chrome = '/usr/bin/google-chrome', version = '', commit = ''] = process.argv.slice(2);
const { chromium } = await import(pw);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apercu');
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const U = 'http://localhost:8765/index.html';
const pick = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }, sel);
const SCREENS = [
  ['01-tableau-de-bord', 'Tableau de bord', async p => { await p.goto(U + '#tableau-de-bord'); }],
  ['02-booking-tableau', 'Booking — tableau (regroupé par mois)', async p => { await p.goto(U + '#booking'); }],
  ['03-booking-artiste-mois', 'Booking — regroupé par artiste puis mois', async (p, m) => { await p.goto(U + '#booking'); await p.locator('[data-act="bkGroupPop"]').click(); await p.locator('.bk-grppop input[value="artist-month"]').check(); await p.keyboard.press('Escape'); }],
  ['04-booking-fiche', 'Booking — fiche d’une date (Le Moulin)', async (p, m) => { await p.goto(U + '#booking'); await p.locator(m ? '.bkm-main' : '.bk-row', { hasText: 'Le Moulin' }).first().click(); }],
  ['05-booking-carte', 'Booking — carte et trajets', async p => { await p.goto(U + '#booking'); await pick(p, 'input[name="bkpane"][value="map"]'); }],
  ['06-suivi-liste', 'Suivi — liste', async p => { await p.goto(U + '#suivi'); if (await p.locator('[data-act="svBack"]').count()) await p.locator('[data-act="svBack"]').click(); }],
  ['07-suivi-fiche', 'Suivi — espace de prospection (La Cale Sèche) : échanges', async (p, m) => { await p.locator(m ? '.bkm-main' : '.sv-row', { hasText: 'Cale Sèche' }).first().click(); }],
  ['08-suivi-dates', 'Suivi — espace de prospection : dates, négociation, carte, planning', async (p, m) => { if (m) await pick(p, 'input[name="svpane"][value="dates"]'); else await p.evaluate(() => { document.querySelector('#main').scrollTop = 99999; }); }],
  ['09-preferences', 'Préférences', async p => { await p.goto(U + '#suivi'); if (await p.locator('[data-act="svBack"]').count()) await p.locator('[data-act="svBack"]').click(); await p.goto(U + '#preferences'); }],
];
const b = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const rows = [];
for (const [dev, vp, mobile] of [['mac', { width: 1440, height: 900 }, false], ['iphone', { width: 393, height: 852 }, true]]){
  const p = await (await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })).newPage();
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload();
  for (const [id, title, go] of SCREENS){
    if (!id.startsWith('08')) await p.evaluate(() => { window.MX?.closePanel?.({ force: true }); window.MX?.closePop?.(); }); await p.waitForTimeout(150);
    await go(p, mobile); await p.waitForTimeout(450);
    await p.screenshot({ path: join(OUT, `${id}-${dev}.jpg`), type: 'jpeg', quality: 82 });
    if (!mobile){   // texte de l'écran (et du panneau ouvert), lisible sans JavaScript
      const txt = await p.evaluate(() => { const clean = el => el ? el.innerText.replace(/\n{3,}/g, '\n\n').trim() : '';
        const dock = document.querySelector('.app.dock-open #dock'); return clean(document.querySelector('#main')) + (dock ? '\n\n--- Panneau ouvert ---\n' + clean(dock) : ''); });
      rows.push([id, title, txt]);
    }
  }
}
await b.close();
const date = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
writeFileSync(join(OUT, 'README.md'), `# MATRICE — aperçu du prototype UX/UI${version ? ` (${version})` : ''}

Aperçu statique, lisible sans JavaScript : captures Mac (1440 × 900) et iPhone (393 × 852) de chaque écran, puis le texte affiché.
Données fictives. Branche \`ux/refonte-uxui\`${commit ? `, commit \`${commit}\`` : ''}, généré le ${date}.
Prototype interactif : https://claude.ai/artifact/4bEGUsBscbkLQj9jM5CMpE · Code : https://github.com/Antcb/lartbo-matrice/tree/ux/refonte-uxui/prototype-ux

## Écrans
${rows.map(([id, t]) => `- [${t}](#${id}) — [Mac](${id}-mac.jpg) · [iPhone](${id}-iphone.jpg)`).join('\n')}

${rows.map(([id, t, txt]) => `<a id="${id}"></a>
## ${t}

| Mac | iPhone |
|---|---|
| ![${t} — Mac](${id}-mac.jpg) | ![${t} — iPhone](${id}-iphone.jpg) |

<details><summary>Texte de l’écran (Mac)</summary>

\`\`\`text
${txt.replace(/```/g, "'''")}
\`\`\`
</details>
`).join('\n')}`);
console.log(`Aperçu écrit : ${rows.length} écrans × 2 appareils`);
