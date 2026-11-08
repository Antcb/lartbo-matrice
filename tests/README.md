# Tests automatiques

Tout tourne **en local** : la base Supabase est remplacée par une fausse base en mémoire
(`fixtures/mock-supabase.js`, données fictives), et toute requête vers un service réel
(Supabase, Google, Brevo, Pennylane…), y compris depuis un onglet ouvert par un lien ou par WebSocket,
est bloquée et fait échouer le test (un test vérifie ce garde-fou lui-même). Seconde barrière : le navigateur de test
ne peut résoudre aucun nom de domaine extérieur et n'utilise aucun proxy (`playwright.config.js`) ; un test le vérifie. Aucun secret n'est utilisé.

## Lancer
```
cd tests
npm ci            # une seule fois
npm test          # contrôles statiques + tests navigateur (≈ 30 s)
npm run test:static
```
Sur GitHub, les mêmes tests tournent à chaque push (branches de développement et `main`) et à chaque demande
de fusion vers `main` (`.github/workflows/tests.yml`). En cas d'échec, le rapport est joint à l'exécution.

## Contenu
| Fichier | Vérifie |
|---|---|
| `static/check.mjs` | analyse du code par acorn : syntaxe de chaque module, imports nommés existants, carte d'import à la version de `js/config.js`, **nombre de fenêtres natives qui n'augmente pas**, aucun secret dans les fichiers suivis par Git (tests compris) |
| `static/message-id.mjs` | (v1.60.4) lecture du Message-ID dans les liens « message: » d'Apple Mail, même règle dans `js/eml.js` et les deux scripts Google, action `mail_by_msgid` en lecture seule (scripts exécutés avec services Google simulés) |
| `static/acces-boite.mjs` | (v1.60.4) recherche dans la boîte anthony@ réservée à son titulaire : identité signée par le relais `script-google` (`identite.ts`), vérifiée par `Prospection.gs` ; production@ inchangé |
| `e2e/demarrage.spec.js` | démarrage, chaque onglet sur ordinateur et téléphone (sans erreur, sans « NaN » ni « undefined »), écran de connexion |
| `e2e/modules.spec.js` | chargement de chaque module dans la page |
| `e2e/parcours.spec.js` | terminer une tâche, confirmer une date, filtre par artiste |
| `e2e/calculs.spec.js` | factures, commissions, TVA, budget d'une date, formats des montants et des dates (comportement actuel figé) |
| `e2e/html.spec.js` | nettoyage du HTML des mails, échappement du texte |
| `e2e/pages-publiques.spec.js` | fiche, artiste, salarié : jeton valide et jeton invalide |
| `static/messagerie-regles.mjs` | messagerie (v1.63) : règles de la fonction `mail-sync` (accès, lignes, doublons) et script de prospection exécuté avec des services Google **simulés** (fil, brouillon, limite encodée, pièces jointes, rangement, historique) |
| `e2e/messagerie-v161.spec.js`, `e2e/messagerie-v163.spec.js` | espace Mails sur la fausse base, script et synchronisation simulés (aucun envoi réel) |

## Règles
- Chaque lot ajoute ses tests ; une règle changée volontairement met à jour le cas concerné avec sa justification.
- Fenêtres natives : la référence `baselines/fenetres-natives.json` ne peut que baisser
  (`node static/check.mjs --baseline` refuse une hausse).
- Jamais de donnée réelle ni de secret dans `fixtures/`.
