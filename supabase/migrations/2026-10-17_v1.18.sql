-- v1.18 : prospection par mail depuis une structure (brouillon ou envoi Gmail du compte anthony@), relances dans le même fil
alter table public.prospects add column if not exists mail_thread_id text;    -- fil Gmail du mail de prospection
alter table public.prospects add column if not exists mail_to text;           -- destinataire
alter table public.prospects add column if not exists mail_subject text;
alter table public.prospects add column if not exists mail_sent_at timestamptz;  -- vide = encore en brouillon
alter table public.prospects add column if not exists mail_log_id uuid;       -- entrée du journal à dater quand le brouillon part
alter table public.prospects add column if not exists relances integer default 0;
insert into public.settings(key, value) values ('prospect_script_url', '""'::jsonb), ('prospect_from', '"anthony@lartboristerie.com"'::jsonb)
  on conflict (key) do nothing;
