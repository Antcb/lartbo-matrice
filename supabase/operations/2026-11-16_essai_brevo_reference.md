# Essai réel — Brevo v1.64.0 (MATRICE fait référence)

Préparé le 16/11/2026. **À lancer seulement avec l'accord d'Anthony** (déploiement en production en mode essai).
Adresses d'essai validées par Anthony le 16/11 : `colbe.anthony@gmail.com` (déjà dans Brevo, liste 2 : sert au cas « conflit », jamais modifiée) et `colbe.anthony+essai@gmail.com` (absente de Brevo).
Lieu : **projet de TEST** (aucun déploiement en production), avec la vraie clé Brevo et la liste blanche ci-dessous ; aucune liste donnée à la création (pas d'inscription à « Live France »).
`anthony@lartboristerie.com` est protégée : jamais utilisée pour l'essai.

## Garde-fous pendant tout l'essai
- Réglage `brevo_essai_emails` = les 2 adresses d'essai : la fonction serveur ignore toute autre adresse **avant** tout appel à Brevo ;
  « Envoyer tous les contacts » et l'adoption sont refusés.
- Aucune campagne, aucun envoi. Les autres contacts et fiches Brevo ne sont pas touchés.

## Déploiement (dans cet ordre, avec accord)
1. Migration `supabase/migrations/2026-11-16_v1.64.0_brevo_reference.sql` (une transaction ; rien supprimé ni modifié dans les données existantes).
2. `brevo_essai_emails` = `colbe.anthony@gmail.com, colbe.anthony+essai@gmail.com`.
3. Fonction `brevo-sync` v1.64.0 puis `backup-export` (tables `brevo_fiches`, `brevo_journal`).
4. Publication de l'application v1.64.0 (PR, tests au vert, « Rebase and merge »).

## Scénarios (contact fictif « Essai Brevo », créé puis supprimé par Claude)
| # | Action dans MATRICE | Attendu dans Brevo | Attendu au registre |
|---|---|---|---|
| 1 | Créer le contact avec `+essai1` | fiche créée dans la liste 2 | `active`, origine `matrice` |
| 2 | Changer le prénom, rattacher une structure | prénom, STRUCTURE, FONCTIONS mis à jour ; listes inchangées | `active` |
| 3 | Anthony se désabonne de `+essai1` dans Brevo (à la main) | fiche désabonnée | — |
| 4 | Changer l'adresse en `+essai2` | **même fiche** renommée, toujours désabonnée, pas de doublon | `+essai2` `active` |
| 5 | Supprimer le contact | fiche **conservée** (désabonnée) | `detachee` |
| 6 | Recréer un contact `+essai1` (non désabonné), le supprimer | fiche créée puis **supprimée** | `supprimee`, journal |
| 7 | Supprimer à la main la fiche `+essai2` dans Brevo, puis modifier un contact qui la porte | fiche **non recréée** | `supprimee_brevo`, alerte sur la fiche contact |

Contrôles après chaque scénario : lecture de la fiche Brevo (GET, sans modification), du registre et du journal.

## Fin d'essai
- Fiches d'essai restantes : suppression dans Brevo seulement avec l'accord d'Anthony.
- `brevo_essai_emails` vidé → fonctionnement normal (la protection d'anthony@ reste).
- L'adoption des fiches préexistantes reste une opération distincte : aperçu chiffré présenté à Anthony, exécution seulement sur son autorisation explicite.

## Résultats de l'essai du 16/11 (matin) et suite
- Scénarios 1, 2, 5 (conflit), cas ambigu, suppression, fiche supprimée dans Brevo : conformes.
- Scénario 4 : même fiche renommée (même identifiant, historique gardé) MAIS désabonnement global perdu : Brevo réabonne une
  fiche dont l'adresse change (documentation de PUT /contacts). Décision d'Anthony (16/11) : un contact désabonné ne doit jamais
  redevenir abonné à cause de MATRICE → garantie impossible (comportement documenté de Brevo, désabonnements par liste non
  garantis) → option 2 : changement d'adresse d'une fiche désabonnée bloqué (conflit explicite), rien renommé ni créé.
- Décisions du 17/11 : remplacement d'une adresse désabonnée bloqué aussi par l'autre emplacement (même enregistrement) ; vraie
  deuxième adresse d'un contact désabonné créée SANS liste ; fiche supprimée dans Brevo = aucune nouvelle fiche pour le contact
  (adresse par adresse, « Recréer dans Brevo ») ; import en masse : contacts en suspens écartés.
- Lever un conflit « désabonnée » : remettre l'ancienne adresse dans MATRICE (le conflit disparaît à l'enregistrement) ; si la
  personne a vraiment changé d'adresse, traiter à la main dans Brevo (son opposition doit suivre), puis mettre la fiche contact à jour.
- Essai réel du 18/11 (projet de test, fonction identique au commit 4346a03) : reprise d'une fiche désabonnée = champs mis à jour,
  désabonnement intact ; changement d'adresse d'une désabonnée = conflit, rien renommé ni créé ; conflit répété = 1 ligne au
  journal ; adresse remise = conflit levé ; vraie 2e adresse avec la liste 2 réglée = créée SANS liste (journal « sans liste ») ;
  adresse désabonnée retirée = fiche conservée (détachée). Fiche d'essai n° 8676 (+essai2) supprimée sur demande d'Anthony.
  À noter : contacts_clean remonte le mail 2 en mail 1 quand le mail 1 est vide (le cas « autre emplacement » arrive donc comme
  un changement du même emplacement, bloqué aussi).
