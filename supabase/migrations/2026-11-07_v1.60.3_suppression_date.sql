-- =====================================================================================================
-- v1.60.3 — Suppression contrôlée d'une date (demande d'Anthony du 07/11/2026).
-- « Une date rouverte ne doit pas devenir impossible à supprimer uniquement parce qu'elle possède un historique dans
--   result_closures » ; parcours contrôlé selon les dépendances, confirmation compréhensible, traçabilité, aucun effacement de
--   facture Pennylane, aucune erreur technique de clé étrangère, pas de suppression en cascade aveugle.
--
-- Avant : la date était effacée directement (DELETE sur shows) ; la clé result_closures → shows (RESTRICT) faisait échouer la
-- suppression d'une date rouverte avec une erreur technique, de même que la clé tasks → shows (production : NO ACTION) pour une
-- date qui a des tâches, alors que la question de l'application annonce « Les tâches liées restent ».
--
-- Ce que fait cette migration (aucune donnée existante modifiée, aucune contrainte ni protection changée) :
--  1. show_deletions : JOURNAL DES SUPPRESSIONS DE DATES — une ligne par date supprimée : qui, quand, libellé, et une copie
--     complète (date, lignes de facturation, lignes de budget, historique de clôture / réouverture du résultat, tâches
--     détachées). Lecture par l'équipe, aucune écriture possible hors de la fonction delete_show (ni modification ni
--     effacement). Choix d'une table dédiée plutôt que finance_log : finance_log enregistre champ par champ (texte), il ne
--     peut pas garder les lignes de result_closures entières (motifs, synthèses, auteurs, horodatages) ; il continue d'enregistrer,
--     par ses déclencheurs, la suppression de la date et de ses lignes de facturation.
--  2. show_deletion_state(date) : ce que la suppression ferait (refus motivés en français, nombres de lignes supprimées / gardées).
--  3. delete_show(date) : seul chemin de suppression d'une date depuis l'application. Réservé à l'équipe, une transaction :
--       - REFUS (message français, rien n'est touché) si : résultat clôturé ; ligne hors calcul ; facture émise (numéro, envoi,
--         paiement, identifiant Pennylane) ou versement de commission ; lien vers un document Pennylane (devis de la date, lien
--         d'une ligne) ; facture Pennylane connue de la synchronisation (à rattacher, rattachée ou annulée) ; historique de
--         rattachement Pennylane ; pièce à rattacher ;
--       - sinon : copie complète dans show_deletions, tâches liées DÉTACHÉES (gardées, sans lien vers la date — règle annoncée
--         dans l'application : « Les tâches liées restent »), historique result_closures de la date retiré de la table APRÈS sa
--         copie intégrale dans show_deletions (rien n'est perdu), puis suppression de la date avec ses lignes de facturation
--         (aucune émise) et de budget. Les protections existantes (show_payments_emitted_guard, show_payments_hors_calcul_guard,
--         result_lock_*, show_payments_commission_lock) restent actives pendant l'opération : elles ne sont ni contournées ni
--         désactivées.
--     Rien n'est jamais supprimé dans Pennylane ni dans Google Drive.
--  4. ARCHIVAGE (réponse d'Anthony du 07/11 : « un devis Pennylane ne doit pas rendre une date impossible à retirer à vie ») :
--     shows.archived_at / archived_by / archived_reason / archive_history ; archive_show(date, motif) et restore_show(date),
--     seuls chemins d'écriture (déclencheur shows_archive_guard). Une date archivée sort des listes, totaux, comptes, relances
--     (generate_reminders ci-dessous), cartes et calendriers ; elle reste en base, consultable (« Dates archivées ») et
--     restaurable. Ce n'est PAS une annulation : son statut ne change pas ; aucun appel ni document Pennylane touché.
--     Refusé si : résultat clôturé, facture émise ou versement, facture Pennylane à rattacher, pièce à rattacher.
--     Archivage OPÉRATIONNEL seulement (réponse d'Anthony du 07/11, au soir) : la date sort des listes de TRAVAIL, mais ses
--     factures, créances, dettes, paiements et engagements réels restent dans les vues et exports financiers (aucun total
--     financier ne change) ; distinct d'une annulation (statut) et d'une suppression (delete_show).
--     Fiche publique (fiche_get, fiche_submit) : « Dossier indisponible » pour une date archivée, données conservées ;
--     la restauration rétablit l'accès. Notifications non retirées de la date : marquées « retirées » à l'archivage
--     (notifications.withdrawn_at, historique conservé, rien n'est supprimé). Restauration (décision d'Anthony du 07/11) :
--     échéances d'origine intactes, AUCUNE relance reprise automatiquement — les relances de la date restent suspendues
--     (shows.reminders_suspended_at) jusqu'à « Réactiver les relances » (reactivate_reminders), où l'utilisateur choisit la
--     prochaine échéance de chaque relance (shows.reminders_next ; jamais avant l'échéance d'origine) ; tracé dans archive_history.
--     Facture (ou facture Pennylane à rattacher) arrivée sur une date archivée : rattachement conservé + notification
--     d'alerte (déclencheurs ci-dessous, sans toucher à la fonction pennylane).
--  5. Tâches détachées par une suppression : une mention « Date supprimée le … : <date · lieu · artiste> » est ajoutée en tête
--     de leur note (pas de tâche orpheline inexpliquée).
-- Même règle côté application : js/calc.js (showRemovalState, changeBlocked), js/forms.js (showDeleteAsk), js/data.js
-- (deleteShow, archiveShow, restoreShow), js/state.js (dates archivées gardées hors des listes).
-- Rejouable (if not exists / create or replace).
-- Retour arrière (après accord) : ne plus appeler delete_show (l'application revient alors à la suppression directe) ;
--   drop function public.delete_show(uuid), public.show_deletion_state(uuid), public.archive_show(uuid, text),
--   public.restore_show(uuid) ; drop trigger shows_archive_guard on public.shows ; drop function public.shows_archive_guard() ;
--   recréer generate_reminders (v1.49), fiche_get (v1.60.2) et fiche_submit (v1.11) ; drop trigger show_payments_archived_alert,
--   pennylane_archived_alert ; la table show_deletions et les colonnes ajoutées restent (historique).
-- =====================================================================================================

-- ─────────────── 0. Garde (avant toute écriture) : generate_reminders doit être la v1.49 (voir §5 en fin de fichier) ───────────────
do $m$
declare b text := (select prosrc from pg_proc where oid = 'public.generate_reminders()'::regprocedure);
begin
  if md5(b) <> '1e39731b4ae42784cad558380e0ec253' and position('archived_at' in b) = 0 then
    raise exception 'v1.60.3 : generate_reminders n''est pas la version v1.49 attendue (empreinte du corps %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
  -- fiche publique : fiche_get après la migration v1.60.2 lieux (texte de production v1.59 → empreinte 5ad948…, puis remplacement
  -- v1.60.2 → b5faee87…), fiche_submit de la v1.11 (6009c041…) ; déjà remplacées par cette migration (marqueur) : acceptées
  b := pg_get_functiondef('public.fiche_get(text)'::regprocedure);
  if md5(b) <> 'b5faee87a1cc0c83b29f3e11394fc6d9' and position('v1.60.3 date archivée' in b) = 0 then
    raise exception 'v1.60.3 : fiche_get n''est pas la version attendue après la v1.60.2 (empreinte %) : appliquer d''abord 2026-11-07_v1.60.2_lieux.sql ; migration arrêtée, rien n''est appliqué', md5(b);
  end if;
  b := pg_get_functiondef('public.fiche_submit(text,jsonb,jsonb)'::regprocedure);
  if md5(b) <> '6009c041ca749a37b19d439718431266' and position('v1.60.3 date archivée' in b) = 0 then
    raise exception 'v1.60.3 : fiche_submit n''est pas la version attendue (empreinte %) : migration arrêtée, rien n''est appliqué', md5(b);
  end if;
end $m$;

-- ─────────────── 1. Journal des suppressions de dates ───────────────
create table if not exists public.show_deletions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  show_id uuid not null,            -- identifiant de la date supprimée (pas de clé : la date n'existe plus)
  label text,                       -- « date · lieu · artiste » au moment de la suppression
  snapshot jsonb not null           -- show, payments, budget_lines, result_closures, tasks_detached
);
create index if not exists show_deletions_show on public.show_deletions (show_id);
comment on table public.show_deletions is 'Journal des suppressions de dates (v1.60.3) : copie complète de la date et de ses lignes, historique de clôture / réouverture du résultat compris ; écrit seulement par delete_show, jamais modifié ni effacé';
alter table public.show_deletions enable row level security;
drop policy if exists show_deletions_team_read on public.show_deletions;
create policy show_deletions_team_read on public.show_deletions for select to authenticated using (public.is_team());
revoke all on public.show_deletions from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.show_deletions from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.show_deletions from service_role;   -- la sauvegarde ne fait que lire
grant select on public.show_deletions to authenticated, service_role;
grant select on public.result_closures to service_role;   -- sauvegarde JSON (backup-export) : lecture seule, réponse d'Anthony du 07/11
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'show_deletions') then
    alter publication supabase_realtime add table public.show_deletions;
  end if;
end $$;

-- ─────────────── 1 bis. Archivage d'une date (colonnes ajoutées vides : aucune date existante archivée) ───────────────
alter table public.shows add column if not exists archived_at timestamptz;
alter table public.shows add column if not exists archived_by text;
alter table public.shows add column if not exists archived_reason text;
alter table public.shows add column if not exists archive_history jsonb not null default '[]'::jsonb;
alter table public.shows add column if not exists restored_at timestamptz;   -- dernière restauration
-- relances après une restauration : suspendues jusqu'à une réactivation explicite, avec les prochaines échéances choisies
alter table public.shows add column if not exists reminders_suspended_at timestamptz;
alter table public.shows add column if not exists reminders_reactivated_at timestamptz;
alter table public.shows add column if not exists reminders_next jsonb;   -- {relance: 'AAAA-MM-JJ'} (clés de generate_reminders)
comment on column public.shows.reminders_next is 'Prochaine échéance choisie à la réactivation des relances (v1.60.3) : {relance: date} ; la relance ne part ni avant cette date ni avant son échéance d''origine';
alter table public.notifications add column if not exists withdrawn_at timestamptz;   -- notification retirée de la liste active (gardée)
alter table public.notifications add column if not exists withdrawn_reason text;
comment on column public.notifications.withdrawn_at is 'Notification retirée de la liste active (v1.60.3 : date archivée / restaurée) ; gardée pour l''historique, jamais supprimée';
comment on column public.shows.archived_at is 'Date archivée (v1.60.3) : hors des listes, totaux, comptes, relances, cartes et calendriers ; restaurable. Distinct d''une annulation (statut inchangé).';
comment on column public.shows.archive_history is 'Historique des archivages / restaurations (qui, quand, motif) ; écrit seulement par archive_show / restore_show';

create or replace function public.shows_archive_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('matrice.archive_rpc', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.archived_at is not null or new.archived_by is not null or new.archived_reason is not null or new.restored_at is not null
       or new.reminders_suspended_at is not null or new.reminders_reactivated_at is not null or new.reminders_next is not null
       or coalesce(new.archive_history, '[]'::jsonb) <> '[]'::jsonb then
      raise exception 'Une date ne se crée pas archivée.' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by
     or new.archived_reason is distinct from old.archived_reason or new.archive_history is distinct from old.archive_history
     or new.restored_at is distinct from old.restored_at or new.reminders_suspended_at is distinct from old.reminders_suspended_at
     or new.reminders_reactivated_at is distinct from old.reminders_reactivated_at or new.reminders_next is distinct from old.reminders_next then
    raise exception 'Archivage et restauration d’une date : utiliser les boutons « Archiver la date » / « Restaurer ».' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.shows_archive_guard() from public, anon, authenticated;
drop trigger if exists shows_archive_guard on public.shows;
create trigger shows_archive_guard before insert or update on public.shows for each row execute function public.shows_archive_guard();

-- ─────────────── 2. État de la suppression d'une date (refus motivés + ce qui part / ce qui reste) ───────────────
-- Mêmes refus que l'application (js/calc.js changeBlocked, table shows, suppression) ; mêmes définitions que
-- show_payments_emitted_guard (définition complète d'une facture émise, comme lors d'une suppression en chaîne) et
-- show_has_financial_record (versements de commission).
create or replace function public.show_deletion_state(p_show uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s shows%rowtype; why text[] := '{}'; arch text[] := '{}'; n int;
begin
  if not public.is_team() then raise exception 'Accès refusé' using errcode = 'P0001'; end if;
  select * into s from shows where id = p_show;
  if not found then raise exception 'Date introuvable : elle a peut-être déjà été supprimée.' using errcode = 'P0001'; end if;

  if s.result_closed_at is not null then
    why := array_append(why, 'Le résultat de cette date est clôturé : rouvre-le d’abord (bouton « Rouvrir », avec un motif), puis supprime la date.');
    arch := array_append(arch, 'Le résultat de cette date est clôturé : rouvre-le d’abord (bouton « Rouvrir », avec un motif).'); end if;
  if s.archived_at is not null then arch := array_append(arch, 'Cette date est déjà archivée.'); end if;
  if exists (select 1 from show_payments p where p.show_id = p_show and p.hors_calcul is not null) then
    why := array_append(why, 'Cette date garde des lignes hors calcul (traçabilité) : elle ne se supprime pas.'); end if;
  if exists (select 1 from show_payments p where p.show_id = p_show and p.hors_calcul is null
               and (p.sent_at is not null or p.paid_at is not null
                    or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null
                    or exists (select 1 from commission_transfers t where t.payment_id = p.id))) then
    why := array_append(why, 'Cette date a des factures émises : elle ne se supprime pas (ses factures et son budget seraient effacés avec elle).');
    arch := array_append(arch, 'Cette date a des factures émises ou des versements : elle reste dans les listes, les comptes et les relances (pas d’archivage).'); end if;
  if nullif(btrim(s.pennylane_quote_id), '') is not null or nullif(btrim(s.pennylane_quote_url), '') is not null
     or exists (select 1 from show_payments p where p.show_id = p_show and nullif(btrim(p.pennylane_url), '') is not null) then
    why := array_append(why, 'Cette date est liée à un document Pennylane (devis ou facture) : elle ne se supprime pas (rien n’est jamais supprimé dans Pennylane, le document resterait sans sa date).'); end if;
  select count(*) into n from pennylane_a_rattacher r where r.show_id = p_show;
  if n > 0 then
    why := array_append(why, format('Cette date a %s facture%s Pennylane connue%s de la synchronisation (à rattacher, rattachée ou annulée) : elle ne se supprime pas.',
                         n, case when n > 1 then 's' else '' end, case when n > 1 then 's' else '' end)); end if;
  if exists (select 1 from pennylane_a_rattacher r where r.show_id = p_show and r.resolved_at is null and r.cancelled_at is null) then
    arch := array_append(arch, 'Cette date a une facture Pennylane à rattacher : rattache-la d’abord (onglet Factures).'); end if;
  if exists (select 1 from pennylane_rattachements r where r.show_id = p_show) then
    why := array_append(why, 'Cette date a un historique de rattachement de factures Pennylane : elle ne se supprime pas (traçabilité).'); end if;
  -- pièces gardées « à rattacher » (décision d'Anthony du 25/10) : déposées dans budget/<date>/ et reprises par aucune ligne
  select count(*) into n from attachments a
   where a.path like 'budget/' || p_show::text || '/%'
     and not exists (select 1 from show_payments p where p.file_path = a.path)
     and not exists (select 1 from budget_lines l where l.file_path = a.path);
  if n > 0 then
    why := array_append(why, format('Cette date a %s pièce%s à rattacher (onglet Factures) : rattache-%s avant de supprimer la date.',
                         n, case when n > 1 then 's' else '' end, case when n > 1 then 'les' else 'la' end));
    arch := array_append(arch, format('Cette date a %s pièce%s à rattacher (onglet Factures) : rattache-%s d’abord.',
                         n, case when n > 1 then 's' else '' end, case when n > 1 then 'les' else 'la' end)); end if;

  return jsonb_build_object(
    'blocked', to_jsonb(why),
    'archive_blocked', to_jsonb(arch),          -- vide = la date peut être archivée (archive_show)
    'payments', (select count(*) from show_payments where show_id = p_show),
    'budget_lines', (select count(*) from budget_lines where show_id = p_show),
    'tasks', (select count(*) from tasks where show_id = p_show),
    'closures', (select count(*) from result_closures where show_id = p_show));
end $$;
revoke all on function public.show_deletion_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.show_deletion_state(uuid) to authenticated;

-- ─────────────── 3. Suppression contrôlée ───────────────
create or replace function public.delete_show(p_show uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s shows%rowtype; st jsonb; who text := coalesce(auth.jwt() ->> 'email', ''); snap jsonb; lbl text; tids uuid[];
begin
  if not public.is_team() then raise exception 'Accès refusé' using errcode = 'P0001'; end if;
  select * into s from shows where id = p_show for update;   -- verrou : la date ne change pas pendant les contrôles
  if not found then raise exception 'Date introuvable : elle a peut-être déjà été supprimée.' using errcode = 'P0001'; end if;
  st := public.show_deletion_state(p_show);
  if jsonb_array_length(st -> 'blocked') > 0 then
    raise exception '%', (select string_agg(x, ' ') from jsonb_array_elements_text(st -> 'blocked') x) using errcode = 'P0001';
  end if;

  lbl := concat_ws(' · ', coalesce(to_char(s.date, 'DD/MM/YYYY'), 'sans date'), s.venue, (select name from projects where id = s.project_id));
  select array_agg(id order by id) into tids from tasks where show_id = p_show;
  snap := jsonb_build_object(
    'show', to_jsonb(s),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from show_payments p where p.show_id = p_show), '[]'::jsonb),
    'budget_lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from budget_lines l where l.show_id = p_show), '[]'::jsonb),
    'result_closures', coalesce((select jsonb_agg(to_jsonb(c) order by c.at, c.id) from result_closures c where c.show_id = p_show), '[]'::jsonb),
    'tasks_detached', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status) order by t.id)
                                  from tasks t where t.show_id = p_show), '[]'::jsonb));
  insert into show_deletions (actor, show_id, label, snapshot) values (who, p_show, lbl, snap);

  -- tâches : gardées, détachées de la date (règle annoncée dans l'application), avec une mention visible en tête de leur note
  update tasks set show_id = null,
         notes = concat_ws(E'\n', 'Date supprimée le ' || to_char(now() at time zone 'Europe/Paris', 'DD/MM/YYYY') || ' : ' || lbl, nullif(notes, ''))
   where show_id = p_show;
  -- historique de clôture / réouverture : copié intégralement ci-dessus, puis retiré (clé RESTRICT vers la date)
  delete from result_closures where show_id = p_show;
  -- la date, avec ses lignes de facturation (aucune émise : contrôlé ci-dessus ET par show_payments_emitted_guard) et de budget
  delete from shows where id = p_show;

  return jsonb_build_object('payments', st -> 'payments', 'budget_lines', st -> 'budget_lines',
                            'tasks', coalesce(array_length(tids, 1), 0), 'task_ids', to_jsonb(coalesce(tids, '{}')), 'closures', st -> 'closures');
end $$;
revoke all on function public.delete_show(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_show(uuid) to authenticated;

-- ─────────────── 4. Archivage / restauration d'une date ───────────────
create or replace function public.archive_show(p_show uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype; st jsonb; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.is_team() then raise exception 'Accès refusé' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indique le motif de l’archivage.' using errcode = 'P0001'; end if;
  select * into s from shows where id = p_show for update;
  if not found then raise exception 'Date introuvable : elle a peut-être déjà été supprimée.' using errcode = 'P0001'; end if;
  st := public.show_deletion_state(p_show);
  if jsonb_array_length(st -> 'archive_blocked') > 0 then
    raise exception '%', (select string_agg(x, ' ') from jsonb_array_elements_text(st -> 'archive_blocked') x) using errcode = 'P0001';
  end if;
  perform set_config('matrice.archive_rpc', 'on', true);
  update shows set archived_at = now(), archived_by = who, archived_reason = btrim(p_reason),
         archive_history = coalesce(archive_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('action', 'archive', 'at', now(), 'by', who, 'reason', btrim(p_reason)))
   where id = p_show;
  perform set_config('matrice.archive_rpc', '', true);
  -- relances et rappels de la date : retirés de la liste active (marqués, historique conservé, rien n'est supprimé)
  update notifications set withdrawn_at = now(), withdrawn_reason = 'Date archivée' where show_id = p_show and withdrawn_at is null;
end $$;
revoke all on function public.archive_show(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.archive_show(uuid, text) to authenticated;

create or replace function public.restore_show(p_show uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.is_team() then raise exception 'Accès refusé' using errcode = 'P0001'; end if;
  select * into s from shows where id = p_show for update;
  if not found then raise exception 'Date introuvable : elle a peut-être déjà été supprimée.' using errcode = 'P0001'; end if;
  if s.archived_at is null then raise exception 'Cette date n’est pas archivée.' using errcode = 'P0001'; end if;
  perform set_config('matrice.archive_rpc', 'on', true);
  -- échéances d'origine intactes ; relances suspendues jusqu'à « Réactiver les relances » (décision d'Anthony du 07/11)
  update shows set archived_at = null, archived_by = null, archived_reason = null, restored_at = now(),
         reminders_suspended_at = now(), reminders_reactivated_at = null, reminders_next = null,
         archive_history = coalesce(archive_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('action', 'restore', 'at', now(), 'by', who))
   where id = p_show;
  perform set_config('matrice.archive_rpc', '', true);
  -- alertes « facture sur une date archivée » : traitées par la restauration (gardées, retirées de la liste active)
  update notifications set withdrawn_at = now(), withdrawn_reason = 'Date restaurée'
   where show_id = p_show and kind = 'date_archivee_facture' and withdrawn_at is null;
end $$;
revoke all on function public.restore_show(uuid) from public, anon, authenticated, service_role;
grant execute on function public.restore_show(uuid) to authenticated;

-- Réactivation explicite des relances d'une date restaurée : p_next = {relance: 'AAAA-MM-JJ'} (clés de generate_reminders, une
-- date à partir d'aujourd'hui par relance) ; tracée dans archive_history. Les relances reprennent avec des clés anti-doublon
-- propres (celles d'avant l'archivage ont été retirées) ; aucune ne part avant l'échéance choisie ni avant son échéance d'origine.
create or replace function public.reactivate_reminders(p_show uuid, p_next jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype; who text := coalesce(auth.jwt() ->> 'email', ''); k text; v text; jour date := (now() at time zone 'Europe/Paris')::date;
begin
  if not public.is_team() then raise exception 'Accès refusé' using errcode = 'P0001'; end if;
  select * into s from shows where id = p_show for update;
  if not found then raise exception 'Date introuvable : elle a peut-être déjà été supprimée.' using errcode = 'P0001'; end if;
  if s.archived_at is not null then raise exception 'Cette date est archivée : restaure-la d’abord.' using errcode = 'P0001'; end if;
  if s.reminders_suspended_at is null then raise exception 'Les relances de cette date ne sont pas suspendues.' using errcode = 'P0001'; end if;
  p_next := coalesce(p_next, '{}'::jsonb);
  if jsonb_typeof(p_next) <> 'object' then raise exception 'Prochaines échéances illisibles.' using errcode = 'P0001'; end if;
  for k, v in select key, value from jsonb_each_text(p_next) loop
    if k !~ '^[a-z_]+$' or v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Prochaine échéance illisible (%).', k using errcode = 'P0001'; end if;
    if v::date < jour then raise exception 'Choisis une prochaine échéance à partir d’aujourd’hui.' using errcode = 'P0001'; end if;
  end loop;
  perform set_config('matrice.archive_rpc', 'on', true);
  update shows set reminders_suspended_at = null, reminders_reactivated_at = now(), reminders_next = p_next,
         archive_history = coalesce(archive_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('action', 'reactivate_reminders', 'at', now(), 'by', who, 'next', p_next))
   where id = p_show;
  perform set_config('matrice.archive_rpc', '', true);
end $$;
revoke all on function public.reactivate_reminders(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.reactivate_reminders(uuid, jsonb) to authenticated;

-- ─────────────── 5. Rappels : aucune date archivée (generate_reminders RÉÉCRITE ENTIÈREMENT, §7.5) ───────────────
-- Texte de la v1.49 (migration 2026-10-27_v1.49_dates_formats.sql) + une seule condition (sh.archived_at is null).
-- Garde en tête du fichier (§0) : corps en base ni v1.49 (empreinte 1e39731b4ae42784cad558380e0ec253) ni cette version → arrêt.
create or replace function public.generate_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  with s as (
    select sh.id, sh.date, sh.venue, sh.city, coalesce(sh.prod_mode,'production') mode, coalesce(pr.name,'') proj,
      -- rappels administratifs (étapes, boucles, factures à faire, partenaire) : dates passées de plus de 120 jours exclues ;
      -- factures (à envoyer, impayées) et commission à virer : sans limite de durée (Q13, décision du 27/10)
      (sh.date is null or sh.date >= current_date - 120) recent,
      sh.reminders_next nxt, to_char(sh.reminders_reactivated_at, 'YYYYMMDDHH24MISS') reactiv,   -- v1.60.3 : relances réactivées
      sh.conf_kit_sent, sh.precontract_done, sh.contract_sent, sh.contract_signed, sh.contract_cosigned_sent, sh.boucle_tech, sh.boucle_com,
      a.id a_id,
      (a.sent_at is not null or a.paid_at is not null or nullif(btrim(a.invoice_number), '') is not null or nullif(btrim(a.pennylane_id), '') is not null) a_emis,
      so.id so_id,
      (so.sent_at is not null or so.paid_at is not null or nullif(btrim(so.invoice_number), '') is not null or nullif(btrim(so.pennylane_id), '') is not null) so_emis,
      c.id c_id, c.label c_label,
      (c.sent_at is not null or c.paid_at is not null or nullif(btrim(c.invoice_number), '') is not null or nullif(btrim(c.pennylane_id), '') is not null) c_emis,
      case when c.id is null then null when c.paid_at is not null and public.commission_transferred(c.id) = 0 then 0
           else greatest(public.commission_total(c) - public.commission_transferred(c.id), 0) end c_reste,
      pt.id pt_id, pt.sent_at pt_sent, pt.paid_at pt_paid, pt.label pt_label,
      -- premier encaissement, même partiel, toutes lignes acompte / solde confondues (Q14)
      (select min(x.paid_at) from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind in ('acompte', 'solde')) cashed
    from shows sh
    left join projects pr on pr.id = sh.project_id
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'acompte' order by sort limit 1) a on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'solde' order by sort limit 1) so on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'artbo' order by sort limit 1) c on true
    left join lateral (select * from show_payments x where x.show_id = sh.id and x.hors_calcul is null and x.kind = 'partner' order by sort limit 1) pt on true
    where sh.status in ('Confirmée Salle','Confirmée Festival')
      and sh.archived_at is null   -- v1.60.3 : une date archivée ne produit aucun rappel (comme dans js/reminders.js)
      and sh.reminders_suspended_at is null   -- v1.60.3 : date restaurée, relances pas encore réactivées
  ), f as (
    -- factures suivies : production = acomptes, soldes, autres lignes ; booking = facture de commission (jamais acompte / solde)
    select x.id, x.show_id, x.kind, x.sent_at, x.paid_at, x.reminded_at, x.reminders_paused,
      concat_ws(' ', nullif(x.label, ''), '(' || nullif(btrim(x.invoice_number), '') || ')') nom,
      (nullif(btrim(x.invoice_number), '') is not null or nullif(btrim(x.pennylane_id), '') is not null) faite,
      coalesce(x.invoiced_on, (x.created_at at time zone 'Europe/Paris')::date) faite_le,
      row_number() over (partition by x.show_id, x.kind order by x.sort, x.id) rn
    from show_payments x join s on s.id = x.show_id
    where x.hors_calcul is null and ((s.mode <> 'booking' and x.kind in ('acompte', 'solde', 'autre')) or (s.mode = 'booking' and x.kind = 'artbo'))
  ), cand as (
    -- k : clé anti-doublon (règle:date:échéance, comme avant pour la première ligne de chaque sorte) ; raw : échéance brute ;
    -- w : échéance « J+n » décalée au lundi si elle tombe le week-end
    select 'precontrat' r, id, id::text k, conf_kit_sent + 10 raw, true w, 'Pré-contrat à compléter' t from s where mode <> 'booking' and conf_kit_sent is not null and precontract_done is null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_envoi', id, id::text, precontract_done + 10, true, 'Contrat à envoyer' from s where mode <> 'booking' and precontract_done is not null and contract_sent is null and (date is null or date >= current_date)
    union all select 'contrat_signe', id, id::text, contract_sent + 10, true, 'Contrat signé à récupérer' from s where mode <> 'booking' and contract_sent is not null and contract_signed is null and (date is null or date >= current_date)
    union all select 'contrat_cosigne', id, id::text, contract_signed + 10, true, 'Contrat co-signé à renvoyer' from s where mode <> 'booking' and contract_signed is not null and contract_cosigned_sent is null and (date is null or date >= current_date)
    union all select 'facture_acompte', id, id::text, contract_sent, false, 'Facture d’acompte à faire (contrat envoyé)' from s where mode <> 'booking' and recent and contract_sent is not null and a_id is not null and not a_emis and not coalesce(so_emis, false)
    union all select 'solde_envoi', id, id::text, (date - 7) - (case extract(isodow from date - 7) when 6 then 1 when 7 then 2 else 0 end)::int, false,
                     'Facture de solde à faire' from s where mode <> 'booking' and date is not null and so_id is not null and not so_emis and date >= current_date - 30
    union all select 'booking_commission', id, id::text, contract_cosigned_sent, false, 'Facture de commission à faire (contrat co-signé)' from s where mode = 'booking' and recent and contract_cosigned_sent is not null and c_id is not null and not c_emis
    -- facture faite, pas de date d'envoi : 3 jours après, jusqu'à la saisie de la date d'envoi (une clé par facture)
    union all select 'facture_envoi', show_id, show_id || ':' || id, faite_le + 3, true, 'Facture à envoyer : ' || nom from f where faite and sent_at is null and paid_at is null
    -- facture envoyée impayée : 10 jours après l'envoi ou la dernière relance, sans limite de durée, sauf relances suspendues
    union all select case kind when 'acompte' then 'acompte_paye' when 'solde' then 'solde_paye' when 'artbo' then 'booking_commission_payee' else 'autre_payee' end,
                     show_id, case when rn = 1 and kind <> 'autre' then show_id::text else show_id || ':' || id end, greatest(sent_at, reminded_at) + 10, true,
                     'Paiement à vérifier : ' || nom || case when reminded_at is not null then ' (toujours impayée après relance)' else '' end
                from f where sent_at is not null and paid_at is null and not reminders_paused
    union all select 'commission', id, id::text, cashed + 10, true, coalesce(c_label,'Commission L’ArtBo') || ' : ' || replace(to_char(c_reste, 'FM999999990.00'), '.', ',') || ' € à te verser'
                     from s where mode <> 'booking' and cashed is not null and c_id is not null and c_reste > 0.004
    union all select 'commission_partenaire', id, id::text, cashed + 10, true, 'Facture ' || coalesce(nullif(pt_label, ''),'Commission partenaire') || ' à ' || case when pt_sent is null then 'envoyer' else 'faire payer' end
                     from s where mode <> 'booking' and recent and cashed is not null and pt_id is not null and (pt_sent is null or pt_paid is null)
    union all select 'boucle_accueil', id, id::text, (date - interval '4 months')::date, false, 'Boucle accueil & technique à envoyer (J-4 mois)' from s where mode <> 'booking' and date is not null and boucle_tech is null and (date is null or date >= current_date)
    union all select 'boucle_com', id, id::text, contract_cosigned_sent, false, 'Boucle communication à envoyer' from s where mode <> 'booking' and contract_cosigned_sent is not null and boucle_com is null and (date is null or date >= current_date)
  ), ins as (
    insert into notifications (kind, title, body, show_id, dedupe_key)
    select c.r, c.t || ' — ' || s.venue,
           concat_ws(' · ', nullif(s.proj,''), to_char(s.date, 'DD/MM/YYYY'), s.city),
           s.id, c.r || ':' || c.k || ':' || c.raw || coalesce(':a' || s.reactiv, '')   -- v1.60.3 : clés propres après réactivation
    from cand c join s on s.id = c.id
    -- échéance : J+n décalée au lundi (w) ; boucle accueil & technique (4 mois calendaires) : samedi / dimanche → vendredi précédent
    -- (Q12, v1.49 — même règle que js/reminders.js workDayBefore) ; la clé anti-doublon garde la date brute (aucune notification en double)
    -- v1.60.3 : relances réactivées après une restauration — la relance ne part qu'à la prochaine échéance choisie pour elle
    -- (reminders_next), jamais avant son échéance d'origine (greatest)
    where c.raw is not null and greatest(case when c.w then public.workday(c.raw)
                                      when c.r = 'boucle_accueil' then c.raw - (case extract(isodow from c.raw) when 6 then 1 when 7 then 2 else 0 end)::int
                                      else c.raw end, (s.nxt ->> c.r)::date) <= current_date
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end $function$;
revoke all on function public.generate_reminders() from public, anon, authenticated, service_role;
grant execute on function public.generate_reminders() to service_role;

-- ─────────────── 6. Fiche publique : « Dossier indisponible » pour une date archivée (fonctions RÉÉCRITES ENTIÈREMENT, §7.5) ───────────────
-- fiche_get : texte attendu après la v1.60.2 (lieux) + une condition ; fiche_submit : texte v1.11 + une condition. Gardes en tête (§0).
-- Droits inchangés (create or replace les conserve).
CREATE OR REPLACE FUNCTION public.fiche_get(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; pays jsonb; vat numeric; acpt numeric;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then return null; end if;
  -- v1.60.3 date archivée : accès fermé (message neutre), données conservées ; la restauration rétablit l'accès
  if s.archived_at is not null then raise exception 'Dossier indisponible' using errcode = 'P0001'; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  vat := coalesce(s.vat_rate, 5.5);
  select coalesce(jsonb_agg(jsonb_build_object('label', p.label, 'kind', p.kind, 'pct', p.pct, 'due_label', p.due_label,
           'ht', coalesce(p.amount, round(s.fee_ht * p.pct) / 100)) order by p.sort), '[]')
    into pays from show_payments p where p.show_id = s.id and p.kind in ('acompte','solde') and p.hors_calcul is null;
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' and hors_calcul is null order by sort limit 1;
  return jsonb_build_object(
    'artist', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', s.date, 'date_end', s.date_end, 'date_label', fr_date(s.date, true),
    'venue', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'city', s.city, 'address', s.address, 'postal_code', s.postal_code, 'department', s.department,
    'venue_is_structure', coalesce(s.venue_is_structure, false),   -- v1.60.2 source du lieu (décisions d'Anthony du 07/11/2026)
    'cp', coalesce(public.lieu_departement(s.department, s.postal_code), case when s.venue_is_structure then public.lieu_departement(st.department_code, st.postal_code) end),
    'status', s.status, 'contract_type', s.contract_type, 'prod_mode', coalesce(s.prod_mode, 'production'),
    'fee_ht', s.fee_ht, 'vat', vat, 'fee_ttc', round(s.fee_ht * (1 + vat / 100), 2),
    'acompte_pct', coalesce(acpt, case when s.terms_validated_at is not null or s.contract_type = 'Co-Production' then 0 end, public.default_acompte_for(s.project_id)),
    'cr_producer_pct', s.cr_producer_pct, 'cr_break', s.cr_break, 'show_time', s.show_time, 'set_length', s.set_length,
    'capacity', coalesce(s.capacity, st.capacity_1), 'ticketing_type', s.ticketing_type,
    'payments', pays,
    'structure', case when st.id is null then null else jsonb_build_object('name', st.name, 'address', st.address,
        'postal_code', st.postal_code, 'city', st.city, 'country', st.country, 'admin', coalesce(st.admin, '{}')) end,
    'fiche', s.fiche, 'submitted_at', s.fiche_submitted_at, 'validated_at', s.fiche_validated_at,
    'locked', s.contract_sent is not null);
end $function$;
CREATE OR REPLACE FUNCTION public.fiche_submit(p_token text, p_admin jsonb, p_fiche jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s shows%rowtype;
begin
  if p_token is null or length(p_token) < 16 then raise exception 'Lien invalide'; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then raise exception 'Lien invalide'; end if;
  -- v1.60.3 date archivée : accès fermé (message neutre), données conservées ; la restauration rétablit l'accès
  if s.archived_at is not null then raise exception 'Dossier indisponible' using errcode = 'P0001'; end if;
  if s.contract_sent is not null then raise exception 'Le contrat a déjà été envoyé : la fiche ne peut plus être modifiée. Écris-nous à production@lartboristerie.com.'; end if;
  if length(coalesce(p_admin::text,'')) + length(coalesce(p_fiche::text,'')) > 30000 then raise exception 'Fiche trop longue'; end if;
  update shows set fiche = coalesce(p_fiche, '{}') || jsonb_build_object('admin', coalesce(p_admin, '{}')),
                   fiche_submitted_at = now(), fiche_validated_at = null
    where id = s.id;
  insert into notifications (kind, title, body, show_id, project_id, dedupe_key)
    values ('fiche', 'Fiche de renseignements à valider — ' || coalesce(s.venue, ''),
            concat_ws(' · ', to_char(s.date, 'DD/MM/YYYY'), s.city, p_admin->>'legal_name'),
            s.id, s.project_id, 'fiche:' || s.id || ':' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  return jsonb_build_object('ok', true);
end $function$;

-- ─────────────── 7. Alerte : facture arrivée sur une date archivée (rattachement conservé, alerte visible) ───────────────
-- La synchronisation Pennylane (fonction pennylane, inchangée) relie normalement la facture à sa ligne ; ce déclencheur ajoute une
-- notification (liste des notifications de l'application et récap quotidien par mail) tant que la date reste archivée.
create or replace function public.archived_invoice_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype; emis boolean; avant boolean := false; cle text; quoi text;
begin
  select * into s from shows where id = new.show_id;
  if not found or s.archived_at is null then return null; end if;
  if tg_table_name = 'show_payments' then
    emis := new.sent_at is not null or new.paid_at is not null or nullif(btrim(new.invoice_number), '') is not null or nullif(btrim(new.pennylane_id), '') is not null;
    if tg_op = 'UPDATE' then
      avant := old.sent_at is not null or old.paid_at is not null or nullif(btrim(old.invoice_number), '') is not null or nullif(btrim(old.pennylane_id), '') is not null;
    end if;
    if not emis or avant then return null; end if;
    cle := 'date_archivee_facture:' || new.id; quoi := coalesce(nullif(btrim(new.invoice_number), ''), new.label);
  else
    cle := 'date_archivee_facture:pl:' || new.pennylane_id; quoi := coalesce(new.invoice_number, 'facture à rattacher');
  end if;
  insert into notifications (kind, title, body, show_id, project_id, dedupe_key)
  values ('date_archivee_facture', 'Facture sur une date archivée — ' || coalesce(s.venue, ''),
          concat_ws(' · ', (select name from projects where id = s.project_id), to_char(s.date, 'DD/MM/YYYY'), quoi,
                    'comptée dans les montants ; restaure la date (Booking › Dates archivées) pour la suivre'),
          s.id, s.project_id, cle)
  on conflict (dedupe_key) do nothing;
  return null;
end $$;
revoke execute on function public.archived_invoice_alert() from public, anon, authenticated;
drop trigger if exists show_payments_archived_alert on public.show_payments;
create trigger show_payments_archived_alert after insert or update on public.show_payments for each row execute function public.archived_invoice_alert();
drop trigger if exists pennylane_archived_alert on public.pennylane_a_rattacher;
create trigger pennylane_archived_alert after insert on public.pennylane_a_rattacher for each row execute function public.archived_invoice_alert();
