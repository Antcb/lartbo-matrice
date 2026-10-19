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

-- mail_vars : « contact_email » reprend les deux mails du contact (séparés par une virgule)
do $$ declare d text; begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mail_vars';
  if d is not null and position('''contact_email'', coalesce(c.email, ''''),' in d) > 0 then
    execute replace(d, '''contact_email'', coalesce(c.email, ''''),',
      '''contact_email'', coalesce(nullif(concat_ws('', '', nullif(trim(c.email), ''''), nullif(trim(c.email_2), '''')), ''''), ''''),');
  end if;
end $$;

-- mails créés dans Brevo par la Matrice : ajout sans écraser (deux synchronisations du même contact peuvent tourner en même temps)
create or replace function public.brevo_add_emails(p_contact uuid, p_emails text[]) returns void
language sql security definer set search_path = public as $$
  update contacts set brevo_emails = (select coalesce(array_agg(distinct e), '{}') from unnest(brevo_emails || coalesce(p_emails, '{}')) e)
  where id = p_contact;
$$;
revoke execute on function public.brevo_add_emails(uuid, text[]) from public, anon, authenticated;

update contacts set brevo_emails = array[lower(trim(email))] where brevo_created and email is not null and brevo_emails = '{}';

-- v1.33.3 : en production, la commission L'ArtBo n'est pas facturée : le rappel dit « à te verser » et ne regarde que la date de versement
do $$ declare d text; o text := 'coalesce(c_label,''Commission L''''ArtBo'') || '' : facture à '' || case when c_sent is null then ''envoyer'' else ''faire payer'' end
                     from s where mode <> ''booking'' and a_paid is not null and c_id is not null and (c_sent is null or c_paid is null)';
  n text := 'coalesce(c_label,''Commission L''''ArtBo'') || '' : à te verser (virement du compte de l''''artiste vers L''''ArtBo)''
                     from s where mode <> ''booking'' and a_paid is not null and c_id is not null and c_paid is null';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'generate_reminders';
  if d is not null and position(o in d) > 0 then execute replace(d, o, n); end if;
end $$;
