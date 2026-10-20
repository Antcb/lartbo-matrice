-- v1.36 : mails et téléphones des contacts toujours propres, quelle que soit la façon dont ils arrivent
-- (formulaire, import, fiche publique) : espaces et caractères invisibles retirés, mail en minuscules,
-- un numéro saisi dans une case mail part dans une case téléphone, une adresse web part dans les notes.
create or replace function public.clean_email(t text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(lower(regexp_replace(coalesce(t,''), '[\s​-‏‪-‮⁠﻿]', '', 'g')), '\(.*\)$', ''), '\.$', ''), '')
$$;
create or replace function public.clean_phone(t text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(coalesce(t,''), '[​-‏‪-‮⁠﻿]', '', 'g')), '')
$$;
create or replace function public.contacts_clean() returns trigger language plpgsql as $$
declare raw text; c text; i int;
begin
  new.phone := clean_phone(new.phone); new.phone_2 := clean_phone(new.phone_2);
  for i in 1..2 loop
    raw := case i when 1 then new.email else new.email_2 end;
    c := clean_email(raw);
    if c is not null and c !~ '^[^@]+@[^@]+\.[a-z]{2,}$' then
      if c ~ '^\+?[0-9]{8,15}$' then                              -- un numéro dans la case mail
        if new.phone is null then new.phone := clean_phone(raw);
        elsif new.phone_2 is null then new.phone_2 := clean_phone(raw);
        else new.notes := concat_ws(E'\n', new.notes, 'Autre numéro : ' || clean_phone(raw)); end if;
      else                                                         -- adresse web ou texte : gardé dans les notes
        new.notes := concat_ws(E'\n', new.notes, 'Contact : ' || btrim(raw));
      end if;
      c := null;
    end if;
    if i = 1 then new.email := c; else new.email_2 := c; end if;
  end loop;
  if new.email is null and new.email_2 is not null then new.email := new.email_2; new.email_2 := null; end if;
  if new.email_2 = new.email then new.email_2 := null; end if;
  return new;
end $$;
do $$ begin if not exists (select 1 from pg_trigger where tgname = 'contacts_clean') then
  create trigger contacts_clean before insert or update of email, email_2, phone, phone_2 on public.contacts for each row execute function public.contacts_clean(); end if; end $$;
-- contacts existants
update public.contacts set email = email
 where email is distinct from clean_email(email) or email_2 is distinct from clean_email(email_2)
    or phone is distinct from clean_phone(phone) or phone_2 is distinct from clean_phone(phone_2)
    or (email is not null and clean_email(email) !~ '^[^@]+@[^@]+\.[a-z]{2,}$')
    or (email_2 is not null and clean_email(email_2) !~ '^[^@]+@[^@]+\.[a-z]{2,}$');
