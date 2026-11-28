// Génère js/icons.js à partir des fichiers SVG de Lucide (paquet npm lucide-static, licence ISC).
// Usage : node outils/generer-icones.mjs <dossier lucide-static/icons>
// Seules les icônes listées ci-dessous sont copiées : aucune dépendance chargée en ligne.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NOMS = ['house', 'radio-tower', 'clapperboard', 'landmark', 'library', 'message-circle', 'list-todo', 'settings',
  'layout-grid', 'calendar-days', 'target', 'clipboard-check', 'calculator', 'ticket', 'wallet', 'id-card', 'mic-vocal',
  'building-2', 'contact', 'mail', 'megaphone', 'file-text', 'list-checks', 'sliders-horizontal', 'settings-2', 'search',
  'menu', 'panel-left-close', 'panel-left-open', 'chevron-down', 'chevron-right', 'chevron-up', 'star', 'x', 'plus', 'sun',
  'moon', 'monitor', 'clock', 'bell', 'arrow-up', 'arrow-down', 'eye', 'eye-off', 'user', 'check', 'table-2',
  'chart-column', 'chart-line', 'info', 'triangle-alert', 'circle-check', 'rotate-ccw', 'ellipsis', 'pencil',
  'calendar-clock', 'trending-up', 'trending-down', 'chart-spline', 'refresh-cw',
  'archive', 'map-pin', 'route', 'flag', 'pin', 'folder', 'bell-off', 'download', 'arrow-left', 'arrow-right', 'trash-2',
  'chevrons-up-down', 'chevrons-down-up'];

const dossier = process.argv[2];
if (!dossier) { console.error('Indiquer le dossier des icônes lucide-static'); process.exit(1); }
const icones = {};
for (const n of NOMS) {
  const svg = readFileSync(join(dossier, n + '.svg'), 'utf8');
  icones[n] = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s*\n\s*/g, '').trim();
}
const entete = '// Icônes Lucide (https://lucide.dev, licence ISC : assets/LICENCE-lucide.txt), copiées localement.\n'
  + '// Fichier généré par outils/generer-icones.mjs — ne pas modifier à la main.\n';
writeFileSync(new URL('../js/icons.js', import.meta.url), entete + 'window.MATRICE_ICONS = ' + JSON.stringify(icones, null, 0).replace(/","/g, '",\n"') + ';\n');
console.log(`${NOMS.length} icônes écrites dans js/icons.js`);
