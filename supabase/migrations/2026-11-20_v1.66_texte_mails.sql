-- v1.66 — Texte intégral des mails dans le journal des suivis (demande d'Anthony du 20/11/2026), sans l'historique cité.
-- Deux colonnes NOUVELLES, vides : aucune donnée existante n'est modifiée ; aucun droit nouveau (chaque colonne suit les règles
-- d'accès de sa table, inchangées) :
--  - prospect_logs.mail_text : texte d'un mail IMPORTÉ dans un suivi (.eml / Apple Mail), lu dans le .eml joint au suivi — même
--    accès que ce fichier et que le journal (is_team) ;
--  - mail_messages.body_text : texte d'un message de la boîte anthony@, lu dans Gmail par le compte titulaire — même accès que les
--    messages eux-mêmes (is_mailbox_owner : compte d'Anthony seulement), jamais recopié dans le journal.
-- Remplissage : par l'application (js/textes-journal.js) à l'affichage d'un suivi ou par « Compléter les textes du journal » (reprise des
-- entrées existantes, seulement les colonnes vides, jamais d'écrasement) ; mails importés après la v1.66 : au dépôt (js/data.js).
-- Retour arrière : update ... set mail_text = null / body_text = null (le texte actuel, body, n'est jamais touché).
-- Rejouable (if not exists). Ordre : cette migration, PUIS l'application v1.66.
begin;

alter table public.prospect_logs add column if not exists mail_text text;
comment on column public.prospect_logs.mail_text is
  'v1.66 : texte intégral d''un mail importé (.eml joint au suivi), sans l''historique cité ; vide = non lu (le journal affiche body, signalé « Extrait »)';

alter table public.mail_messages add column if not exists body_text text;
comment on column public.mail_messages.body_text is
  'v1.66 : texte intégral du message (boîte anthony@), sans l''historique cité ; lu dans Gmail par le compte titulaire ; même accès que mail_messages';

commit;
