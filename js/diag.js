/**
 * 🩺 Diagnostic : une erreur du site chez quelqu'un (Chloé, Anthony…) est affichée à l'écran
 * et notée dans la base (table client_errors) pour pouvoir la corriger sans voir son écran.
 * Au démarrage, une ligne « démarrage » note la version, le navigateur et les filtres en cours.
 */
import { APP_VERSION } from './config.js';
import { S } from './state.js';

let sb = null, sent = 0;
const KEY = '__diagLast';
async function send(message, stack = ''){
  if (!sb || !S.user || sent > 30) return;   // pas d'avalanche
  sent++;
  try {
    await sb.from('client_errors').insert({user_email: S.user.email, version: APP_VERSION, view: S.view || '', message: String(message).slice(0, 1000),
      stack: String(stack || '').slice(0, 3000), ua: navigator.userAgent});
  } catch(e){}
}
function show(msg){
  const t = document.createElement('div'); t.className = 'toast err'; t.textContent = 'Erreur : ' + msg + ' (notée pour correction)';
  document.body.appendChild(t); setTimeout(() => t.remove(), 8000);
}
export function startDiag(client){
  sb = client;
  window.addEventListener('error', e => { const m = e.message || 'Erreur'; if (window[KEY] === m) return; window[KEY] = m; show(m); send(m, e.error?.stack || `${e.filename}:${e.lineno}`); });
  window.addEventListener('unhandledrejection', e => { const m = e.reason?.message || String(e.reason); if (window[KEY] === m) return; window[KEY] = m; show(m); send(m, e.reason?.stack || ''); });
}
/** Ligne de démarrage : version, navigateur, filtres (aide à comprendre « ça ne marche pas chez X ») */
export function bootTrace(){
  send('démarrage', JSON.stringify({projects: S.projects, showInactive: S.showInactive, todoWho: S.todoWho, year: S.year, w: innerWidth, h: innerHeight}));
}

/** Trace ponctuelle (une fois par session et par clé) */
const traced = new Set();
export function trace(key, data){ if (traced.has(key)) return; traced.add(key); send(key, JSON.stringify(data)); }
