-- v1.26 : conditions validées avant la confirmation, mise à jour automatique (temps réel)
alter table public.shows add column if not exists terms_validated_at timestamptz;   -- conditions (cachet, acomptes…) validées avant la confirmation
alter publication supabase_realtime add table public.structures, public.contacts, public.contact_structures, public.projects, public.partners,
  public.shows, public.show_payments, public.prospects, public.prospect_logs, public.prospect_files, public.tasks, public.settings,
  public.structure_events, public.project_logs, public.project_members, public.attachments, public.notifications, public.mail_templates,
  public.employees, public.budget_lines;
-- Conditions validées sans acompte : 0 %, plus de % par défaut (mail et fiche reprennent exactement ce qui a été validé)
do $do$ declare d text; begin
  d := pg_get_functiondef('public.mail_vars(uuid,uuid)'::regprocedure);
  if position('terms_validated_at' in d) = 0 then
    d := replace(d, 'acpt := coalesce(acpt, nullif', 'acpt := coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif');
    execute d;
  end if;
  d := pg_get_functiondef('public.fiche_get(text)'::regprocedure);
  if position('terms_validated_at' in d) = 0 then
    d := replace(d, '''acompte_pct'', coalesce(acpt, nullif', '''acompte_pct'', coalesce(acpt, case when s.terms_validated_at is not null then 0 end, nullif');
    execute d;
  end if;
end $do$;

-- v1.27 : échéance de chaque acompte (« à la signature du contrat », « le 15 janvier 2027 »…), reprise dans le mail de confirmation
alter table public.show_payments add column if not exists due_label text;
-- v1.27.2 : la fiche de renseignements reçoit l'échéance de chaque acompte
do $do$ declare d text; begin
  d := pg_get_functiondef('public.fiche_get(text)'::regprocedure);
  if position('due_label' in d) = 0 then
    d := replace(d, '''kind'', p.kind, ''pct'', p.pct,', '''kind'', p.kind, ''pct'', p.pct, ''due_label'', p.due_label,');
    execute d;
  end if;
end $do$;
-- v1.27.4 : erreurs du site notées pour diagnostic
create table if not exists public.client_errors (id bigint generated always as identity primary key, created_at timestamptz default now(), user_email text, version text, view text, message text, stack text, ua text);
alter table public.client_errors enable row level security;
create policy "insert own errors" on public.client_errors for insert to authenticated with check (true);
