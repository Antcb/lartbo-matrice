# Bibliothèques copiées localement (`assets/vendor/`)

Aucune bibliothèque n'est chargée depuis un service tiers (lot S9, alerte CodeQL n°6). Chaque dossier porte la version :
un changement de version = un nouveau dossier, ce qui force aussi les navigateurs à recharger le fichier.
Le contrôle `tests/static/check.mjs` refuse tout script chargé depuis une adresse extérieure.

Provenance vérifiée le 22/10/2026 : paquets officiels du registre npm (empreinte `sha512` du paquet ci-dessous) ;
les fichiers copiés sont **identiques octet pour octet** aux fichiers du paquet (sauf mention).

| Dossier | Paquet npm | Empreinte du paquet (sha512) | Fichiers copiés | Utilisé par |
|---|---|---|---|---|
| `supabase-js-2.45.4/` | `@supabase/supabase-js@2.45.4` (dépôt supabase/supabase-js) | `E5p8/zOLaQ3a462MZnmnz03CrduA5ySH9hZyL03Y+QZLIOO4/Gs8Rdy4ZCKDHsN7x0xdanVEWWFN3pJFQr9/hg==` | `dist/umd/supabase.js`, `dist/umd/591.supabase.js` (morceau chargé seulement hors navigateur), `LICENSE` | les 4 pages HTML |
| `leaflet-1.9.4/` | `leaflet@1.9.4` (dépôt Leaflet/Leaflet) | `nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==` | `dist/leaflet.js`, `dist/leaflet.css`, `dist/images/*`, `LICENSE` | `index.html` (carte) |
| `exceljs-4.4.0/` | `exceljs@4.4.0` (dépôt exceljs/exceljs) | `XctvKaEMaj1Ii9oDOqbW/6e1gXknSY4g/aLCDicOXqBE4M0nRWkUu0PTp++UPNzoFY12BNHMfs/VadKIS6llvg==` | `dist/exceljs.min.js`, `LICENSE` | `js/exports.js` (export Excel, chargé à la demande) |
| `dompurify-3.4.16/` | `dompurify@3.4.16` | voir `dompurify-3.4.16/README.md` | `dist/purify.es.mjs` → `purify.es.js` (ligne `sourceMappingURL` retirée) | `js/utils.js` |

Versions : **identiques** à celles chargées auparavant depuis jsDelivr et cdnjs. Seule différence de forme : jsDelivr servait
`supabase.min.js` et cdnjs `leaflet.min.js` / `leaflet.min.css`, fichiers produits par ces services à partir des mêmes versions ; on utilise ici les fichiers d'origine
des paquets. **Non comparé octet pour octet** avec les anciens fichiers des CDN (inaccessibles depuis l'environnement de vérification) : l'équivalence est vérifiée par les tests (carte, export Excel, client Supabase, application complète).

Dépendances : les fichiers copiés sont des **paquets complets** (dépendances incluses à la publication) : Supabase JS 2.45.4 contient auth-js 2.65.0, postgrest-js 1.16.1, realtime-js 2.10.2, storage-js 2.7.0, functions-js 2.4.1 (versions figées par le paquet) ; ExcelJS 4.4.0 contient ses propres dépendances (jszip, dayjs…) telles que publiées ; Leaflet n'a aucune dépendance. Aucun fichier supplémentaire n'est chargé, sauf `591.supabase.js` (jamais dans un navigateur).

Les polices Google (`fonts.googleapis.com`) restent externes : feuille de style de polices uniquement, aucun script.

Vérifier un fichier : `npm pack <paquet>@<version>`, extraire l'archive et comparer (`cmp`) avec le fichier copié.
