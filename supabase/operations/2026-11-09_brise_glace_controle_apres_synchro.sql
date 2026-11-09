-- Brise Glace (02/12/2026) — CONTRÔLE EN LECTURE SEULE après une nouvelle synchronisation Pennylane (bouton « Synchroniser » de
-- l'application), à lancer APRÈS supabase/operations/2026-11-09_brise_glace_rattachement.sql. Ne modifie rien.
-- Une ligne par contrôle (ok = t attendu partout) ; « détail » donne la valeur lue.
-- L'erreur de doublon (« duplicate key … show_payments_pennylane_unique_bill ») n'est écrite nulle part en base : elle n'apparaît que
-- dans le compte rendu de la synchronisation affiché dans l'application. Elle venait de la tentative de mettre l'id Pennylane de la
-- 107 sur l'acompte ; si l'acompte porte déjà cet id (contrôle 1), la synchronisation n'a plus rien à écrire → plus d'erreur.
with s as (select id from public.shows where id::text like 'b021e7d4-%'),
     a as (select p.* from public.show_payments p, s where p.show_id = s.id and p.id::text like 'd83eda31-%' and p.kind = 'acompte'),
     so as (select p.* from public.show_payments p, s where p.show_id = s.id and p.id::text like '7ac2937a-%' and p.kind = 'solde'),
     op as (select min(h.at) at from public.pennylane_rattachements h where h.pennylane_id = '34170228875264' and h.motif like 'Opération contrôlée du 09/11/2026 (Brise Glace%')
select 1 n, 'opération appliquée (historique)' controle, (select at is not null from op) ok, (select at::text from op) detail
union all select 2, 'facture 107 sur l''acompte (id, n°, envoi 05/11, montant 228,99)',
  (select pennylane_id = '34170228875264' and invoice_number = 'F-AB-2026-11-107' and sent_at = date '2026-11-05' and amount = 228.99 from a),
  (select concat_ws(' | ', pennylane_id, invoice_number, sent_at, amount, 'payée le ' || paid_at) from a)
union all select 3, 'solde vide (ni n°, ni lien, ni date de facture, ni envoi, ni paiement, montant calculé)',
  (select pennylane_id is null and pennylane_url is null and invoice_number is null and invoiced_on is null and sent_at is null and paid_at is null and amount is null from so),
  (select concat_ws(' | ', pennylane_id, invoice_number, invoiced_on, sent_at, paid_at, amount, 'calculé ' || public.payment_amount_now(so)) from so)
union all select 4, 'facture 107 sur une seule ligne',
  (select count(*) = 1 from public.show_payments where pennylane_id = '34170228875264'), (select count(*)::text from public.show_payments where pennylane_id = '34170228875264')
union all select 5, 'aucune facture « à rattacher » pour cette date (ni la 107)',
  not exists (select 1 from public.pennylane_a_rattacher r, s where (r.show_id = s.id or r.pennylane_id = '34170228875264') and r.resolved_at is null),
  (select string_agg(concat_ws(' ', r.invoice_number, r.amount_ht, r.reason, r.first_seen_at), ' ; ') from public.pennylane_a_rattacher r, s where (r.show_id = s.id or r.pennylane_id = '34170228875264') and r.resolved_at is null)
union all select 6, 'aucune écriture de la synchronisation sur les deux lignes depuis l''opération (hors paiement réel Pennylane)',
  not exists (select 1 from public.finance_log f, op where f.at > op.at and f.actor = 'service_role' and f.field <> 'paid_at'
                and f.row_id in ((select id from a), (select id from so))),
  (select string_agg(concat_ws(':', f.at, f.field, f.old_value, f.new_value), ' ; ') from public.finance_log f, op where f.at > op.at and f.actor = 'service_role'
     and f.row_id in ((select id from a), (select id from so)))
union all select 7, 'solde jamais marqué payé', (select paid_at is null from so), (select coalesce(paid_at::text, '—') from so)
union all select 8, 'rappel « Facture de solde à faire » le 25/11, aucun « Facture à envoyer » du solde',
  (select count(*) filter (where c.r = 'solde_envoi' and c.raw = date '2026-11-25') = 1
      and count(*) filter (where c.r = 'facture_envoi' and c.k = (select id from s) || ':' || (select id from so)) = 0
     from public.reminder_candidates((select id from s), true) c),
  (select string_agg(c.r || ':' || c.raw, ' ; ') from public.reminder_candidates((select id from s), true) c where c.r in ('solde_envoi', 'facture_envoi'))
union all select 9, 'notification « Facture à envoyer » du solde toujours retirée, aucune active',
  not exists (select 1 from public.notifications n, s, so where n.show_id = s.id and n.kind = 'facture_envoi' and n.withdrawn_at is null and n.dedupe_key like 'facture_envoi:' || s.id || ':' || so.id || ':%'),
  (select string_agg(n.dedupe_key || coalesce(' retirée ' || n.withdrawn_at, ' ACTIVE'), ' ; ') from public.notifications n, s where n.show_id = s.id and n.kind = 'facture_envoi')
order by 1;
