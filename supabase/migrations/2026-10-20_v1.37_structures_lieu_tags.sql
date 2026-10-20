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
