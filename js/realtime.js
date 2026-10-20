/**
 * 🔄 Mise à jour automatique : ce que les autres font (une date validée, un échange ajouté…) apparaît tout seul,
 * sans recharger la page. Supabase prévient de chaque ajout, modification ou suppression.
 * L'écran n'est redessiné qu'à un moment sans risque : pas pendant qu'on écrit dans un champ ou qu'une fenêtre est ouverte.
 * En revenant sur l'onglet après une coupure (ordinateur en veille…), tout est rechargé une fois.
 */
import { APP_VERSION } from './config.js';
import { loadAll, sb } from './data.js';
import { S, TABLES, touch } from './state.js';

let channel = null, pending = false, timer = null, lastSeen = Date.now();

/** Peut-on redessiner sans gêner ? */
function safe(){
  if (document.querySelector('dialog[open]')) return false;
  const a = document.activeElement;
  if (a && a !== document.body && a.closest?.('#main, header') && (a.matches('input, textarea, select, [contenteditable="true"]'))) return false;
  if (document.querySelector('.ac-list, .pp-list, .menu')) return false;   // une liste déroulante ouverte
  if (getSelection()?.type === 'Range') return false;                       // du texte sélectionné (copie en cours)
  return true;
}
function later(render){
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(function tick(){
    if (!pending) return;
    if (safe()){ pending = false; render(); }
    else timer = setTimeout(tick, 1500);
  }, 400);
}

/** Clé d'une ligne : id, sauf les réglages (key) et les liens contact ↔ structure (le couple) */
const KEYS = {settings: ['key'], contact_structures: ['contact_id', 'structure_id']};
const keyOf = (table, row) => { const k = KEYS[table] || ['id']; return row && k.every(c => row[c] != null) ? k.map(c => row[c]).join('|') : null; };

function apply(table, ev){
  const rows = S.db[table]; if (!rows) return false;
  if (ev.eventType === 'DELETE'){
    const key = keyOf(table, ev.old); if (!key) return false;
    const n = rows.length; S.db[table] = rows.filter(r => keyOf(table, r) !== key);
    return S.db[table].length !== n;
  }
  const row = ev.new, key = keyOf(table, row); if (!key) return false;
  const i = rows.findIndex(r => keyOf(table, r) === key);
  if (i >= 0){ if (JSON.stringify(rows[i]) === JSON.stringify(row)) return false; rows[i] = row; }
  else rows.push(row);
  return true;
}

/** Tout recharger (après une coupure) puis redessiner au bon moment */
let reloading = false, pendingEvents = [];
async function catchUp(render){
  if (reloading || !S.user) return; reloading = true; pendingEvents = [];
  try {
    await loadAll();
    // ce qui est arrivé pendant le rechargement est rejoué par-dessus (sinon l'ancien résultat l'effacerait)
    for (const [table, ev] of pendingEvents) if (apply(table, ev)) touch(table);
    later(render);
  } finally { reloading = false; pendingEvents = []; }
}

export function startRealtime(render){
  S.rtApply = apply;
  watchVersion();
  if (channel || typeof sb.channel !== 'function') return;
  try { channel = sb.channel('matrice-db'); } catch(e){ return; }
  TABLES.forEach(table => channel.on('postgres_changes', {event: '*', schema: 'public', table}, ev => {
    if (!S.user) return;
    if (reloading) pendingEvents.push([table, ev]);
    for (const b of S.rtBuffers) b.push([table, ev]);   // rechargements partiels en cours (refreshFor)
    if (apply(table, ev)){ touch(table); later(render); }
  }));
  // reconnexion après une coupure (wifi, veille…) : on recharge ce qui a pu être manqué
  let joined = false, lost = false;
  channel.subscribe(status => {
    if (status === 'SUBSCRIBED'){ if (joined && lost) catchUp(render); joined = true; lost = false; }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') lost = true;
  });
  window.addEventListener('online', () => catchUp(render));
  // retour sur l'onglet après une longue absence : on recharge tout (des messages ont pu être perdus pendant la veille)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible'){ lastSeen = Date.now(); return; }
    if (Date.now() - lastSeen > 60_000) catchUp(render);
  });
}

/**
 * Nouvelle version du site publiée : bandeau « Recharger » (plus besoin de Cmd + Maj + R).
 * Vérifié toutes les 5 minutes et au retour sur l'onglet ; le rechargement garde les brouillons.
 */
let versionTimer = null;
async function checkVersion(){
  try {
    const txt = await (await fetch('js/config.js?check=' + Date.now(), {cache: 'no-store'})).text();
    const v = (txt.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
    if (v && v !== APP_VERSION && !document.querySelector('.update-bar')){
      const bar = document.createElement('div'); bar.className = 'update-bar';
      bar.innerHTML = `Nouvelle version de la Matrice (${v}). <button type="button" class="btn sm primary">Recharger</button>`;
      bar.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(bar);
    }
  } catch(e){ /* hors ligne : on réessaiera */ }
}
export function watchVersion(){
  if (versionTimer) return;
  versionTimer = setInterval(checkVersion, 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
}
