-- RETOUR ARRIÈRE de supabase/operations/2026-11-09_brise_glace_rattachement.sql (Brise Glace, 02/12/2026). PRÉPARÉ, NON EXÉCUTÉ.
-- À lancer seulement sur accord d'Anthony (ex. : la vérification révèle que F-AB-2026-11-107 est finalement le solde).
--
-- Remet les deux lignes EXACTEMENT dans l'état d'avant l'opération, lu dans l'historique écrit par l'opération
-- (pennylane_rattachements.before) : acompte = n° F-AB-2026-11-107 noté à la main, envoyé le 05/11, sans lien Pennylane ;
-- solde = facture 34170228875264 / F-AB-2026-11-107, montant 228,99, facturé le 05/11, NON envoyé.
-- Pourquoi pas la fonction pennylane_rattacher : elle reporterait la date d'envoi de l'acompte sur le solde (sent_at), ce qui n'était
-- pas l'état d'avant. Le retour passe donc par les déclencheurs existants, dans cet ordre (aucun déclencheur désactivé) :
--   1. acompte libéré de sa facture (exception « rattachement_pennylane » de la protection v1.56.9 : ligne non payée, montant inchangé) ;
--   2. n° et date d'envoi de l'acompte remis (ligne non émise à cet instant : aucune exception nécessaire) ;
--   3. solde relié à la facture, montant 228,99 (ligne non émise à cet instant ; unicité respectée : l'acompte n'a plus la facture).
-- Historique : une ligne de plus dans pennylane_rattachements (motif « retour arrière ») ; la facture reste exclue du rapprochement
-- automatique (choix manuel). Journal financier : écrit par les déclencheurs habituels.
-- Arrêt sans rien modifier si : l'opération n'a pas été appliquée, une des deux lignes diffère de l'état laissé par l'opération sur
-- une seule colonne suivie (paiement, envoi, relance, rangement Drive, lien, nouvelle facture de solde…), la date a changé depuis
-- (cession, %, TVA, mode, jour : journal financier), ou l'historique de l'opération est introuvable. Rejouable : une deuxième exécution reconnaît l'état d'origine.
--
-- Exécution : set operation.confirmation = 'retour-brise-glace'; set operation.operateur = '<adresse de l''équipe>'; puis ce bloc.
do $rb$
declare
  pid constant text := '34170228875264';
  num constant text := 'F-AB-2026-11-107';
  conf text := coalesce(current_setting('operation.confirmation', true), '');
  qui text := lower(btrim(coalesce(current_setting('operation.operateur', true), '')));
  s record; a record; so record; h record; av_a jsonb; av_so jsonb; before_j jsonb; n int; ecarts text;
begin
  if conf <> 'retour-brise-glace' then raise exception 'Retour Brise Glace : confirmation absente : rien n''est modifié'; end if;
  if qui = '' or not exists (select 1 from public.app_users where lower(email) = qui) then
    raise exception 'Retour Brise Glace : opérateur absent ou hors équipe : rien n''est modifié';
  end if;
  select count(*) into n from public.shows where id::text like 'b021e7d4-%';
  if n <> 1 then raise exception 'Retour Brise Glace : % date(s) b021e7d4-… : rien n''est modifié', n; end if;
  select * into s from public.shows where id::text like 'b021e7d4-%';
  select * into a from public.show_payments where show_id = s.id and id::text like 'd83eda31-%' and kind = 'acompte' for update;
  select * into so from public.show_payments where show_id = s.id and id::text like '7ac2937a-%' and kind = 'solde' for update;
  if a.id is null or so.id is null then raise exception 'Retour Brise Glace : lignes introuvables : rien n''est modifié'; end if;
  -- déjà revenu à l'état d'origine ?
  if a.pennylane_id is null and so.pennylane_id = pid
     and exists (select 1 from public.pennylane_rattachements where pennylane_id = pid and motif like 'Retour arrière de l''opération du 09/11/2026%') then
    raise notice 'Retour Brise Glace : déjà fait : rien n''est modifié'; return;
  end if;
  -- historique de l'opération (unique) et état corrigé inchangé depuis
  select count(*) into n from public.pennylane_rattachements where pennylane_id = pid;
  if n <> 1 then raise exception 'Retour Brise Glace : % ligne(s) d''historique pour la facture (attendu 1, celle de l''opération) : rien n''est modifié', n; end if;
  select * into h from public.pennylane_rattachements where pennylane_id = pid;
  if h.from_payment_id <> so.id or h.to_payment_id <> a.id or h.motif not like 'Opération contrôlée du 09/11/2026 (Brise Glace%' then
    raise exception 'Retour Brise Glace : l''historique n''est pas celui de l''opération : rien n''est modifié';
  end if;
  av_so := h.before -> 'source'; av_a := h.before -> 'cible';
  if not (a.pennylane_id = pid and a.invoice_number = num and a.sent_at = date '2026-11-05' and a.paid_at is null and a.amount = 228.99) then
    raise exception 'Retour Brise Glace : acompte modifié depuis l''opération (%) : rien n''est modifié', to_jsonb(a);
  end if;
  if not (so.pennylane_id is null and so.invoice_number is null and so.sent_at is null and so.paid_at is null and so.amount is null) then
    raise exception 'Retour Brise Glace : solde modifié depuis l''opération (facturé, envoyé ou payé ?) (%) : rien n''est modifié', to_jsonb(so);
  end if;
  -- relecture de 3dd83dd (B2) : les deux lignes doivent être EXACTEMENT celles laissées par l'opération (h.after), sur toutes les
  -- colonnes suivies — sinon une relance, un rangement Drive, un nouveau lien… posés depuis seraient écrasés en silence
  select string_agg(l.quoi || '.' || c, ', ') into ecarts
    from (values ('acompte', to_jsonb(a), h.after -> 'cible'), ('solde', to_jsonb(so), h.after -> 'source')) l(quoi, maintenant, apres),
         unnest(array['invoice_number','invoiced_on','sent_at','paid_at','pennylane_id','pennylane_url','reminded_at','drive_file_id',
                      'amount','pct','vat_rate','kind','show_id','hors_calcul','payee','reminders_paused']) c
   where l.maintenant -> c is distinct from l.apres -> c;
  if h.after is null or h.after -> 'cible' is null or h.after -> 'source' is null or ecarts is not null then
    raise exception 'Retour Brise Glace : lignes modifiées depuis l''opération (%) : rien n''est modifié', coalesce(ecarts, 'historique incomplet');
  end if;
  -- date (cession, %, TVA, mode, jour) modifiée depuis l'opération (journal financier) : le montant calculé du solde a pu changer → arrêt
  if s.date <> date '2026-12-02' or exists (select 1 from public.finance_log f where f.at > h.at and (f.show_id = s.id or f.row_id in (a.id, so.id))) then
    raise exception 'Retour Brise Glace : la date ou ses lignes ont changé depuis l''opération (journal financier) : rien n''est modifié';
  end if;
  before_j := jsonb_build_object('source', to_jsonb(a), 'cible', to_jsonb(so));

  perform set_config('request.jwt.claims', jsonb_build_object('email', qui, 'role', 'authenticated')::text, true);
  -- 1. acompte libéré de la facture (montant inchangé)
  perform set_config('matrice.regularisation', 'rattachement_pennylane', true);
  update public.show_payments set pennylane_id = null, pennylane_url = null, invoice_number = null, sent_at = null where id = a.id;
  perform set_config('matrice.regularisation', '', true);
  -- 2. acompte : n° noté à la main et date d'envoi d'origine
  update public.show_payments set invoice_number = av_a ->> 'invoice_number', sent_at = (av_a ->> 'sent_at')::date,
         invoiced_on = (av_a ->> 'invoiced_on')::date, pennylane_url = av_a ->> 'pennylane_url',
         reminded_at = (av_a ->> 'reminded_at')::date, drive_file_id = av_a ->> 'drive_file_id'
   where id = a.id;
  -- 3. solde : facture, montant figé, date de facture, relance et rangement d'origine (non envoyé)
  update public.show_payments set pennylane_id = av_so ->> 'pennylane_id', pennylane_url = av_so ->> 'pennylane_url',
         invoice_number = av_so ->> 'invoice_number', invoiced_on = (av_so ->> 'invoiced_on')::date, amount = (av_so ->> 'amount')::numeric,
         reminded_at = (av_so ->> 'reminded_at')::date, drive_file_id = av_so ->> 'drive_file_id'
   where id = so.id;
  insert into public.pennylane_rattachements (actor, show_id, pennylane_id, invoice_number, from_payment_id, to_payment_id, motif, before, after)
  values (qui, s.id, pid, num, a.id, so.id, 'Retour arrière de l''opération du 09/11/2026 (Brise Glace) : état d''avant rétabli',
          before_j, jsonb_build_object('source', (select to_jsonb(x) from public.show_payments x where x.id = a.id),
                                       'cible', (select to_jsonb(x) from public.show_payments x where x.id = so.id)));
  perform set_config('request.jwt.claims', '', true);

  -- contrôle : chaque colonne suivie revenue à l'état d'origine
  select * into a from public.show_payments where id = a.id;
  select * into so from public.show_payments where id = so.id;
  if exists (select 1 from jsonb_each(av_a) e where e.key in ('amount','pct','invoice_number','invoiced_on','sent_at','paid_at','pennylane_id','pennylane_url','reminded_at','drive_file_id')
               and e.value is distinct from to_jsonb(a) -> e.key)
     or exists (select 1 from jsonb_each(av_so) e where e.key in ('amount','pct','invoice_number','invoiced_on','sent_at','paid_at','pennylane_id','pennylane_url','reminded_at','drive_file_id')
               and e.value is distinct from to_jsonb(so) -> e.key) then
    raise exception 'Retour Brise Glace : état d''origine non retrouvé (acompte %, solde %) : tout est annulé', to_jsonb(a), to_jsonb(so);
  end if;
  raise notice 'Retour Brise Glace : état d''avant l''opération rétabli (facture 107 sur le solde, acompte noté à la main)';
end $rb$;
