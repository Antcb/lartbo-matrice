/**
 * Réglages : adresse et clé publique Supabase, équipe autorisée, numéro de version.
 */
export const APP_VERSION = '1.13.1';   // ← incrémenté par tools/bump_version.py (voir CHANGELOG.md)

export const CFG = {
  // Projet Supabase « Lartbo-matrice ». La clé publiable est publique par conception :
  // la sécurité repose sur les règles d'accès (RLS) de supabase/schema.sql. Jamais la clé service_role ici.
  SUPABASE_URL: 'https://ypvvjoqhzddzbmerypdc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ddWaNvuYwT39_C8WuudceA_ks8IiyGR',
  // Comptes autorisés (doivent aussi exister dans la table app_users)
  TEAM: ['anthony@lartboristerie.com', 'production@lartboristerie.com'],
};
