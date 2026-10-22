/**
 * 💾 Stockage du navigateur (localStorage), séparé par environnement (lot S0-R8).
 * SEUL module autorisé à lire ou écrire le stockage du navigateur (contrôle automatique : tests/static/check.mjs),
 * avec js/config.js pour la seule clé artbo.env (le choix de l'environnement).
 *  - Production : clés inchangées depuis toujours (« artbo.<clé> », et les clés des pages publiques telles quelles),
 *    pour ne perdre aucun brouillon ni aucune préférence existants.
 *  - Test (?test) : toutes les clés passent sous « artbo-test. » ; rien de ce qui est gardé en test n'est lu en production,
 *    ni l'inverse (brouillons, file des résumés IA, préférences).
 * Option {page: true} : clé d'une page publique (fiche.html, artiste.html), sans le préfixe « artbo. » en production.
 */
import { ENV } from './config.js';

const TEST_PREFIX = 'artbo-test.';
/** Clé réellement utilisée dans le navigateur */
export const storageKey = (k, {page = false} = {}) => ENV === 'test' ? TEST_PREFIX + (page ? 'page.' : '') + k : (page ? '' : 'artbo.') + k;

export function localGet(k, opts){ try { return localStorage.getItem(storageKey(k, opts)); } catch { return null; } }
export function localSet(k, v, opts){ try { localStorage.setItem(storageKey(k, opts), v); } catch { /* navigateur sans stockage */ } }
export function localDel(k, opts){ try { localStorage.removeItem(storageKey(k, opts)); } catch { /* navigateur sans stockage */ } }
