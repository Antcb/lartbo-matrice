-- v1.14 — modèles de mail : règle « proposé en premier pour », variante en nom libre, pièces jointes déposées
alter table public.mail_templates add column if not exists applies_to text not null default 'all';
update public.mail_templates set applies_to = case variant when 'ccr_club' then 'cr' when 'cc_festival' then 'festival' when 'cc_club' then 'salle' else 'all' end where applies_to = 'all';
update public.mail_templates set variant = case variant when 'ccr_club' then 'CCR Club' when 'cc_festival' then 'CC Festival' when 'cc_club' then 'CC Club' when 'cc' then 'CC' else variant end where variant in ('ccr_club','cc_festival','cc_club','cc');
-- settings.rename_sheet_url : lien du dernier tableau de renommages (écrit par le script Google)
