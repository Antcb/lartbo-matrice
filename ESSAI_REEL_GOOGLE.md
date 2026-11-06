# Essais réels Gmail et Agenda — comptes de TEST (préparé le 07/11/2026)

Rien n'est lancé ni créé sans Anthony. Aucun contact réel, aucune boîte ni agenda réel, aucune donnée de production.
Base : projet Supabase **de test**, après la séance V1.57 → V1.60 (son état de départ n'est pas modifié avant).

## Comptes : deux suffisent (minimum réellement nécessaire)
| Compte | Rôle | Pourquoi il ne peut pas être fusionné avec l'autre |
|---|---|---|
| **T1** | joue **anthony@** (script Prospection, messagerie) **et production@** (script Agendas, lecture seule) | — |
| **T2** | joue les **correspondants** (organisateurs) et l'**artiste** (propriétaire des agendas partagés) | une réponse doit venir d'un AUTRE expéditeur (fil, rattachement, suspension de relance) ; un agenda ne se partage pas avec soi-même |

**B1 et B3 sur un même compte (T1) : oui, sans compromettre les scénarios.** Les deux rôles n'ont rien en commun dans le code :
- deux projets Apps Script distincts sur T1 (« Prospection » et « Agendas »), deux déploiements, deux adresses ; leur propriété
  WEBHOOK_SECRET porte le même code que les autres scripts Google (`drive_webhook_secret`), comme en production — c'est le code avec
  lequel le serveur les appelle ; le secret des appels automatiques (`mail_sync_hook` / `cal_sync_hook`) est, lui, propre au serveur ;
- le script Agendas n'a que l'accès « lecture des agendas » (manifeste en lecture seule) ; le script Prospection garde ses accès Gmail ;
- les agendas de T1 lui-même (principal) sont exclus du choix ; seuls ceux partagés par T2 sont proposés ;
- seule différence avec la production (deux comptes distincts) : les invitations de partage d'agenda arrivent dans la boîte de T1
  — elles servent alors de test « conversation inconnue → À rattacher ».

Destinataires d'essai : T2 et ses alias (`T2+salle@…`, `T2+copie@…`) uniquement.

## Ce qu'Anthony fournit, en une seule fois (web uniquement, pas à pas au moment voulu)
1. Deux adresses Google de test, T1 et T2 (créées ou désignées par lui ; je ne crée rien).
2. Sur T1 : coller et déployer les deux scripts (je fournis les étapes et le code), autoriser : Gmail et Drive (Prospection, accès
   habituels du script), **lecture des agendas** seulement (Agendas).
3. Sur T2 : créer deux agendas « Artiste essai A » (partagé avec T1 : « Afficher tous les détails des événements ») et « Artiste essai B »
   (partagé avec T1 : « Afficher uniquement les disponibilités »).
4. Reporter lui-même le code des scripts Google du projet de test (Supabase › Table Editor › `settings` › `drive_webhook_secret` ;
   jamais affiché dans l'application, jamais dans la conversation) dans la propriété WEBHOOK_SECRET de chacun des deux scripts.

## Scénarios
Messagerie (détail : ESSAI_GMAIL_REEL.md) : réponse et réponse à tous dans le bon fil ; brouillon et reprise ; documents joints réellement
reçus (taille, limite sur le message encodé) ; classement visible dans Gmail et changements faits dans Gmail répercutés ; synchronisation
sans doublon ; suspension de la relance à réception d'une réponse ; images distantes bloquées ; panne du script.

Agendas :
| # | Scénario (sur les agendas de T2) | Preuve attendue |
|---|---|---|
| A1 | « Artiste essai A » relié à un artiste fictif | liste des agendas : A et B proposés, pas l'agenda principal de T1 |
| A2 | création, modification (heure, lieu, titre), suppression d'un événement | répercuté au passage suivant ; suppression : plus affiché, ligne gardée « supprimée » |
| A3 | événement récurrent (chaque semaine) + une exception modifiée + une occurrence supprimée | une ligne par occurrence, exception à jour, occurrence supprimée absente, aucun doublon |
| A4 | journée entière, puis trois jours | dates calendaires exactes (fin incluse à l'écran), sans décalage |
| A5 | événement à New York 20 h (fuseau de l'événement) | affiché le jour local ; conflit avec une date le lendemain à Paris (instants réels) |
| A6 | « [SHOW] Bataclan, Paris », « Showroom », « show - Le Transbordeur, 69100 Lyon » | repère pour Paris (France par défaut) et Lyon ; rien pour Showroom |
| A7 | événement « Disponible » | ne bloque pas, aucun avertissement |
| A8 | événement privé | « Indisponible », sans titre ni lieu enregistrés |
| A9 | « Artiste essai B » (disponibilités seulement) | périodes « Indisponible » sans détail ; mode « disponibilités seulement » affiché |
| A10 | T2 retire le partage | « disponibilités plus à jour », erreur affichée, jamais « libre » |
| A11 | option posée sur un jour occupé (Intérêt puis Option) | avertissement, Annuler n'enregistre rien, confirmation enregistre |
| A12 | association d'un « Show » à une date « Confirmée Artiste » | date inchangée, plus de double affichage |
| A13 | appels de la synchronisation sans justificatif / faux secret / compte hors équipe | refusés (403) — voir SECURITE_SYNCHRO.md |
