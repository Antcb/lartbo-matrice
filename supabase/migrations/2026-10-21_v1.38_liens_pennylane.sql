-- v1.38.2 : liens Pennylane vers les PAGES de l'application (devis, factures) au lieu des PDF.
-- Les devis et factures déjà enregistrés sont convertis (société Pennylane L'ArtBoristerie Productions : 22190862).
update public.shows set pennylane_quote_url = 'https://app.pennylane.com/companies/22190862/clients/customer_estimates?estimate_id=' || pennylane_quote_id
 where pennylane_quote_id is not null and coalesce(pennylane_quote_url, '') not like '%customer_estimates%';
update public.show_payments set pennylane_url = 'https://app.pennylane.com/companies/22190862/clients/customer_invoices?invoice_id=' || pennylane_id || '&subtab=all'
 where pennylane_id is not null and coalesce(pennylane_url, '') not like '%customer_invoices%';
