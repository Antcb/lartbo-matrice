/**
 * 🔄 Mise à jour automatique : ce que les autres font (une date validée, un échange ajouté…) apparaît tout seul,
 * sans recharger la page. Supabase prévient de chaque ajout, modification ou suppression.
 * L'écran n'est redessiné qu'à un moment sans risque : pas pendant qu'on écrit dans un champ ou qu'une fenêtre est ouverte.
 * En revenant sur l'onglet après une coupure (ordinateur en veille…), tout est rechargé une fois.
 */
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

function apply(table, ev){
  const rows = S.db[table]; if (!rows) return false;
  if (ev.eventType === 'DELETE'){
    const id = ev.old?.id; if (!id) return false;
    const n = rows.length; S.db[table] = rows.filter(r => r.id !== id);
    return S.db[table].length !== n;
  }
  const row = ev.new; if (!row?.id) return false;
  const i = rows.findIndex(r => r.id === row.id);
  if (i >= 0){ if (JSON.stringify(rows[i]) === JSON.stringify(row)) return false; rows[i] = row; }
  else rows.push(row);
  return true;
}

export function startRealtime(render){
  if (channel || typeof sb.channel !== 'function') return;
  try { channel = sb.channel('matrice-db'); } catch(e){ return; }
  TABLES.forEach(table => channel.on('postgres_changes', {event: '*', schema: 'public', table}, ev => {
    if (!S.user) return;
    if (apply(table, ev)){ touch(table); later(render); }
  }));
  channel.subscribe();
  // retour sur l'onglet après une longue absence : on recharge tout (des messages ont pu être perdus pendant la veille)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible'){ lastSeen = Date.now(); return; }
    if (S.user && Date.now() - lastSeen > 60_000){ await loadAll(); later(render); }
  });
}
