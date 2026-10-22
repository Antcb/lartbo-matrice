/**
 * 🧪 Mentions de l'espace de test (lot S0-R8) : un seul texte, repris par l'application (bandeau, page de connexion)
 * et par les pages publiques ouvertes avec « test » dans leur lien.
 * Le texte dit la vérité sur les limites : la base et les données du navigateur sont séparées et les liens créés en test
 * portent « test » ; mais tant que le test contient la copie des vraies données, ses jetons sont ceux de la production :
 * un lien de test dont on retire « test » ouvrirait la vraie fiche. D'où la consigne de n'envoyer ni lien ni mail d'ici.
 */
import { ENV, PUBLIC_PAGE } from '../config.js';

export const TEST_APP_NOTICE = 'Espace de test : base séparée de la vraie Matrice ; les liens créés ici portent la mention « test ». N’envoie ni lien ni mail à un vrai contact depuis cet espace.';
export const TEST_PAGE_NOTICE = 'Page de test : les réponses vont dans l’espace de test de la Matrice, pas dans la vraie.';

// Page publique ouverte avec un lien de test : bandeau bien visible en haut de page
if (PUBLIC_PAGE && ENV === 'test'){
  const bar = document.createElement('div');
  bar.className = 'test-banner'; bar.setAttribute('role', 'note'); bar.textContent = TEST_PAGE_NOTICE;
  document.body.prepend(bar);
}
