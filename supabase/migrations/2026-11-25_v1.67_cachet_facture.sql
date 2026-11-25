-- v1.67 — point n°10 (décisions d'Anthony du 25/11/2026) : dans un même budget, des personnes au cachet et d'autres payées sur facture.
--  1. budget_lines.pay_mode (colonne NOUVELLE, vide) : mode de rémunération d'une ligne de salaire — 'cachet' (bulletin de paie
--     Movinmotion, montant en coût employeur) ou 'facture' (montant HT sur facture, aucun bulletin). Vide = au cachet : les lignes déjà
--     enregistrées gardent exactement leur calcul actuel (aucune donnée existante modifiée).
--  2. ensure_movinmotion : la ligne « Commission bulletins de paie » n'est ajoutée que si la date a au moins une ligne de salaire AU
--     CACHET (une ligne sur facture ne génère aucun bulletin). Les lignes Movinmotion existantes ne sont pas touchées.
--     Même règle côté application : js/budget.js (bulletinsProposed), js/budget-actions.js (syncMovinmotionLine).
-- Le nombre de bulletins de la ligne Movinmotion se saisit dans sa colonne qty existante (vide = nombre proposé d'après les lignes au
-- cachet ; 0 accepté) : aucune nouvelle colonne pour cela.
--  3. shows.budget_created_at (colonne NOUVELLE, vide pour toutes les dates existantes) : marqueur PERSISTANT « budget créé avec la
--     v1.67 » (décision d'Anthony du 25/11/2026), posé UNE fois par le déclencheur budget_lines_mark_created quand la première ligne
--     d'une date SANS aucune ligne de budget est créée (ajout à la main, budget type, copie, import) ; jamais recalculé d'après les
--     lignes présentes, jamais modifié ni effacé ensuite (shows_budget_marker_keep). Vide = budget enregistré avant le déploiement :
--     un changement de lieu, de structure ou de contrat n'y ajoute pas la ligne CNM (js/data.js). Aucune donnée existante n'est remplie.
--     Effet de bord : la pose du marqueur met à jour shows.updated_at (shows_touch) ; aucun autre déclencheur des dates n'est concerné
--     (finance_log ne suit pas ce champ ; aucun garde-fou ne le refuse).
-- Retour arrière : drop trigger budget_lines_mark_created on public.budget_lines ; drop trigger shows_budget_marker_keep on public.shows ;
--   drop function public.mark_budget_created(), public.keep_budget_marker() ; alter table public.shows drop column budget_created_at ;
--   alter table public.budget_lines drop column pay_mode ; réappliquer ensure_movinmotion de la v1.57.
-- Rejouable (if not exists / create or replace).
begin;

alter table public.budget_lines add column if not exists pay_mode text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'budget_lines_pay_mode_ok') then
    alter table public.budget_lines add constraint budget_lines_pay_mode_ok check (pay_mode is null or pay_mode in ('cachet', 'facture'));
  end if;
end $$;
comment on column public.budget_lines.pay_mode is
  'v1.67 : ligne de salaire au cachet (bulletin Movinmotion, coût employeur) ou sur facture (montant HT, aucun bulletin) ; vide = au cachet';

create or replace function public.ensure_movinmotion(p_show uuid) returns void language plpgsql as $$
begin
  insert into public.budget_lines (project_id, show_id, category, label, supplier, auto, payer, sort, unit_cost)
  select s.project_id, s.id, 'Movinmotion', 'Commission bulletins de paie', 'Movinmotion', 'movinmotion', 'compte',
         coalesce((select max(sort) from public.budget_lines b where b.show_id = s.id), 0) + 1,
         coalesce((select (st.value #>> '{}')::numeric from public.settings st where st.key = 'movinmotion_payslip_cost'), 20.3)
    from public.shows s
   where s.id = p_show and coalesce(s.prod_mode, 'production') <> 'booking'
     and exists (select 1 from public.budget_lines b where b.show_id = s.id and b.category = 'Staff' and coalesce(b.pay_mode, 'cachet') = 'cachet')
  on conflict (show_id, auto) where auto in ('movinmotion', 'cnm') and show_id is not null do nothing;
end $$;

alter table public.shows add column if not exists budget_created_at timestamptz;
comment on column public.shows.budget_created_at is
  'v1.67 : instant de création du budget de la date (première ligne, après le déploiement de la v1.67) ; vide = budget enregistré avant, ou pas de budget';

/** Première ligne d'une date sans budget : marqueur posé une seule fois (BEFORE : les lignes déjà insérées par la même commande sont
 *  visibles, donc seule la première ligne d'un ajout en lot pose le marqueur) */
create or replace function public.mark_budget_created() returns trigger language plpgsql set search_path = public as $$
begin
  if new.show_id is not null and not exists (select 1 from public.budget_lines b where b.show_id = new.show_id) then
    update public.shows set budget_created_at = now() where id = new.show_id and budget_created_at is null;
  end if;
  return new;
end $$;
drop trigger if exists budget_lines_mark_created on public.budget_lines;
create trigger budget_lines_mark_created before insert on public.budget_lines for each row execute function public.mark_budget_created();

/** Le marqueur posé ne change plus (ni effacé, ni déplacé) */
create or replace function public.keep_budget_marker() returns trigger language plpgsql set search_path = public as $$
begin
  if old.budget_created_at is not null then new.budget_created_at := old.budget_created_at; end if;
  return new;
end $$;
drop trigger if exists shows_budget_marker_keep on public.shows;
create trigger shows_budget_marker_keep before update of budget_created_at on public.shows for each row execute function public.keep_budget_marker();

commit;
