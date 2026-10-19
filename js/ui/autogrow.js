/**
 * Pages publiques (fiche organisateur, fiche salarié, fiche artiste) : chaque grande case de texte
 * prend la hauteur de son contenu — à l'ouverture (texte déjà enregistré), pendant la frappe,
 * et pour les cases ajoutées ensuite (« + Ajouter »…).
 */
const fit = ta => {
  if (!ta.isConnected || !ta.offsetParent) return;        // case cachée : on la laisse telle quelle
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + 2) + 'px';
};
let queued = false;
const fitAll = () => {
  if (queued) return; queued = true;
  requestAnimationFrame(() => { queued = false; document.querySelectorAll('textarea').forEach(fit); });
};
document.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') fit(e.target); });
new MutationObserver(muts => {
  if (muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.tagName === 'TEXTAREA' || n.querySelector?.('textarea'))))) fitAll();
}).observe(document.documentElement, {childList: true, subtree: true});
addEventListener('resize', fitAll);
addEventListener('load', fitAll);
fitAll();
