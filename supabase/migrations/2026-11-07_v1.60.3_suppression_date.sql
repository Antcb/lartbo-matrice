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
-- Même règle côté application : js/calc.js (changeBlocked, deletion des dates), js/forms.js (showDeleteAsk, deleteShow).
-- Rejouable (if not exists / create or replace).
-- Retour arrière (après accord) : ne plus appeler delete_show (l'application revient alors à la suppression directe) ;
--   drop function public.delete_show(uuid), public.show_deletion_state(uuid) ; la table show_deletions reste (historique).
-- =====================================================================================================

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
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'show_deletions') then
    alter publication supabase_realtime add table public.show_deletions;
  end if;
end $$;

-- ─────────────── 2. État de la suppression d'une date (refus motivés + ce qui part / ce qui reste) ───────────────
-- Mêmes refus que l'application (js/calc.js changeBlocked, table shows, suppression) ; mêmes définitions que
-- show_payments_emitted_guard (définition complète d'une facture émise, comme lors d'une suppression en chaîne) et
-- show_has_financial_record (versements de commission).
create or replace function public.show_deletion_state(p_show uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s shows%rowtype; why text[] := '{}'; n int;
begin
  if not public.is_team() then raise exception 'Accès refusé' using errcode = 'P0001'; end if;
  select * into s from shows where id = p_show;
  if not found then raise exception 'Date introuvable : elle a peut-être déjà été supprimée.' using errcode = 'P0001'; end if;

  if s.result_closed_at is not null then
    why := array_append(why, 'Le résultat de cette date est clôturé : rouvre-le d’abord (bouton « Rouvrir », avec un motif), puis supprime la date.'); end if;
  if exists (select 1 from show_payments p where p.show_id = p_show and p.hors_calcul is not null) then
    why := array_append(why, 'Cette date garde des lignes hors calcul (traçabilité) : elle ne se supprime pas.'); end if;
  if exists (select 1 from show_payments p where p.show_id = p_show and p.hors_calcul is null
               and (p.sent_at is not null or p.paid_at is not null
                    or nullif(btrim(p.invoice_number), '') is not null or nullif(btrim(p.pennylane_id), '') is not null
                    or exists (select 1 from commission_transfers t where t.payment_id = p.id))) then
    why := array_append(why, 'Cette date a des factures émises : elle ne se supprime pas (ses factures et son budget seraient effacés avec elle).'); end if;
  if nullif(btrim(s.pennylane_quote_id), '') is not null or nullif(btrim(s.pennylane_quote_url), '') is not null
     or exists (select 1 from show_payments p where p.show_id = p_show and nullif(btrim(p.pennylane_url), '') is not null) then
    why := array_append(why, 'Cette date est liée à un document Pennylane (devis ou facture) : elle ne se supprime pas (rien n’est jamais supprimé dans Pennylane, le document resterait sans sa date).'); end if;
  select count(*) into n from pennylane_a_rattacher r where r.show_id = p_show;
  if n > 0 then
    why := array_append(why, format('Cette date a %s facture%s Pennylane connue%s de la synchronisation (à rattacher, rattachée ou annulée) : elle ne se supprime pas.',
                         n, case when n > 1 then 's' else '' end, case when n > 1 then 's' else '' end)); end if;
  if exists (select 1 from pennylane_rattachements r where r.show_id = p_show) then
    why := array_append(why, 'Cette date a un historique de rattachement de factures Pennylane : elle ne se supprime pas (traçabilité).'); end if;
  -- pièces gardées « à rattacher » (décision d'Anthony du 25/10) : déposées dans budget/<date>/ et reprises par aucune ligne
  select count(*) into n from attachments a
   where a.path like 'budget/' || p_show::text || '/%'
     and not exists (select 1 from show_payments p where p.file_path = a.path)
     and not exists (select 1 from budget_lines l where l.file_path = a.path);
  if n > 0 then
    why := array_append(why, format('Cette date a %s pièce%s à rattacher (onglet Factures) : rattache-%s avant de supprimer la date.',
                         n, case when n > 1 then 's' else '' end, case when n > 1 then 'les' else 'la' end)); end if;

  return jsonb_build_object(
    'blocked', to_jsonb(why),
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

  -- tâches : gardées, détachées de la date (règle annoncée dans l'application)
  update tasks set show_id = null where show_id = p_show;
  -- historique de clôture / réouverture : copié intégralement ci-dessus, puis retiré (clé RESTRICT vers la date)
  delete from result_closures where show_id = p_show;
  -- la date, avec ses lignes de facturation (aucune émise : contrôlé ci-dessus ET par show_payments_emitted_guard) et de budget
  delete from shows where id = p_show;

  return jsonb_build_object('payments', st -> 'payments', 'budget_lines', st -> 'budget_lines',
                            'tasks', coalesce(array_length(tids, 1), 0), 'closures', st -> 'closures');
end $$;
revoke all on function public.delete_show(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_show(uuid) to authenticated;
