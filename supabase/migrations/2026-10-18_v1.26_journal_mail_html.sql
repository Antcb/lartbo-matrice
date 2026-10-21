-- v1.26 : le mail envoyé (prospection, relance) est gardé avec sa mise en forme dans le journal du suivi
alter table public.prospect_logs add column if not exists body_html text;
