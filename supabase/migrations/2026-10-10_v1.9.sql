-- v1.9 — photo recadrée, TVA par date / par ligne, date de relance, acompte 50 / 50 par défaut
alter table projects add column if not exists photo_orig text;        -- image d'origine (photo_path = carré recadré)
alter table show_payments add column if not exists reminded_at date;   -- dernière relance de paiement
alter table show_payments add column if not exists vat_rate numeric;   -- TVA de la ligne (sinon 5,5 % cachet / 20 % commission)
alter table shows add column if not exists vat_rate numeric;           -- TVA du cachet (sinon 5,5 %)
update settings set value = '50'::jsonb where key in ('default_acompte_pct','default_solde_pct');
-- generate_reminders : relance de paiement 10 j après l'envoi OU la dernière relance (greatest(sent_at, reminded_at))
