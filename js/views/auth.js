/**
 * Écran de connexion.
 */
import { render } from '../app.js';
import { CFG, ENV } from '../config.js';
import { loadAll, sb } from '../data.js';
import { startRealtime } from '../realtime.js';
import { bootTrace } from '../diag.js';
import { S } from '../state.js';
import { $ } from '../utils.js';
import { TEST_APP_NOTICE } from '../ui/testbanner.js';

export function loginHTML(){
  return `<div class="panel login"><img src="assets/logo.png" alt="L'ArtBoristerie Productions" width="220" height="83"><p>Booking et production</p>${ENV === 'test' ? `<p class="test-note">${TEST_APP_NOTICE}</p>` : ''}
    <form id="login-form">
      <input type="email" id="login-email" placeholder="prenom@lartboristerie.com" required autocomplete="email">
      <input type="password" id="login-pw" placeholder="Mot de passe" required autocomplete="current-password">
      <button class="btn primary" style="width:100%">Se connecter</button></form>
    <p id="login-msg" class="muted mt"></p></div>`;
}

document.addEventListener('submit', async e => {
  if (e.target.id!=='login-form') return; e.preventDefault();
  const email = $('#login-email').value.trim().toLowerCase();
  if (CFG.TEAM && !CFG.TEAM.includes(email)){ $('#login-msg').textContent = "Cette adresse n'a pas accès à la matrice."; return; }
  $('#login-msg').textContent = 'Connexion…';
  const {data, error} = await sb.auth.signInWithPassword({email, password: $('#login-pw').value});
  if (error){ $('#login-msg').textContent = 'Connexion impossible : mail ou mot de passe incorrect.'; return; }
  S.user = data.user; $('#app').innerHTML = '<div class="loading"><img src="assets/picto.png" alt="" width="54" height="64"><span>Chargement…</span></div>'; await loadAll(); render(); startRealtime(render); bootTrace();
});
