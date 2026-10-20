-- v1.37 : une structure hors de France n'a jamais de département français (ex. Eden de Charleroi qui gardait l'Indre-et-Loire)
create or replace function public.structures_place_clean() returns trigger language plpgsql as $$
begin
  if new.country is not null and new.country !~* '^\s*france\s*$' then new.department_code := null; new.department_name := null; end if;
  return new;
end $$;
do $$ begin if not exists (select 1 from pg_trigger where tgname = 'structures_place_clean') then
  create trigger structures_place_clean before insert or update on public.structures for each row execute function public.structures_place_clean(); end if; end $$;
update public.structures set country = country where country !~* '^\s*france\s*$' and department_code is not null;

-- tags écrits de deux façons : une seule écriture gardée
update public.structures set tags = (select array_agg(distinct case t when 'café concert' then 'Café Concert' when 'Producteur de spectacles' then 'Producteur de Spectacles' else t end) from unnest(tags) t)
 where tags && array['café concert', 'Producteur de spectacles'];

-- paiements créés au passage en production : un solde déjà là sans acompte = choix « sans acompte », gardé ;
-- fonctions internes appelées seulement par le déclencheur (personne ne peut les appeler directement)
create or replace function public.ensure_production_payments(p_show uuid) returns void language plpgsql security definer set search_path = public as $$
declare ac numeric := coalesce(setting_num('default_acompte_pct'), 50); s record; has_ac boolean; has_so boolean; sum_ac numeric; mx int;
begin
  select * into s from shows where id = p_show;
  if s is null or coalesce(s.prod_mode, 'production') = 'booking' or s.status not in ('Confirmée Salle','Confirmée Festival') then return; end if;
  perform pg_advisory_xact_lock(hashtext('pay:' || p_show));
  select coalesce(max(sort), 0) into mx from show_payments where show_id = p_show;
  has_ac := exists (select 1 from show_payments where show_id = p_show and kind = 'acompte');
  has_so := exists (select 1 from show_payments where show_id = p_show and kind = 'solde');
  if not has_ac and not has_so then
    insert into show_payments (show_id, kind, label, pct, sort, payee) values
      (p_show, 'acompte', 'Acompte', ac, mx + 1, 'compte'), (p_show, 'solde', 'Solde', greatest(0, 100 - ac), mx + 2, 'compte');
  elsif not has_so then
    select coalesce(sum(pct), 0) into sum_ac from show_payments where show_id = p_show and kind = 'acompte';
    insert into show_payments (show_id, kind, label, pct, sort, payee) values (p_show, 'solde', 'Solde', greatest(0, 100 - sum_ac), mx + 1, 'compte');
  end if;
end $$;
create or replace function public.show_mode_payments() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.prod_mode, 'production') <> 'booking' and coalesce(old.prod_mode, 'production') = 'booking' then
    perform ensure_production_payments(new.id);
  end if;
  return new;
end $$;
revoke execute on function public.ensure_production_payments(uuid) from public, anon, authenticated;
revoke execute on function public.show_mode_payments() from public, anon, authenticated;
