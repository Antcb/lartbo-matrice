/**
 * ← Retour : chaque page (onglet, fiche structure, suivi, projet) et chaque fenêtre ouverte a sa place dans
 * l'historique du navigateur. Sur téléphone, glisser le doigt de gauche à droite (ou le bouton retour d'Android)
 * revient à la page d'avant, ou ferme la fenêtre ouverte.
 */
import { S } from '../state.js';

const PAGE_KEYS = ['view', 'structurePage', 'suiviPage', 'projectPage'];
const pageOf = () => Object.fromEntries(PAGE_KEYS.map(k => [k, S[k] ?? null]));
const same = (a, b) => !!a && !!b && PAGE_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));

let restoring = false, renderFn = null;
let ignorePops = 0;     // retours déclenchés par nous (fenêtre fermée par un bouton) : à ignorer

/** Appelé après chaque affichage : une nouvelle page = une nouvelle entrée dans l'historique */
export function trackPage(render){
  renderFn = render;
  if (restoring) return;
  const cur = history.state?.page;
  if (!cur) history.replaceState({page: pageOf()}, '');
  else if (!history.state.modal && !same(cur, pageOf())) history.pushState({page: pageOf()}, '');
}

/** Une fenêtre s'ouvre : entrée dans l'historique, pour que « retour » la ferme */
export function trackModal(dlg){
  history.pushState({page: pageOf(), modal: true}, '');
  dlg.addEventListener('close', () => {
    // fermée par un bouton (ou Échap) : on retire son entrée de l'historique
    if (dlg._closedByBack){ dlg._closedByBack = false; return; }
    if (history.state?.modal){ ignorePops++; history.back(); }
  }, {once: true});
}

window.addEventListener('popstate', e => {
  // retour qu'on a fait nous-mêmes : la page a pu changer pendant que la fenêtre était ouverte, on la note
  if (ignorePops > 0){ ignorePops--; if (renderFn) trackPage(renderFn); return; }
  // une fenêtre ouverte : « retour » la ferme, sans changer de page
  const open = [...document.querySelectorAll('dialog[open]')].pop();
  if (open){ open._closedByBack = true; open.close(); return; }
  const page = e.state?.page; if (!page) return;
  PAGE_KEYS.forEach(k => { S[k] = page[k] ?? null; });
  if (page.view) S.view = page.view;
  restoring = true; renderFn?.(); window.scrollTo(0, 0); restoring = false;
});

// Site ajouté à l'écran d'accueil (sans les boutons du navigateur) : on gère nous-mêmes le glissement depuis le bord gauche
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
if (standalone){
  let start = null;
  document.addEventListener('touchstart', e => { const t = e.touches[0]; start = t.clientX < 28 ? {x: t.clientX, y: t.clientY} : null; }, {passive: true});
  document.addEventListener('touchend', e => {
    if (!start) return; const t = e.changedTouches[0];
    if (t.clientX - start.x > 80 && Math.abs(t.clientY - start.y) < 60) history.back();
    start = null;
  }, {passive: true});
}
