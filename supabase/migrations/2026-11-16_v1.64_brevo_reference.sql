-- v1.64 — Brevo : MATRICE fait référence, Brevo est l'outil de diffusion (décisions d'Anthony du 16/11/2026, 11 règles validées).
-- Registre des fiches Brevo gérées par MATRICE (brevo_fiches), journal (brevo_journal), adresses protégées (réglage brevo_protegees),
-- contacts supprimés (déclencheur brevo_contact_supprime), adresses partagées (brevo_porteurs, brevo_doublons), recréation volontaire
-- d'une fiche supprimée dans Brevo (brevo_recreer). AUCUNE donnée existante n'est modifiée ni supprimée : le registre est seulement
-- amorcé à partir des fiches déjà créées par MATRICE (contacts.brevo_emails / brevo_created, colonnes conservées telles quelles).
-- Aucune adoption des fiches préexistantes ici (opération distincte, autorisée explicitement par Anthony : réglage brevo_adoption).
-- Rejouable (if not exists / on conflict do nothing / create or replace). Ordre : migration, PUIS fonction brevo-sync v1.64.
begin;

-- ── Registre ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.brevo_fiches (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  contact_id uuid,                     -- pas de clé étrangère : la ligne survit à la suppression du contact (règles de suppression)
  champ text check (champ in ('email', 'email_2')),
  origine text not null check (origine in ('matrice', 'preexistante')),
  statut text not null check (statut in ('creation', 'active', 'conflit', 'supprimee_brevo', 'detachee', 'suppression', 'supprimee')),
  detail text,
  maj_at timestamptz not null default now()
);
create index if not exists brevo_fiches_contact on public.brevo_fiches (contact_id);
create table if not exists public.brevo_journal (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  email text not null,
  contact_id uuid,
  action text not null,
  detail text
);
create index if not exists brevo_journal_email on public.brevo_journal (email);
-- lecture par l'équipe (fiche contact) ; écriture par la fonction serveur seulement (rôle serveur)
alter table public.brevo_fiches enable row level security;
alter table public.brevo_journal enable row level security;
drop policy if exists brevo_fiches_lecture on public.brevo_fiches;
create policy brevo_fiches_lecture on public.brevo_fiches for select to authenticated using (public.is_team());
drop policy if exists brevo_journal_lecture on public.brevo_journal;
create policy brevo_journal_lecture on public.brevo_journal for select to authenticated using (public.is_team());
revoke all on public.brevo_fiches, public.brevo_journal from anon, authenticated;
grant select on public.brevo_fiches, public.brevo_journal to authenticated;
grant select, insert, update, delete on public.brevo_fiches to service_role;
grant select, insert on public.brevo_journal to service_role;

-- Amorçage : fiches DÉJÀ créées par MATRICE (règle inchangée jusqu'ici). Adresse encore portée par le contact : active ; adresse que
-- le contact n'a plus (changée avant la v1.64) : détachée (jamais supprimée à cause de l'amorçage). Adresse revendiquée par deux
-- contacts : la première seulement (on conflict do nothing) — elle sera protégée comme adresse partagée.
insert into public.brevo_fiches (email, contact_id, champ, origine, statut, detail)
select x.e,
       case when x.champ is null then null else x.id end,
       x.champ, 'matrice',
       case when x.champ is null then 'detachee' else 'active' end,
       case when x.champ is null then 'Amorçage v1.64 : adresse plus portée par le contact' end
from (
  select c.id, lower(btrim(e)) e,
         case when lower(btrim(e)) = lower(btrim(c.email)) then 'email' when lower(btrim(e)) = lower(btrim(c.email_2)) then 'email_2' end champ
  from public.contacts c, unnest(coalesce(c.brevo_emails, '{}') ||
       case when c.brevo_created and coalesce(cardinality(c.brevo_emails), 0) = 0 and c.email is not null then array[c.email] else '{}'::text[] end) e
  where coalesce(btrim(e), '') <> ''
) x
on conflict (email) do nothing;

-- ── Adresses protégées (règle 5) : MATRICE n'y touche jamais. Valeur par défaut : anthony@ (modifiable dans Réglages › Brevo) ──
insert into public.settings (key, value) values ('brevo_protegees', to_jsonb('anthony@lartboristerie.com'::text))
on conflict (key) do nothing;

-- ── Contacts qui portent chaque adresse (mail 1 ou mail 2) — fonction serveur seulement ─────────────────────────────────────────
create or replace function public.brevo_porteurs(p_emails text[]) returns table (email text, contacts uuid[])
language sql stable security definer set search_path = public as $$
  select m.e, array_agg(distinct m.id order by m.id)
  from (select c.id, lower(btrim(x)) e from public.contacts c, unnest(array[c.email, c.email_2]) x where coalesce(btrim(x), '') <> '') m
  where m.e = any (p_emails)
  group by m.e
$$;
revoke all on function public.brevo_porteurs(text[]) from public, anon, authenticated;
grant execute on function public.brevo_porteurs(text[]) to service_role;

-- ── Adresses partagées par plusieurs contacts : à dédoublonner (Réglages › Brevo) — équipe seulement ───────────────────────────
create or replace function public.brevo_doublons() returns table (email text, contacts jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'Réservé à l’équipe'; end if;
  return query
  select m.e, jsonb_agg(jsonb_build_object('id', m.id, 'nom', m.nom) order by m.nom)
  from (select distinct c.id, coalesce(c.display_name, '') nom, lower(btrim(x)) e
        from public.contacts c, unnest(array[c.email, c.email_2]) x where coalesce(btrim(x), '') <> '') m
  group by m.e having count(*) > 1
  order by m.e;
end $$;
revoke all on function public.brevo_doublons() from public, anon;
grant execute on function public.brevo_doublons() to authenticated;

-- ── Envoi à la fonction serveur brevo-sync (corps libre) ; brevo_queue inchangée pour les appelants existants ──────────────────
create or replace function public.brevo_post(p_body jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k text; sec text; base text;
begin
  select value #>> '{}' into k from settings where key = 'brevo_api_key';
  if coalesce(trim(k), '') = '' then return; end if;
  select value #>> '{}' into base from settings where key = 'functions_base_url';
  if coalesce(trim(base), '') = '' then return; end if;
  select value #>> '{}' into sec from settings where key = 'brevo_hook_secret';
  perform net.http_post(
    url := rtrim(base, '/') || '/brevo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec),
    body := p_body);
end $$;
revoke all on function public.brevo_post(jsonb) from public, anon, authenticated;
create or replace function public.brevo_queue(p_contact uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.brevo_post(jsonb_build_object('contact_id', p_contact));
end $$;

-- ── Création / modification : aussi quand le contact PERD toutes ses adresses (règles de suppression d'adresse) ────────────────
create or replace function public.brevo_contact_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'contacts' then
    if tg_op = 'INSERT' then
      if new.email is not null or new.email_2 is not null then perform brevo_queue(new.id); end if;
    elsif (new.email is not null or new.email_2 is not null or old.email is not null or old.email_2 is not null)
       and (new.email is distinct from old.email or new.email_2 is distinct from old.email_2
            or new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name) then
      perform brevo_queue(new.id);
    end if;
  else
    perform brevo_queue(new.contact_id);
  end if;
  return new;
end $$;

-- ── Contact supprimé : ses fiches gérées suivent les règles de suppression (fonction serveur, mode contact_supprime) ───────────
create or replace function public.brevo_contact_supprime_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.brevo_fiches f where f.contact_id = old.id and f.statut in ('active', 'conflit')) then
    perform public.brevo_post(jsonb_build_object('contact_supprime', old.id));
  end if;
  return old;
end $$;
revoke all on function public.brevo_contact_supprime_trg() from public, anon, authenticated;
drop trigger if exists brevo_contact_supprime on public.contacts;
create trigger brevo_contact_supprime after delete on public.contacts for each row execute function public.brevo_contact_supprime_trg();

-- ── Recréer volontairement une fiche supprimée dans Brevo (règle 5 : jamais automatique) — équipe, depuis la fiche contact ──────
create or replace function public.brevo_recreer(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid; e text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_team() then raise exception 'Réservé à l’équipe'; end if;
  update public.brevo_fiches set statut = 'supprimee', contact_id = null, champ = null, detail = null, maj_at = now()
   where email = e and statut = 'supprimee_brevo' returning email into e;
  if e is null then return jsonb_build_object('ok', false, 'error', 'Cette adresse n’est pas notée « supprimée dans Brevo »'); end if;
  insert into public.brevo_journal (email, action, detail) values (e, 'recreation_demandee', coalesce(auth.email(), 'équipe'));
  select k.id into c from public.contacts k where lower(btrim(k.email)) = e or lower(btrim(k.email_2)) = e limit 1;
  if c is not null then perform public.brevo_queue(c); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.brevo_recreer(text) from public, anon;
grant execute on function public.brevo_recreer(text) to authenticated;

commit;
