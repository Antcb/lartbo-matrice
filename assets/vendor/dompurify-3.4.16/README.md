# DOMPurify 3.4.16 (copie locale)

Bibliothèque libre de nettoyage HTML (Cure53), utilisée par `safeHtml` (`js/utils.js`).

Provenance vérifiée le 22/10/2026 auprès de deux sources officielles indépendantes :
- registre npm, paquet `dompurify@3.4.16` (seul mainteneur : cure53), empreinte du paquet
  `sha512-sqo+pNp3qRhCIpbgRi1y8Tgk27Bo2Ry7w0dC1NBeNTdZChWjz9Xb/KOoZbRP/R6pQZ80Qw8YhXw13hWWBbMRnQ==` ;
- dépôt GitHub `cure53/DOMPurify`, étiquette `3.4.16` (commit `b9b9d80f7e401771c2ccaef5f45def7eec8f27d7`), fichier `dist/purify.es.mjs`.

Le fichier `purify.es.js` est **identique** à `dist/purify.es.mjs` des deux sources, à une seule différence près :
la dernière ligne `//# sourceMappingURL=…` a été retirée (le fichier de correspondance n'est pas copié).
Empreinte SHA-256 de `purify.es.js` : `9c52577e368cdc6f3fb2bc87de222c8139e30655eef54a2bebde6d4b0a85ccb8`.

Licence : Apache 2.0 / MPL 2.0 (fichier `LICENSE`, identique à l'original).
Mise à jour : nouveau dossier `dompurify-X.Y.Z`, mêmes vérifications, changer le chemin d'import dans `js/utils.js`, relancer les tests.
