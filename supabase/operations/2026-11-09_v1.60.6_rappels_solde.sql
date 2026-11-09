-- v1.60.6 — Rappels « Facture à envoyer » d'une facture de SOLDE déjà créés trop tôt (avant le jour ouvré de J-7).
-- À exécuter APRÈS la migration supabase/migrations/2026-11-09_v1.60.6_solde_j7.sql, sur autorisation d'Anthony.
-- Cas connu au 09/11/2026 : un seul (« Facture à envoyer : Solde (F-AB-2026-11-107) — Brise Glace », concert du 02/12).
--
-- Ce que fait ce script :
--  1. INVENTAIRE en lecture seule (à lancer d'abord, seul) : notifications « facture_envoi » actives dont l'échéance, selon la règle
--     v1.60.6 (reminder_candidates), est encore à venir — donc créées avant leur date.
--  2. RETRAIT (une transaction, gardée) : withdrawn_at + motif clair ; la notification est GARDÉE (jamais supprimée) et sort de la
--     liste active (js/selectors.js activeNotifs) et du récapitulatif quotidien (apps-script/Code.gs : withdrawn_at=is.null).
--     Sa clé anti-doublon reçoit le suffixe « :retire-v1.60.6 » (clé d'origine lisible avant le suffixe).
--
-- Pourquoi le suffixe (mécanisme dedupe_key de generate_reminders) : generate_reminders insère chaque jour (5 h UTC) les relances dues
-- avec la clé règle:clé:échéance brute[:a<réactivation>] et « on conflict (dedupe_key) do nothing » ; la colonne est UNIQUE et une
-- notification retirée garde sa clé. Pour « Facture à envoyer », l'échéance brute de la clé reste « facture faite + 3 j » (la v1.60.6
-- ne change que le jour d'envoi, par un plancher). Sans suffixe, la notification retirée bloquerait donc pour toujours le rappel à J-7 ;
-- avec le suffixe, generate_reminders la recrée UNE seule fois, au jour ouvré de J-7 (clé d'origine, puis conflit les jours suivants),
-- tant que la facture n'a ni date d'envoi ni paiement. Pas de rattrapage immédiat : la garde vérifie que la règle v1.60.6 est en place
-- (sinon l'ancienne règle recréerait le rappel dès le lendemain matin) et seules les notifications dont l'échéance est à venir sont
-- retirées. Rejouable sans effet : une deuxième exécution trouve 0 ligne et s'arrête sans rien modifier.
--
-- Ne touche à AUCUNE facture (show_payments), échéance contractuelle, condition particulière d'une date ni document envoyé : seule la
-- table notifications est modifiée (withdrawn_at, withdrawn_reason, dedupe_key des lignes retirées).

-- ─────────────── 1. Inventaire (lecture seule) ───────────────
with c as (
  select c.*, c.r || ':' || c.k || ':' || c.raw || coalesce(':a' || c.reactiv, '') cle,
         greatest(public.workday(c.raw), (c.nxt ->> c.r)::date) echeance
  from public.reminder_candidates(null, true) c where c.r = 'facture_envoi'
)
select n.id, n.created_at, n.title, n.dedupe_key, n.emailed_at, c.date concert, c.echeance nouvelle_echeance
from public.notifications n join c on c.cle = n.dedupe_key
where n.kind = 'facture_envoi' and n.withdrawn_at is null and c.echeance > (now() at time zone 'Europe/Paris')::date
order by c.echeance;

-- ─────────────── 2. Retrait (après lecture de l'inventaire) ───────────────
-- « attendu » = nombre de lignes de l'inventaire ci-dessus (1 au 09/11/2026) : arrêt sans rien changer s'il diffère.
do $op$
declare attendu int := 1; n int; b text;
begin
  b := pg_get_functiondef('public.reminder_candidates(uuid,boolean)'::regprocedure);
  if position('v1.60.6 solde J-7' in b) = 0 then
    raise exception 'v1.60.6 : la migration 2026-11-09_v1.60.6_solde_j7.sql n''est pas appliquée : opération arrêtée, rien n''est modifié';
  end if;
  with c as (
    select c.r || ':' || c.k || ':' || c.raw || coalesce(':a' || c.reactiv, '') cle,
           greatest(public.workday(c.raw), (c.nxt ->> c.r)::date) echeance
    from public.reminder_candidates(null, true) c where c.r = 'facture_envoi'
  ), cible as (
    select n.id, c.echeance from public.notifications n join c on c.cle = n.dedupe_key
    where n.kind = 'facture_envoi' and n.withdrawn_at is null and c.echeance > (now() at time zone 'Europe/Paris')::date
  ), maj as (
    update public.notifications n
       set withdrawn_at = now(),
           withdrawn_reason = 'v1.60.6 : rappel créé trop tôt — la facture de solde s''envoie à J-7 ; il reviendra le '
                              || to_char(cible.echeance, 'DD/MM/YYYY'),
           dedupe_key = n.dedupe_key || ':retire-v1.60.6'
      from cible where n.id = cible.id
    returning 1
  ) select count(*) into n from maj;
  if n <> attendu then
    raise exception 'v1.60.6 : % notification(s) à retirer au lieu de % attendue(s) : opération annulée, rien n''est modifié', n, attendu;
  end if;
  raise notice 'v1.60.6 : % notification(s) retirée(s)', n;
end $op$;

-- ─────────────── 3. Contrôle (lecture seule) ───────────────
-- select id, title, withdrawn_at, withdrawn_reason, dedupe_key from public.notifications where dedupe_key like '%:retire-v1.60.6';
