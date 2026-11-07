/**
 * ✉️ Destinataires et copies des mails — champ unique (v1.60.3, demande d'Anthony du 07/11/2026, après le lot V1.55) :
 * une seule ligne par champ, les adresses choisies en pastilles (✕ pour retirer), la recherche des contacts au fil de la saisie
 * dans le champ lui-même (composant de suggestions commun, js/ui/autocomplete.js, source « rcpt ») et l'ajout libre d'une adresse.
 * Plus de champ de recherche séparé ni de rangée de pastilles sous le champ : champ vide = adresses des contacts de la structure.
 * Le champ d'adresses d'origine (#ml-to, #pr-cc…) reste la seule valeur lue à l'envoi (circuits Gmail / scripts Google inchangés),
 * gardée dans le brouillon de la fenêtre ; il est simplement masqué derrière les pastilles.
 * Clavier : ↑ ↓ Entrée dans les suggestions ; virgule, point-virgule ou Entrée valident une adresse tapée ; Retour arrière sur un
 * champ vide retire la dernière pastille ; une adresse invalide n'est jamais ajoutée (message sous le champ, Q23).
 */
import { byId, contactsWithMail } from '../selectors.js';
import { MAIL_MSG, esc, fieldError, mailAddr, mailOk, mailParts, toast } from '../utils.js';
import { acInput } from './autocomplete.js';

export { mailParts };
const has = (input, mail) => mailParts(input.value).some(p => mailAddr(p).toLowerCase() === mailAddr(mail).toLowerCase());
const set = (input, parts) => { input.value = parts.join(', '); input.dispatchEvent(new Event('input', {bubbles: true})); };
/** Retire les doublons (même adresse, majuscules comprises), en gardant la première écriture */
export function dedupe(input){
  const seen = new Set(), parts = mailParts(input.value), keep = parts.filter(p => { const a = mailAddr(p).toLowerCase(); if (seen.has(a)) return false; seen.add(a); return true; });
  if (keep.length !== parts.length) set(input, keep);
  return parts.length - keep.length;
}

/**
 * Champ Destinataire / Copie : pastilles + saisie avec suggestions, sur une seule ligne.
 * id : identifiant du champ d'adresses lu à l'envoi ; le champ de saisie visible est « id-q » (cible du <label for>).
 * prospection : contacts liés uniquement à des structures inactives proposés seulement sur demande (v1.60.2).
 */
export function recipientsField(id, structureId, {value = '', prospection = false, placeholder = 'Nom ou adresse…', label = 'Destinataires'} = {}){
  return `<div class="tagpick rcpt-field" data-rcpt="${esc(id)}">
    <span class="rcpt-chips" role="list" aria-label="${esc(label)} choisis"></span>
    ${acInput('rcpt', {attrs: `data-rcpt-search="${esc(id)}"`, placeholder, activeOnly: prospection,
      inputAttrs: `id="${esc(id)}-q" data-mails inputmode="email" aria-label="${esc(label)} : chercher un contact (nom ou adresse) ou taper une adresse"`,
      boxAttrs: `data-rcpt-for="${esc(id)}" data-structure="${esc(structureId || '')}"`})}
    <input id="${esc(id)}" class="rcpt-src" type="text" data-mails tabindex="-1" aria-hidden="true" value="${esc(value)}">
  </div>`;
}

/** Nom affiché d'une pastille : « Nom <adresse> » tapé, sinon le contact de la base qui a cette adresse */
function chip(part, i){
  const a = mailAddr(part), named = (part.match(/^\s*"?([^"<]*?)"?\s*<[^<>]*>\s*$/) || [])[1], name = named || contactsWithMail([a])[0]?.display_name || '';
  const bad = !mailOk(a);
  return `<span class="tp-chip rcpt-chip${bad ? ' bad' : ''}" role="listitem" title="${esc(bad ? MAIL_MSG : a)}">${name ? `${esc(name)} <small>${esc(a)}</small>` : esc(part)}<button type="button" class="rcpt-rm" data-rcpt-rm="${i}" aria-label="Retirer ${esc(part)}">✕</button></span>`;
}
const fieldOf = el => el?.closest?.('[data-rcpt]');
const srcOf = f => f && document.getElementById(f.dataset.rcpt);
const qOf = f => f?.querySelector('.ac-input');
/** Action de l'utilisateur : le brouillon en cours de restauration ne repasse plus dessus (comme les étiquettes) */
const touched = f => { const form = f.closest('form'); if (form) form._draftGen = (form._draftGen || 0) + 1; };

/** Pastilles redessinées depuis le champ d'adresses (après un modèle, un contact choisi, un brouillon restauré) ; doublons retirés */
export function syncChips(root = document){
  [...(root.matches?.('[data-rcpt]') ? [root] : []), ...root.querySelectorAll('[data-rcpt]')].forEach(f => { const src = srcOf(f); if (!src) return;
    dedupe(src);
    f.querySelector('.rcpt-chips').innerHTML = mailParts(src.value).map(chip).join(''); });
}
function add(f, part){
  const src = srcOf(f); if (!src || has(src, part)) return;
  touched(f); set(src, [...mailParts(src.value), part.trim()]); syncChips(f);
}
/** Adresse(s) tapée(s) : les valides deviennent des pastilles (sans doublon), les invalides restent dans la saisie, signalées */
function commit(q){
  const f = fieldOf(q); if (!f || !q.value.trim()) return;
  const bad = [];
  mailParts(q.value).forEach(p => mailOk(mailAddr(p)) && mailAddr(p).includes('@') ? add(f, p) : bad.push(p));
  q.value = bad.join(', ');
  fieldError(q, bad.length ? MAIL_MSG : '');
}
/** Avant l'envoi (js/ui/modal.js) : l'adresse tapée mais pas encore validée est ajoutée ; une invalide reste signalée */
export function commitRecipients(root){ root.querySelectorAll('[data-rcpt] .ac-input').forEach(commit); }

// suggestion choisie (contact de la structure, de la base, ou « Ajouter … ») : ajoutée, sans doublon ; la saisie est vidée
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset?.rcptSearch || !t.value) return;
  const m = t.value.trim(), f = fieldOf(t), q = qOf(f);
  t.value = ''; if (q){ q.value = ''; fieldError(q, ''); }
  if (!f) return;
  if (m.startsWith('sans-adresse:')) return toast(`${byId('contacts', m.slice(13))?.display_name || 'Ce contact'} n’a pas d’adresse mail`, true);
  add(f, m);
});
// retirer une pastille (✕) : un clic, la saisie garde le focus
document.addEventListener('click', e => {
  const rm = e.target.closest?.('[data-rcpt-rm]');
  const f = fieldOf(e.target); if (!f) return;
  if (!rm){ if (!e.target.closest('input, button')) qOf(f)?.focus(); return; }   // clic dans le cadre : on peut taper
  e.preventDefault();
  const src = srcOf(f), i = Number(rm.dataset.rcptRm);
  touched(f); set(src, mailParts(src.value).filter((_, k) => k !== i)); syncChips(f); qOf(f)?.focus();
});
document.addEventListener('keydown', e => {
  const q = e.target; if (!q.classList?.contains('ac-input') || !fieldOf(q)) return;
  // Entrée : la suggestion surlignée a déjà été prise par la liste (saisie vidée) ; sinon l'adresse tapée. Jamais d'envoi du formulaire.
  // (liste encore ouverte avec des lignes, ex. « Afficher aussi … » : rien n'est validé, on continue de choisir)
  if (e.key === 'Enter'){ e.preventDefault(); if (!(q.getAttribute('aria-expanded') === 'true' && document.querySelector('.ac-list .ac-item'))) commit(q); }
  else if (e.key === ',' || e.key === ';'){ e.preventDefault(); commit(q); }
  else if (e.key === 'Backspace' && !q.value && q.selectionStart === 0){
    const f = fieldOf(q), src = srcOf(f), parts = mailParts(src.value); if (!parts.length) return;
    e.preventDefault(); touched(f); set(src, parts.slice(0, -1)); syncChips(f);
  }
});
// adresses collées avec des séparateurs : tout ce qui précède le dernier séparateur est validé ; message effacé dès qu'on retape
document.addEventListener('input', e => {
  const q = e.target; if (!q.classList?.contains('ac-input') || !fieldOf(q) || !e.isTrusted) return;
  fieldError(q, '');
  const v = q.value, cut = Math.max(v.lastIndexOf(','), v.lastIndexOf(';'));
  if (cut < 0 || (v.slice(0, cut).split('"').length % 2 === 0)) return;   // virgule dans un nom entre guillemets : on attend
  const tail = v.slice(cut + 1).trimStart(); q.value = v.slice(0, cut); commit(q);
  q.value = [q.value, tail].filter(Boolean).join(', ');
});
// en quittant le champ : l'adresse tapée est ajoutée (comme pour les étiquettes)
document.addEventListener('focusout', e => {
  const q = e.target; if (!q.classList?.contains('ac-input') || !fieldOf(q)) return;
  setTimeout(() => { if (q.isConnected && document.activeElement !== q) commit(q); }, 160);
});
// brouillon restauré (js/ui/drafts.js, sans événement « input » sur les champs) : pastilles remises à jour
document.addEventListener('draft-applied', e => syncChips(e.target.closest?.('dialog') || document));
