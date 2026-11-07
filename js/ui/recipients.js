/**
 * ✉️ Destinataires et copies des mails (lot V1.55, demande d'Anthony du 04/11/2026) : sous le champ d'adresses (qui reste
 * visible et modifiable, et seul lu à l'envoi — circuits Gmail / scripts Google inchangés), les adresses des contacts de la
 * structure à ajouter ou retirer d'un clic, une recherche dans tous les contacts de la base, et aucun doublon.
 */
import { byId, contactMails, linksOfStructure } from '../selectors.js';
import { esc, toast } from '../utils.js';
import { acInput } from './autocomplete.js';

/** Adresses d'un champ : séparées par des virgules ou des points-virgules (hors noms entre guillemets) */
export const mailParts = v => String(v || '').split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.trim()).filter(Boolean);
const addrOf = x => ((x.match(/<([^<>]*)>\s*$/) || [, x])[1]).trim().toLowerCase();
const has = (input, mail) => mailParts(input.value).some(p => addrOf(p) === mail.toLowerCase());
const set = (input, parts) => { input.value = parts.join(', '); input.dispatchEvent(new Event('input', {bubbles: true})); };
/** Retire les doublons (même adresse, majuscules comprises), en gardant la première écriture */
export function dedupe(input){
  const seen = new Set(), parts = mailParts(input.value), keep = parts.filter(p => { const a = addrOf(p); if (seen.has(a)) return false; seen.add(a); return true; });
  if (keep.length !== parts.length) set(input, keep);
  return parts.length - keep.length;
}

/**
 * Bloc de suggestions sous un champ d'adresses (#target) : contacts de la structure + recherche dans la base.
 * La recherche trouve un contact par son nom ou par n'importe laquelle de ses adresses et propose chacune d'elles (v1.60.2).
 * prospection : les contacts liés uniquement à des structures inactives n'y sont proposés que sur demande (v1.60.2).
 */
export function recipientsHelp(target, structureId, {prospection=false}={}){
  const opts = linksOfStructure(structureId).flatMap(c => mailParts(contactMails(c)).map(m => ({c, m})));
  return `<div class="rcpt-sug" data-rcpt-box="${esc(target)}">
    ${opts.map(({c, m}) => `<button type="button" class="tag-chip" data-rcpt-add="${esc(m)}" data-rcpt-for="${esc(target)}" aria-pressed="false" title="${esc(m)}">${esc(c.display_name)} · ${esc(m)}</button>`).join('')}
    <span class="rcpt-search">${acInput('rcpt', {attrs: `data-rcpt-search="${esc(target)}" aria-label="Chercher un contact de la base (nom ou adresse)"`, placeholder: 'Chercher un contact de la base (nom ou adresse)…', activeOnly: prospection})}</span></div>`;
}
/** Met à jour l'état des pastilles (adresse présente ou non dans le champ) */
export function syncChips(root = document){
  root.querySelectorAll('[data-rcpt-add]').forEach(b => { const input = document.getElementById(b.dataset.rcptFor); if (!input) return;
    const on = has(input, b.dataset.rcptAdd); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
}
// pastille : ajoute l'adresse si elle manque, la retire si elle y est (jamais en double)
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-rcpt-add]'); if (!b) return;
  e.preventDefault();
  const input = document.getElementById(b.dataset.rcptFor); if (!input) return;
  const m = b.dataset.rcptAdd;
  // le clic fait ce que la pastille AFFICHE (relecture V1.55, B1) : « + » ne fait qu'ajouter (rien si l'adresse y est déjà, par
  // exemple après un brouillon restauré), « ✓ » ne fait que retirer — jamais l'inverse de ce que l'on voit
  if (b.classList.contains('on')) set(input, mailParts(input.value).filter(p => addrOf(p) !== m.toLowerCase()));
  else if (!has(input, m)) set(input, [...mailParts(input.value), m]);
  syncChips(b.closest('dialog') || document);
});
// brouillon restauré (js/ui/drafts.js, sans événement « input » sur les champs) : pastilles remises à jour
document.addEventListener('draft-applied', e => syncChips(e.target.closest?.('dialog') || document));
// recherche dans la base : l'adresse choisie (une ligne par adresse du contact, v1.60.2) est ajoutée, sans doublon
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset?.rcptSearch || !t.value) return;
  const m = t.value.trim(), input = document.getElementById(t.dataset.rcptSearch);
  t.value = ''; const vis = t.closest('.ac')?.querySelector('.ac-input'); if (vis) vis.value = '';
  if (!input) return;
  if (m.startsWith('sans-adresse:')) return toast(`${byId('contacts', m.slice(13))?.display_name || 'Ce contact'} n’a pas d’adresse mail`, true);
  if (!has(input, m)) set(input, [...mailParts(input.value), m]);
  syncChips(input.closest('dialog') || document);
});
// champ modifié à la main : doublons retirés, pastilles à jour
document.addEventListener('input', e => { if (e.target.closest?.('dialog') && e.target.id && document.querySelector(`[data-rcpt-box="${CSS.escape(e.target.id)}"]`)) syncChips(e.target.closest('dialog')); });
document.addEventListener('change', e => { const t = e.target; if (t.id && document.querySelector(`[data-rcpt-box="${CSS.escape(t.id)}"]`)) dedupe(t); }, true);
