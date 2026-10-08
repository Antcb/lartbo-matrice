/**
 * Écran de connexion.
 */
import { render } from '../app.js';
import { CFG } from '../config.js';
import { loadAll, sb } from '../data.js';
import { S } from '../state.js';
import { $ } from '../utils.js';

export function loginHTML(){
  return `<div class="panel login"><img src="assets/logo.png" alt="L'ArtBoristerie Productions" width="220" height="83"><p>Booking et production</p>
    <form id="login-form">
      <input type="email" id="login-email" placeholder="prenom@lartboristerie.com" required autocomplete="email">
      <input type="password" id="login-pw" placeholder="Mot de passe" required autocomplete="current-password">
      <button class="btn primary" style="width:100%">Se connecter</button></form>
    <p id="login-msg" class="muted" style="margin-top:12px"></p></div>`;
}

document.addEventListener('submit', async e => {
  if (e.target.id!=='login-form') return; e.preventDefault();
  const email = $('#login-email').value.trim().toLowerCase();
  if (!CFG.TEAM.includes(email)){ $('#login-msg').textContent = "Cette adresse n'a pas accès à la matrice."; return; }
  $('#login-msg').textContent = 'Connexion…';
  const {data, error} = await sb.auth.signInWithPassword({email, password: $('#login-pw').value});
  if (error){ $('#login-msg').textContent = 'Connexion impossible : mail ou mot de passe incorrect.'; return; }
  S.user = data.user; $('#app').innerHTML = '<div class="loading"><img src="assets/picto.png" alt="" width="54" height="64"><span>Chargement…</span></div>'; await loadAll(); render();
});
