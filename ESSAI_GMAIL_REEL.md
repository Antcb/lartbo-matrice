# Messagerie — essai avec un vrai Gmail (boîte et correspondant de TEST)

Préparé le 06/11/2026, mis à jour le 08/11/2026 (v1.63). **Aucun contact réel, aucune boîte réelle d'Anthony, aucune donnée de production.**
Rien n'est lancé sans son accord. La séance (comptes, autorisations, déploiements) est décrite une seule fois dans **ESSAI_REEL_GOOGLE.md**.

## Ce qui est déjà vérifié sans Google (simulé, réseau bloqué)
| Domaine | Preuve automatique |
|---|---|
| Fil : `threadId`, `In-Reply-To`, `References`, objet « Re: » / « Tr : » ; brouillon mis à jour, jamais copié ; brouillon disparu → rien ne part | `tests/static/messagerie-regles.mjs` (script exécuté avec des services Google simulés) |
| Envoi « envoyé » seulement avec l'identifiant renvoyé par Gmail ; journal écrit par la synchronisation (jamais avant) | idem + `e2e/messagerie-v161.spec.js` (envoi non confirmé) |
| Limite 25 Mo sur le message **encodé** (navigateur et script) ; pièces illisibles → rien ne part ; jamais un lien à la place | idem + `e2e/messagerie-v163.spec.js` |
| Rattachement : unique → auto (raison visible) ; plusieurs contacts d'une structure → structure ; plusieurs structures / suivis → choix ; fil connu par `References` (réponse Apple Mail) ; déjà rattachée → gardée | `supabase/repetitions/2026-11-08_v1.63_messagerie_essai.sql` (61 essais, base PostgreSQL locale) + e2e |
| Aucun doublon (synchronisations répétées, envoi depuis L'ArtBotrice, mail déposé depuis Apple Mail) ; relances suspendues à la réponse | essai SQL |
| Libellé / archive / corbeille distincts, jamais de suppression définitive ; images distantes et scripts bloqués | script simulé + e2e |
| Accès : secret dédié de la tâche planifiée ; actions de l'application réservées à l'équipe | script simulé (règles `mail-sync`) + essai SQL (droits, RLS, adresse de la tâche) |

## Ce qui reste à voir sur un vrai Gmail (preuve attendue)
| # | Scénario | Preuve |
|---|---|---|
| 1 | T2 écrit à T1 (contact connu, une structure, un suivi ouvert) | « Rattachée automatiquement » ; une ligne au journal |
| 2 | T2 écrit depuis un alias inconnu, puis depuis une adresse inscrite dans deux structures | « À rattacher » + raison ; lecture et réponse possibles ; choix de structure demandé |
| 3 | Répondre, répondre à tous (T2 + `T2+copie`), transférer depuis l'application | même fil chez T2 et dans « Envoyés » de T1 ; journal complété **après** l'envoi |
| 4 | Brouillon : enregistrer, fermer, rouvrir, envoyer ; puis brouillon supprimé dans Gmail avant l'envoi | un seul brouillon dans Gmail ; second cas : message clair, rien ne part |
| 5 | Documents : fiche technique (stockage), PDF Drive partagé avec T1, PDF Drive **non** partagé | deux vraies pièces reçues chez T2, tailles conformes ; le non partagé est signalé, jamais joint |
| 6 | 18,5 Mo bruts | refus avant l'envoi, rien dans Gmail |
| 7 | Libellé, archive, corbeille, retour de corbeille depuis l'application | visibles dans Gmail web de T1 |
| 8 | Dans Gmail web de T1 (et Apple Mail si ajouté) : libellé, archive, lu, réponse | repris à la synchronisation suivante ; réponse au journal une fois |
| 9 | « Actualiser » trois fois + deux passages planifiés | aucun doublon ; dernière synchronisation à jour |
| 10 | Relance programmée, puis T2 répond ; puis réponse d'absence automatique et adresse inexistante (avis de non-remise) | réponse : relance suspendue, une notification ; absence et non-remise : marquées au journal, relance gardée |
| 11 | T2 envoie un mail avec une image hébergée | image non chargée avant « Afficher les images » (journal réseau) |
| 12 | Adresse du script faussée dans Réglages du projet de test | erreur affichée avec l'heure ; « dernière synchronisation réussie » inchangée |

Contrôles en base du projet de test après chaque bloc : `mail_messages` (identifiant Gmail unique), `prospect_logs` (`author = 'Messagerie'`,
une ligne par message), `tasks` de relance, `notifications` `mail-reponse:%`, `mail_sync_state`.

Non couvert : la boîte production@ (plus tard) ; l'activation en production (autorisation séparée, après cet essai).
