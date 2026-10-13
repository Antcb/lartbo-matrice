-- v1.16 : festivals / salles / événements d'une structure portent la jauge, le tarif et le prix moyen
alter table public.structure_events add column if not exists kind text;          -- Festival, Salle, Événement
alter table public.structure_events add column if not exists price_avg numeric;  -- prix moyen du billet (€)
alter table public.structure_events add column if not exists pricing text;       -- Payant, Gratuit, Prix libre

-- reprise de la jauge et du tarif saisis sur la fiche structure (avant v1.16) dans un festival / une salle
insert into public.structure_events (structure_id, name, kind, city, capacity, pricing, notes)
select s.id, s.name,
       case when 'Festival' = any(coalesce(s.tags, '{}')) then 'Festival' else 'Salle' end,
       s.city, nullif(s.capacity_1, 0),
       case when s.pricing = 'Prix Libre' then 'Prix libre' else s.pricing end,
       case when coalesce(s.capacity_2, 0) > 0 then 'Jauge 2 : ' || s.capacity_2 end
from public.structures s
where (coalesce(s.capacity_1, 0) > 0 or coalesce(s.capacity_2, 0) > 0 or s.pricing is not null)
  and not exists (select 1 from public.structure_events e where e.structure_id = s.id);

-- Brevo : chaque contact créé / modifié (mail, prénom, nom) ou rattaché à une structure part dans Brevo
-- (fonction brevo-sync, clé API et liste dans Réglages › Brevo)
alter table public.contacts add column if not exists brevo_at timestamptz;
alter table public.contacts add column if not exists brevo_error text;
insert into public.settings(key, value) values ('brevo_hook_secret', to_jsonb(encode(gen_random_bytes(18), 'hex')))
  on conflict (key) do nothing;

create or replace function public.brevo_queue(p_contact uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k text; sec text;
begin
  select value #>> '{}' into k from settings where key = 'brevo_api_key';
  if coalesce(trim(k), '') = '' then return; end if;   -- Brevo pas encore branché
  select value #>> '{}' into sec from settings where key = 'brevo_hook_secret';
  perform net.http_post(
    url := 'https://ypvvjoqhzddzbmerypdc.supabase.co/functions/v1/brevo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', sec),
    body := jsonb_build_object('contact_id', p_contact));
end $$;

create or replace function public.brevo_contact_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'contacts' then
    if new.email is not null and (tg_op = 'INSERT' or new.email is distinct from old.email
       or new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name) then
      perform brevo_queue(new.id);
    end if;
  else
    perform brevo_queue(new.contact_id);
  end if;
  return new;
end $$;

drop trigger if exists brevo_contacts on public.contacts;
create trigger brevo_contacts after insert or update of email, first_name, last_name on public.contacts
  for each row execute function public.brevo_contact_trg();
drop trigger if exists brevo_contact_structures on public.contact_structures;
create trigger brevo_contact_structures after insert on public.contact_structures
  for each row execute function public.brevo_contact_trg();
-- contact créé dans Brevo par la Matrice (seuls ceux-là peuvent être complétés ensuite ; les autres ne sont jamais modifiés)
alter table public.contacts add column if not exists brevo_created boolean;
