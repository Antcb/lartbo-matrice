-- v1.11 — fiche de renseignements alignée sur les formulaires CC / CR, validation par l'équipe, contrats

alter table public.shows add column if not exists fiche_validated_at timestamptz;
alter table public.shows add column if not exists contract_data jsonb not null default '{}';   -- valeurs validées utilisées pour le contrat
alter table public.shows add column if not exists contract_doc_id text;                       -- Google Doc du contrat (dossier de la date)
alter table public.shows add column if not exists contract_pdf_id text;
alter table public.shows add column if not exists invitations integer;                        -- quota d'invitations du producteur
alter table public.shows add column if not exists cr_producer_pct numeric;                    -- co-réalisation : % du résultat net après break au producteur
alter table public.shows add column if not exists cr_break text;                              -- co-réalisation : break

insert into public.settings(key, value) values ('contract_template_cc', '""'), ('contract_template_cr', '""') on conflict (key) do nothing;

-- La fiche publique affiche aussi les conditions de co-réalisation et le % d'acompte
create or replace function public.fiche_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s shows%rowtype; st structures%rowtype; pr projects%rowtype; pays jsonb; vat numeric; acpt numeric;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then return null; end if;
  select * into st from structures where id = s.structure_id;
  select * into pr from projects where id = s.project_id;
  vat := coalesce(s.vat_rate, 5.5);
  select coalesce(jsonb_agg(jsonb_build_object('label', p.label, 'kind', p.kind, 'pct', p.pct,
           'ht', coalesce(p.amount, round(s.fee_ht * p.pct) / 100)) order by p.sort), '[]')
    into pays from show_payments p where p.show_id = s.id and p.kind in ('acompte','solde');
  select pct into acpt from show_payments where show_id = s.id and kind = 'acompte' order by sort limit 1;
  return jsonb_build_object(
    'artist', trim(regexp_replace(coalesce(pr.name, ''), '\s*•.*$', '')),
    'date', s.date, 'date_end', s.date_end, 'date_label', fr_date(s.date, true),
    'venue', trim(regexp_replace(replace(coalesce(s.venue, ''), '**', ''), '\s*•\s*[A-Z/]{1,5}\s*$', '')),
    'city', s.city, 'cp', coalesce(st.postal_code, s.department),
    'status', s.status, 'contract_type', s.contract_type,
    'fee_ht', s.fee_ht, 'vat', vat, 'fee_ttc', round(s.fee_ht * (1 + vat / 100), 2),
    'acompte_pct', coalesce(acpt, nullif(setting_text('default_acompte_pct'), '')::numeric, 50),
    'cr_producer_pct', s.cr_producer_pct, 'cr_break', s.cr_break,
    'capacity', coalesce(s.capacity, st.capacity_1), 'ticketing_type', s.ticketing_type,
    'payments', pays,
    'structure', case when st.id is null then null else jsonb_build_object('name', st.name, 'address', st.address,
        'postal_code', st.postal_code, 'city', st.city, 'country', st.country, 'admin', coalesce(st.admin, '{}')) end,
    'fiche', s.fiche, 'submitted_at', s.fiche_submitted_at, 'validated_at', s.fiche_validated_at,
    'locked', s.contract_sent is not null);
end $$;

-- Les réponses restent « à valider » : rien n'est recopié sur la structure avant validation par l'équipe
create or replace function public.fiche_submit(p_token text, p_admin jsonb, p_fiche jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shows%rowtype;
begin
  if p_token is null or length(p_token) < 16 then raise exception 'Lien invalide'; end if;
  select * into s from shows where fiche_token = p_token;
  if not found then raise exception 'Lien invalide'; end if;
  if s.contract_sent is not null then raise exception 'Le contrat a déjà été envoyé : la fiche ne peut plus être modifiée. Écris-nous à production@lartboristerie.com.'; end if;
  if length(coalesce(p_admin::text,'')) + length(coalesce(p_fiche::text,'')) > 30000 then raise exception 'Fiche trop longue'; end if;
  update shows set fiche = coalesce(p_fiche, '{}') || jsonb_build_object('admin', coalesce(p_admin, '{}')),
                   fiche_submitted_at = now(), fiche_validated_at = null
    where id = s.id;
  insert into notifications (kind, title, body, show_id, project_id, dedupe_key)
    values ('fiche', 'Fiche de renseignements à valider — ' || coalesce(s.venue, ''),
            concat_ws(' · ', to_char(s.date, 'DD/MM/YYYY'), s.city, p_admin->>'legal_name'),
            s.id, s.project_id, 'fiche:' || s.id || ':' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.fiche_get(text) from public;
revoke execute on function public.fiche_submit(text, jsonb, jsonb) from public;
grant execute on function public.fiche_get(text) to anon, authenticated;
grant execute on function public.fiche_submit(text, jsonb, jsonb) to anon, authenticated;
