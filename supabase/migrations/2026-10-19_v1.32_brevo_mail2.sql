-- v1.32 : le 2e mail d'un contact part aussi dans Brevo
alter table public.contacts add column if not exists email_2 text;
alter table public.contacts add column if not exists phone_2 text;
-- mails que la Matrice a elle-même créés dans Brevo (les seuls dont elle peut compléter prénom / nom / structure)
alter table public.contacts add column if not exists brevo_emails text[] not null default '{}';

create or replace function public.brevo_contact_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'contacts' then
    if (new.email is not null or new.email_2 is not null) and (tg_op = 'INSERT'
       or new.email is distinct from old.email or new.email_2 is distinct from old.email_2
       or new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name) then
      perform brevo_queue(new.id);
    end if;
  else
    perform brevo_queue(new.contact_id);
  end if;
  return new;
end $$;

do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'brevo_contacts') then
    execute 'create or replace trigger brevo_contacts after insert or update of email, email_2, first_name, last_name on public.contacts for each row execute function brevo_contact_trg()';
  end if;
end $$;

-- mail_vars : « contact_email » reprend les deux mails du contact (séparés par une virgule) — appliqué par remplacement dans la fonction en place :
--   'contact_email', coalesce(nullif(concat_ws(', ', nullif(trim(c.email), ''), nullif(trim(c.email_2), '')), ''), ''),
update contacts set brevo_emails = array[lower(trim(email))] where brevo_created and email is not null and brevo_emails = '{}';
