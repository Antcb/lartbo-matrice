// Contrôle de syntaxe des fonctions serveur (supabase/functions/*/*.ts) : les types TypeScript sont retirés (Node), puis le texte
// est analysé par « node --check ». Attrape une erreur qui empêcherait la fonction de démarrer une fois déployée (relecture v1.60.2 :
// variable déclarée deux fois dans brevo-sync). Ne remplace pas « deno check » (types non vérifiés).
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

const root = new URL('../../supabase/functions/', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'fonctions-'));
let n = 0, bad = 0;
for (const fn of readdirSync(root)) {
  const dir = join(root, fn);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).filter(x => x.endsWith('.ts'))) {
    n++;
    const out = join(tmp, `${fn}--${f.replace(/\.ts$/, '.mjs')}`);
    try {
      writeFileSync(out, stripTypeScriptTypes(readFileSync(join(dir, f), 'utf8')));
      execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
    } catch (e) {
      bad++;
      console.error(`ÉCHEC ${fn}/${f} : ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 4).join(' | ')}`);
    }
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`Syntaxe des fonctions serveur : ${n - bad}/${n} fichiers corrects.`);
if (bad) process.exit(1);
