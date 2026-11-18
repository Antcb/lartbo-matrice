/**
 * Brevo sur la fiche contact et dans Réglages (v1.64, décisions d'Anthony du 16/11/2026 : MATRICE fait référence, Brevo diffuse).
 * Lecture seule du registre (table brevo_fiches, écrite par la fonction serveur brevo-sync) ; seule action : recréer à la demande
 * une fiche supprimée à la main dans Brevo (brevo_recreer) — jamais automatique.
 */
import { sb } from './data.js';
import { listeEssaiBrevo, setting } from './selectors.js';
import { S } from './state.js';
import { esc, toast } from './utils.js';

const mails = c => [c?.email, c?.email_2].map(e => String(e || '').trim().toLowerCase()).filter(e => /@/.test(e)).filter((e, i, a) => a.indexOf(e) === i);
/** Adresses protégées à la main (Réglages › Brevo, même lecture que la fonction serveur : listeProtegees) */
export const protegeesBrevo = () => listeEssaiBrevo(setting('brevo_protegees')) || [];
/** Autres contacts qui portent la même adresse (adresse partagée : aucune synchronisation, à dédoublonner) */
const autresPorteurs = (email, id) => S.db.contacts.filter(k => k.id !== id && mails(k).includes(email));

/** État Brevo de chaque adresse d'un contact, en mots (fiche du registre éventuelle) */
export function etatBrevo(email, fiche, contactId, protegees = protegeesBrevo()){
  if (protegees.includes(email)) return {texte: 'protégée : MATRICE n’y touche jamais'};
  const autres = autresPorteurs(email, contactId);
  if (autres.length) return {alerte: true, texte: `adresse partagée avec ${autres.map(k => k.display_name || 'un contact sans nom').join(', ')} : aucune synchronisation, à dédoublonner`};
  if (!fiche || fiche.statut === 'supprimee') return {texte: 'pas gérée par MATRICE (fiche Brevo préexistante, ou contact hors prospection)'};
  if (fiche.statut === 'supprimee_brevo') return {alerte: true, recreer: true, texte: fiche.detail || 'fiche supprimée dans Brevo : MATRICE ne la recrée pas d’elle-même'};
  if (fiche.statut === 'conflit') return {alerte: true, texte: fiche.detail || 'changement d’adresse en conflit : aucune fusion'};
  if (fiche.statut === 'detachee') return {texte: fiche.detail || 'conservée dans Brevo, plus gérée'};
  if (['creation', 'renommage', 'suppression'].includes(fiche.statut)) return {texte: 'opération en cours…'};
  return {texte: fiche.origine === 'preexistante' ? 'gérée par MATRICE (fiche préexistante : jamais supprimée automatiquement)' : 'gérée par MATRICE'};
}

/** Bloc vide de la fiche contact, rempli ensuite (lecture du registre) */
export const brevoBlockHTML = c => c?.id ? `<div class="full" id="ct-brevo"></div>` : '';
export async function fillBrevoContact(c){
  const el = document.getElementById('ct-brevo'); if (!el || !c?.id) return;
  const list = mails(c), anciennes = [];
  const sures = list.filter(e => /^[^\s"\\,()]+$/.test(e));   // caractères qui casseraient le filtre : adresse lue par son contact seulement
  const {data, error} = await sb.from('brevo_fiches').select('email, statut, origine, detail, contact_id').or(`contact_id.eq.${c.id}${sures.length ? `,email.in.(${sures.map(e => `"${e}"`).join(',')})` : ''}`);
  if (error){ el.innerHTML = `<p class="help">Brevo : état indisponible (${esc(error.message)}).</p>`; return; }
  const parMail = new Map((data || []).map(f => [f.email, f]));
  for (const f of data || []) if (!list.includes(f.email) && f.contact_id === c.id && ['active', 'conflit'].includes(f.statut)) anciennes.push(f);
  const lignes = list.map(e => {
    const s = etatBrevo(e, parMail.get(e), c.id);
    return `<li class="${s.alerte ? 'warn-txt' : ''}">${esc(e)} : ${esc(s.texte)}${s.recreer ? ` <button type="button" class="btn sm" data-act="brevoRecreer" data-email="${esc(e)}" data-id="${esc(c.id)}">Recréer dans Brevo</button>` : ''}</li>`;
  }).concat(anciennes.map(f => `<li class="warn-txt">${esc(f.email)} (ancienne adresse) : ${esc(f.detail || 'en attente de synchronisation')}</li>`));
  el.innerHTML = lignes.length ? `<p class="help">Brevo (MATRICE fait référence ; les listes et les désabonnements ne sont jamais modifiés) :</p><ul class="help warn-list">${lignes.join('')}</ul>` : '';
}

/** Recréer volontairement une fiche supprimée dans Brevo (confirmée par l'appelant) */
export async function brevoRecreer(email, contact){
  const {data, error} = await sb.rpc('brevo_recreer', {p_email: email});
  if (error || !data?.ok) return toast(error?.message || data?.error || 'Recréation impossible', true);
  toast('Recréation demandée : la fiche est recréée dans Brevo dans quelques secondes');
  setTimeout(() => fillBrevoContact(contact), 6000);
}

/** Réglages › Brevo : adresses portées par plusieurs contacts (protégées, aucune synchronisation) */
export async function brevoDoublonsHTML(){
  const {data, error} = await sb.rpc('brevo_doublons');
  if (error) return `<p class="help">Liste indisponible : ${esc(error.message)}</p>`;
  if (!data?.length) return '<p class="help">Aucune adresse partagée.</p>';
  return `<p class="help">${data.length} adresse${data.length > 1 ? 's' : ''} portée${data.length > 1 ? 's' : ''} par plusieurs contacts : aucune synchronisation Brevo tant qu’elles ne sont pas dédoublonnées.</p>
    <ul class="help warn-list">${data.map(d => `<li>${esc(d.email)} : ${(d.contacts || []).map(k => `<a href="#" data-act="editContact" data-id="${esc(k.id)}">${esc(k.nom || 'sans nom')}</a>`).join(', ')}</li>`).join('')}</ul>`;
}
