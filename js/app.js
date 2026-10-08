/**
 * Point d'entrée : en-tête (logo, onglets, notifications, compte), affichage de la vue, démarrage.
 */
import './events.js';
import './views/auth.js';
import './ui/datefield.js';
import './ui/autocomplete.js';
import { ACTIONS } from './actions.js';
import { byId, teamName, unreadNotifs } from './selectors.js';
import { netArtbo, payAmount, paymentsOf } from './calc.js';
import { APP_VERSION } from './config.js';
import { VIEWS } from './constants.js';
import { loadAll, save, sb } from './data.js';
import { S, localSet } from './state.js';
import { $, esc, fmtDate } from './utils.js';
import { autosizeAll } from './ui/modal.js';
import { loginHTML } from './views/auth.js';
import { attachMap, viewBooking } from './views/booking.js';
import { viewCommunication } from './views/communication.js';
import { viewContacts } from './views/contacts.js';
import { viewProduction } from './views/production.js';
import { hydratePhotos, viewProjects } from './views/projects.js';
import { viewSettings } from './views/settings.js';
import { viewStructures } from './views/structures.js';
import { viewProspects } from './views/suivi.js';
import { viewTicketing } from './views/ticketing.js';
import { viewTodo } from './views/todo.js';

const VIEW_FN = {booking:viewBooking, production:viewProduction, ticketing:viewTicketing, communication:viewCommunication,
  projects:viewProjects, todo:viewTodo, prospects:viewProspects, contacts:viewContacts, structures:viewStructures, settings:viewSettings};

function header(){
  const unread = unreadNotifs();
  return `<header class="top"><div class="top-row">
    <a class="brand" href="#" data-view="booking" aria-label="L'ArtBoristerie Productions — accueil">
      <img class="brand-logo" src="assets/logo.png" alt="L'ArtBoristerie Productions" width="104" height="39"><img class="brand-picto" src="assets/picto.png" alt="L'ArtBoristerie Productions" width="27" height="32"></a>
    <nav class="tabs" role="tablist">${VIEWS.map(([k,l])=>`<button class="tab" role="tab" data-view="${k}" aria-selected="${S.view===k}">${l}</button>`).join('')}</nav>
    <div class="top-right">
      <button class="btn icon ghost bell ${unread.length?'has':''}" data-act="toggleNotifs" aria-label="Notifications${unread.length?` (${unread.length} non lues)`:''}" aria-expanded="${!!S.notifOpen}">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>
        ${unread.length?`<span class="bell-n">${unread.length}</span>`:''}</button>
      <button class="btn ghost user" data-act="toggleUser" aria-expanded="${!!S.userOpen}">${esc(teamName(S.user.email))} <span aria-hidden="true">▾</span></button>
    </div>
  </div>
  ${S.notifOpen ? notifPanel() : ''}
  ${S.userOpen ? `<div class="menu user-menu" role="menu">
      <button class="menu-item" data-view="settings">Réglages</button>
      <button class="menu-item" data-act="changePw">Changer le mot de passe</button>
      <button class="menu-item" id="logout">Déconnexion</button>
      <div class="menu-foot">L'ArtBoristerie Productions · v${APP_VERSION}</div></div>` : ''}
  </header>`;
}

function notifPanel(){
  const list = S.db.notifications.slice().sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,60);
  const me = S.user.email;
  return `<div class="menu notif-menu" role="dialog" aria-label="Notifications">
    <div class="menu-head"><b>Notifications</b><span class="spacer"></span>${list.some(n=>!(n.read_by||[]).includes(me))?'<button class="btn sm ghost" data-act="readAllNotifs">Tout marquer comme lu</button>':''}</div>
    ${list.map(n=>`<div class="notif ${(n.read_by||[]).includes(me)?'':'unread'}" data-act="openNotif" data-id="${n.id}">
      <div class="notif-title">${esc(n.title)}</div>${n.body?`<div class="notif-body">${esc(n.body)}</div>`:''}<div class="notif-date">${fmtDate((n.created_at||'').slice(0,10))}</div></div>`).join('')
      || '<div class="empty">Aucune notification.</div>'}</div>`;
}

/** Repère du champ actif pour lui rendre le focus après un nouvel affichage */
function focusKey(a){
  if (!a || a===document.body) return null;
  const host = a.classList.contains('dt-txt') ? a.parentElement.querySelector('.dt-val') : a;
  if (host.dataset?.t) return {sel:`[data-t="${host.dataset.t}"][data-id="${host.dataset.id}"][data-f="${host.dataset.f}"]`, dt: a.classList.contains('dt-txt')};
  if (a.dataset?.search) return {sel:`[data-search="${a.dataset.search}"]`, pos:a.selectionStart};
  if (a.id) return {sel:'#'+CSS.escape(a.id)};
  return null;
}

export function render(){
  const app = $('#app');
  if (!S.user){ app.innerHTML = loginHTML(); return; }
  const fk = focusKey(document.activeElement);
  if (!(S.view in VIEW_FN)) S.view = 'booking';
  app.innerHTML = header() + `<main id="main" class="view-${S.view}"></main>`;
  const main = $('#main');
  main.innerHTML = VIEW_FN[S.view]();
  // Sur téléphone, les tableaux deviennent des fiches : chaque cellule reçoit le nom de sa colonne
  main.querySelectorAll('.tbl-wrap table').forEach(tb => {
    const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!heads.length) return;
    tb.classList.add('cards');
    tb.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => {
      td.setAttribute('data-label', heads[i] || '');
      if (!td.textContent.trim() && !td.querySelector('input,select,textarea,button,a,img')) td.classList.add('is-empty');
    }));
  });
  autosizeAll(main);
  attachMap();
  hydratePhotos(main);
  if (fk){ let el = main.querySelector(fk.sel); if (el){ if (fk.dt) el = el.parentElement.querySelector('.dt-txt'); el.focus({preventScroll:true}); if (fk.pos!=null) try{ el.setSelectionRange(fk.pos, fk.pos); }catch(e){} } }
  if (S.focusProspect){ const el=document.getElementById('pr-'+S.focusProspect); if (el) el.scrollIntoView({block:'start'}); S.focusProspect=null; }
}

export function go(view){ S.view=view; S.projectPage=null; S.structurePage=null; S.suiviPage=null; S.userOpen=false; S.notifOpen=false; localSet('view',S.view); render(); window.scrollTo(0,0); }

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-view],[data-act],#logout');
  if (!t){ if ((S.userOpen || S.notifOpen) && !e.target.closest('.menu')){ S.userOpen=false; S.notifOpen=false; render(); } return; }
  // un clic dans un champ d'une ligne cliquable ne doit pas ouvrir la ligne
  const ctrl = e.target.closest('input,select,textarea,.ac,.dt,label,a[href]:not([href="#"])');
  if (ctrl && ctrl !== t && t.contains(ctrl) && !ctrl.matches('[data-act]')) return;
  if (t.id==='logout'){ e.preventDefault(); await sb.auth.signOut(); S.user=null; render(); return; }
  if (t.dataset.view){ e.preventDefault(); go(t.dataset.view); return; }
  const act = ACTIONS[t.dataset.act]; if (act){ if (t.tagName!=='INPUT') e.preventDefault(); await act(t, e); }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id==='f-year'){ S.year=Number(t.value); localSet('year',S.year); render(); return; }
  if (t.id==='f-project'){ S.project=t.value; localSet('project',S.project); render(); return; }
  // Enregistrement direct : data-t (table) data-id data-f (champ)
  if (t.dataset.t && t.dataset.id && t.dataset.f && !t.dataset.custom){
    let v = t.type==='checkbox' ? t.checked : t.value;
    if (t.type==='number') v = v==='' ? null : Number(String(v).replace(',','.'));
    if (typeof v === 'string'){ v = v.trim(); if (v==='') v = null; }
    const hook = ACTIONS['change:'+t.dataset.t+'.'+t.dataset.f];
    if (hook) return hook(t, v);
    await save(t.dataset.t, t.dataset.id, {[t.dataset.f]: v}, {rerender: t.dataset.rr!=='0'});
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.search){ S.search[t.dataset.search] = t.value; clearTimeout(t._d); t._d = setTimeout(render, 220); }
});

// Accès de dépannage depuis la console du navigateur : window.matrice.S, window.matrice.render()…
window.matrice = { S, render, loadAll, byId, paymentsOf, payAmount, netArtbo };

export async function boot(){
  const {data:{session}} = await sb.auth.getSession();
  S.user = session?.user || null;
  if (S.user){ $('#app').innerHTML = '<div class="loading"><img src="assets/picto.png" alt="" width="54" height="64"><span>Chargement…</span></div>'; await loadAll(); }
  render();
  sb.auth.onAuthStateChange(async (ev, session) => {
    if (ev==='SIGNED_IN' && !S.user){ S.user=session.user; await loadAll(); render(); }
    if (ev==='SIGNED_OUT'){ S.user=null; render(); }
  });
}

boot();
