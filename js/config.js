/**
 * Réglages : adresse et clé publique Supabase, équipe autorisée, numéro de version.
 */
export const APP_VERSION = '1.26.1';   // ← incrémenté par tools/bump_version.py (voir CHANGELOG.md)

/**
 * Espace de test : …/lartbo-matrice/?test bascule ce navigateur sur une copie séparée de la Matrice
 * (projet Supabase « Lartbo-matrice-test ») ; …/?prod revient à la vraie. Rien de ce qui est fait en test ne touche la vraie Matrice.
 */
export const ENV = (() => {
  try {
    const q = new URLSearchParams(location.search);
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
