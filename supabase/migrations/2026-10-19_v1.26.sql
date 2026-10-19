-- v1.26 : conditions validées avant la confirmation, mise à jour automatique (temps réel)
alter table public.shows add column if not exists terms_validated_at timestamptz;   -- conditions (cachet, acomptes…) validées avant la confirmation
alter publication supabase_realtime add table public.structures, public.contacts, public.contact_structures, public.projects, public.partners,
  public.shows, public.show_payments, public.prospects, public.prospect_logs, public.prospect_files, public.tasks, public.settings,
  public.structure_events, public.project_logs, public.project_members, public.attachments, public.notifications, public.mail_templates,
  public.employees, public.budget_lines;
