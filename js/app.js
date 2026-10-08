/**
 * Point d'entrée : affichage général (en-tête, onglets) et démarrage.
 */
import './events.js';
import './views/settings.js';
import './views/auth.js';
import './ui/modal.js';
import { ACTIONS } from './actions.js';
import { byId } from './selectors.js';
import { netArtbo, payAmount, paymentsOf } from './calc.js';
import { APP_VERSION } from './config.js';
import { VIEWS } from './constants.js';
import { loadAll, save, sb } from './data.js';
import { S, localSet } from './state.js';
import { $, esc } from './utils.js';
import { loginHTML } from './views/auth.js';
import { drawMap, viewBooking } from './views/booking.js';
import { viewCommunication } from './views/communication.js';
import { viewContacts } from './views/contacts.js';
import { viewProduction } from './views/production.js';
import { viewProjects } from './views/projects.js';
import { viewSettings } from './views/settings.js';
import { viewStructures } from './views/structures.js';
import { viewProspects } from './views/suivi.js';
import { viewTicketing } from './views/ticketing.js';
import { viewTodo } from './views/todo.js';

export function render(){
  const app = $('#app');
  if (!S.user){ app.innerHTML = loginHTML(); return; }
  const years = [...new Set(S.db.shows.filter(s=>s.date).map(s=>Number(s.date.slice(0,4))).concat([new Date().getFullYear(), new Date().getFullYear()+1]))].sort();
  const projects = S.db.projects.slice().sort((a,b)=>(b.active-a.active)||a.name.localeCompare(b.name));
  app.innerHTML = `
  <header class="top"><div class="top-row">
    <div class="brand">L'ArtBoristerie</div>
    <nav class="tabs" role="tablist">${VIEWS.map(([k,l])=>`<button class="tab" role="tab" data-view="${k}" aria-selected="${S.view===k}">${l}</button>`).join('')}</nav>
    <div class="filters">
      <select id="f-year" aria-label="Année">${years.map(y=>`<option ${y===S.year?'selected':''}>${y}</option>`).join('')}</select>
      <select id="f-project" aria-label="Projet"><option value="">Tous les projets</option>${projects.map(p=>`<option value="${p.id}" ${p.id===S.project?'selected':''}>${esc(p.name)}${p.active?'':' (inactif)'}</option>`).join('')}</select>
      <span class="who">${esc(S.user.email.split('@')[0])} · <a href="#" data-act="changePw">Mot de passe</a> · <a href="#" id="logout">Déconnexion</a> · <a href="#" data-view="settings" class="muted">v${APP_VERSION}</a></span>
    </div>
  </div></header>
  <main id="main"></main>`;
  const main = $('#main');
  const fn = {booking:viewBooking, production:viewProduction, ticketing:viewTicketing, communication:viewCommunication,
    projects:viewProjects, todo:viewTodo, prospects:viewProspects, contacts:viewContacts, structures:viewStructures, settings:viewSettings}[S.view];
  main.innerHTML = fn();
  main.querySelectorAll('.tbl-wrap table').forEach(tb => {
    const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!heads.length) return;
    tb.classList.add('cards');
    tb.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => {
      td.setAttribute('data-label', heads[i] || '');
      if (!td.textContent.trim() && !td.querySelector('input,select,button,a,img')) td.classList.add('is-empty');
    }));
  });
  if (S.view==='booking') drawMap();
  if (S.focusProspect){ const el=document.getElementById('pr-'+S.focusProspect); if (el) el.scrollIntoView({block:'start'}); S.focusProspect=null; }
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-view],[data-act],#logout'); if (!t) return;
  if (t.id==='logout'){ e.preventDefault(); await sb.auth.signOut(); S.user=null; render(); return; }
  if (t.dataset.view){ S.view=t.dataset.view; S.projectPage=null; S.structurePage=null; localSet('view',S.view); render(); window.scrollTo(0,0); return; }
  const act = ACTIONS[t.dataset.act]; if (act){ e.preventDefault(); await act(t, e); }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id==='f-year'){ S.year=Number(t.value); localSet('year',S.year); render(); return; }
  if (t.id==='f-project'){ S.project=t.value; localSet('project',S.project); render(); return; }
  // Édition directe dans les tableaux : data-t (table) data-id data-f (champ)
  if (t.dataset.t && t.dataset.id && t.dataset.f){
    let v = t.type==='checkbox' ? t.checked : t.value;
    if (t.type==='number') v = v==='' ? null : Number(v);
    if (v==='') v = null;
    await save(t.dataset.t, t.dataset.id, {[t.dataset.f]: v}, {rerender: t.dataset.rr!=='0'});
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.search){ S.search[t.dataset.search] = t.value; clearTimeout(t._d); t._d = setTimeout(()=>{ const pos=t.selectionStart; render(); const n=document.querySelector(`[data-search="${t.dataset.search}"]`); if(n){ n.focus(); n.setSelectionRange(pos,pos);} }, 200); }
});

// Accès de dépannage depuis la console du navigateur : window.matrice.S, window.matrice.render()…
window.matrice = { S, render, loadAll, byId, paymentsOf, payAmount, netArtbo };

export async function boot(){
  const {data:{session}} = await sb.auth.getSession();
  S.user = session?.user || null;
  if (S.user){ $('#app').innerHTML = '<div class="empty">Chargement…</div>'; await loadAll(); }
  render();
  sb.auth.onAuthStateChange(async (ev, session) => {
    if (ev==='SIGNED_IN' && !S.user){ S.user=session.user; await loadAll(); render(); }
    if (ev==='SIGNED_OUT'){ S.user=null; render(); }
  });
}

boot();
