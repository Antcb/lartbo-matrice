-- v1.24 : {{contact}} = prénom seul (mails des dates, brouillons automatiques), même règle que firstName() côté site
create or replace function public.contact_first_name(p_first text, p_last text, p_display text) returns text
language plpgsql immutable set search_path = public as $$
declare src text; parts text[]; part text; w text[]; names text[] := '{}'; whole boolean;
  org constant text := '^(association|asso|service|p[oô]le|ch[aâ]teau|le|la|les|l[''’]|festival|mairie|ville|comit[ée]|ing[ée]nieur|r[ée]gie|r[ée]gisseur|bureau|office|communaut[ée]|salle|th[ée][aâ]tre|centre|direction|[ée]quipe|team|booking|info|infos|contact|programmation|accueil|production|admin|administration|mjc|smac|scène|scene|club|bar|cie|compagnie|soci[ée]t[ée]|sarl|sas)$';
begin
  src := trim(regexp_replace(coalesce(p_first, ''), '\(.*?\)', ' ', 'g'));
  parts := regexp_split_to_array(coalesce(nullif(src, ''), regexp_replace(coalesce(p_display, ''), '\(.*?\)', ' ', 'g')), '\s*(/|;|&|\+|\met\M|\mou\M)\s*', 'i');
  whole := src <> '' and coalesce(trim(p_last), '') <> '' and array_length(array_remove(parts, ''), 1) = 1;
  foreach part in array parts loop
    w := regexp_split_to_array(trim(regexp_replace(part, '["“”].*?["“”]', ' ', 'g')), '\s+');
    if coalesce(w[1], '') = '' or position('@' in w[1]) > 0 or lower(w[1]) ~ org then continue; end if;
    names := names || case when whole then array_to_string(w, ' ') else w[1] end;
  end loop;
  if coalesce(array_length(names, 1), 0) = 0 then return ''; end if;
  if array_length(names, 1) = 1 then return names[1]; end if;
  return array_to_string(names[1:array_length(names, 1) - 1], ', ') || ' et ' || names[array_length(names, 1)];
end $$;

-- mail_vars : la balise {{contact}} passe par contact_first_name
do $$ declare d text; begin
  d := pg_get_functiondef('public.mail_vars(uuid,uuid)'::regprocedure);
  d := replace(d, $r$'contact', coalesce(nullif(c.first_name, ''), c.display_name, ''),$r$, $r$'contact', contact_first_name(c.first_name, c.last_name, c.display_name),$r$);
  if position('contact_first_name' in d) = 0 then raise exception 'mail_vars : ligne contact introuvable'; end if;
  execute d;
end $$;

-- Prospection depuis production@ (Chloé) ou anthony@ : boîte d'envoi du suivi, signature de Chloé
alter table public.prospects add column if not exists mail_account text;   -- null = anthony@ (script Prospection), 'production' = production@ (script Google principal)
insert into public.settings(key, value) values ('prospect_signature_production', to_jsonb($sig$<br><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="text-align:left; color:#000000; font-family:'Helvetica Neue', sans-serif; font-size:14px;"><tbody><tr><td style="text-align:left; padding:0;">Chloé<br><strong>Chloé Coste</strong><br>Chargée de Production<br><a href="tel:+33604524275">+33 (0)6 04 52 42 75</a> <span style="margin:0 2px;">|</span> <a href="mailto:production@lartboristerie.com">production@lartboristerie.com</a><br><a href="https://www.lartboristerie.com/" target="_blank">lartboristerie.com</a> <span style="margin:0 2px;">|</span> <a href="https://www.instagram.com/lartboristerie/" target="_blank">Instagram</a><br><span style="font-size:12px;">SARL L'ArtBoristerie Productions - 48Bis rue Pajol, 75018 Paris</span><br><br><a href="https://www.lartboristerie.com/" target="_blank"><img src="https://www.lartboristerie.com/wp-content/uploads/2026/02/LArtBoristerie_LogoCouleur-scaled.png" alt="L'ArtBoristerie Logo" width="170" style="display:block; border:0; width:170px; height:auto;"></a></td></tr></tbody></table>$sig$::text))
on conflict (key) do nothing;
