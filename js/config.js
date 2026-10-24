/**
 * Réglages : adresse et clé publique Supabase, équipe autorisée, numéro de version.
 */
export const APP_VERSION = '1.40.4';   // ← incrémenté par tools/bump_version.py (voir CHANGELOG.md)

/**
 * Espace de test : …/lartbo-matrice/?test bascule l'application de ce navigateur sur le projet Supabase « Lartbo-matrice-test »
 * (base séparée) ; …/?prod revient à la vraie Matrice. Les données gardées dans le navigateur (brouillons, file des résumés IA,
 * préférences) sont séparées entre les deux (js/storage.js). Limites connues : voir le bandeau de l'espace de test.
 * Pages publiques (fiche.html, artiste.html, rh.html) : l'environnement vient UNIQUEMENT de leur propre lien (« test » dans
 * l'adresse) ; le choix gardé par le navigateur est ignoré et jamais modifié, pour qu'un vrai lien ouvre toujours la vraie Matrice.
 */
// Page publique reconnue par le marqueur que la page porte elle-même (<body class="fiche-page">), et en plus par son adresse
// décodée (majuscules, adresse sans « .html » servie par GitHub Pages, caractères encodés) : jamais contournable par l'adresse seule.
export const PUBLIC_PAGE = (() => {
  if (document.body?.classList.contains('fiche-page')) return true;
  let p = location.pathname; try { p = decodeURIComponent(p); } catch { /* adresse mal encodée : prise telle quelle */ }
  return /(^|\/)(fiche|artiste|rh)(\.html?)?\/?$/i.test(p);
})();
export const ENV = (() => {
  try {
    const q = new URLSearchParams(location.search);
    if (PUBLIC_PAGE) return q.has('test') ? 'test' : 'prod';
    if (q.has('test')) localStorage.setItem('artbo.env', 'test');
    if (q.has('prod')) localStorage.removeItem('artbo.env');
    return localStorage.getItem('artbo.env') === 'test' ? 'test' : 'prod';
  } catch { return 'prod'; }
})();

const PROD = {
  // Projet Supabase « Lartbo-matrice ». La clé publiable est publique par conception :
  // la sécurité repose sur les règles d'accès (RLS) de supabase/schema.sql. Jamais la clé service_role ici.
  SUPABASE_URL: 'https://ypvvjoqhzddzbmerypdc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ddWaNvuYwT39_C8WuudceA_ks8IiyGR',
  // Comptes autorisés (doivent aussi exister dans la table app_users)
  TEAM: ['anthony@lartboristerie.com', 'production@lartboristerie.com'],
};
const TEST = {
  SUPABASE_URL: 'https://dthfocplfzzmkgaxhmwk.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_5Nbu2tcyLaCQz5mIHtGkNQ_Ke48oNqw',
  TEAM: null,   // en test : les comptes de la table app_users du projet de test (chargés après la connexion)
};
export const CFG = ENV === 'test' ? TEST : PROD;
