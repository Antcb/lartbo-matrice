# Scripts d'intervention en production — lot D1

Gel des écritures pendant le déploiement du lot D1 (aucune donnée métier dans ces fichiers).
Ils ne s'exécutent que sur la production (garde d'identité) et uniquement **sur autorisation d'Anthony**,
dans l'ordre de la « PROCÉDURE DÉFINITIVE — DÉPLOIEMENT MATRICE D1 ».

- `2026-10-27_d1_suspension_ecritures.sql` : note puis retire les droits d'écriture de l'application, des visiteurs et des
  fonctions serveur (tables financières), l'exécution des fonctions d'écriture appelables par l'API, et met en pause les
  rappels automatiques ; vérifie le résultat dans la même transaction. Relançable (à relancer après le déploiement D1).
- `2026-10-27_d1_verification_gel.sql` : tentatives d'écriture réelles par chaque rôle, transaction entièrement annulée ;
  attendu « BILAN GEL : CONFORME ».
- `2026-10-27_d1_reprise_ecritures.sql` : rend exactement les droits notés, réactive les rappels, efface la note.

Répétés sur le projet de test (identifiant substitué, corps identique) : suspension → retour à l'état d'avant D1 →
déploiement D1 → nouvelle suspension → v1.45 → reprise ; empreinte des droits identique avant / après.
