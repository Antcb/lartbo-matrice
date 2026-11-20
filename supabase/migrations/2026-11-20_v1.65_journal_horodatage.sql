-- v1.65 — Chronologie du journal des suivis : heure RÉELLE d'une entrée (envoi / réception du mail).
-- prospect_logs.date reste la date simple (jour) ; nouvelle colonne prospect_logs.occurred_at (horodatage), remplie :
--   - par la messagerie (mail_journal ci-dessous) : sent_at du message (date Gmail) ;
--   - par un mail déposé (.eml ou lien « message: ») : en-tête Date du mail (js/data.js mailToJournal).
-- Tri : js/selectors.js (logWhen, logOrder) et supabase/functions/resume-suivi/index.ts (journalOrder) — repli explicite si absente.
-- AUCUNE donnée existante n'est modifiée par cette migration (colonne ajoutée vide) ; la reprise des entrées existantes est une
-- opération séparée, à valider par Anthony : supabase/operations/2026-11-20_v1.65_reprise_horodatage.sql.
-- Rejouable (if not exists / create or replace). Ordre : cette migration, PUIS l'application et la fonction resume-suivi v1.65.
begin;

alter table public.prospect_logs add column if not exists occurred_at timestamptz;
comment on column public.prospect_logs.occurred_at is
  'v1.65 : heure réelle de l''échange (mail : envoi / réception) ; vide = inconnue (tri : heure d''enregistrement si même jour, sinon fin du jour)';

-- Fonction réécrite ENTIÈRE (CONVENTIONS §7.5) à partir de la version en production (v1.61) : seul ajout, occurred_at = sent_at
-- (ligne créée), ou complété s'il est vide (ligne existante reliée au message).
create or replace function public.mail_journal(p_thread uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t mail_threads%rowtype; m record; log_id uuid; n int := 0;
begin
  select * into t from mail_threads where id = p_thread;
  if not found or t.prospect_id is null then return 0; end if;
  for m in select * from mail_messages where thread_id = p_thread and prospect_log_id is null order by sent_at for update loop
    -- mail envoyé depuis L'ArtBotrice : déjà au journal. Reconnu par son identifiant Gmail ; pour les lignes d'avant la v1.61 (sans
    -- identifiant), par une ligne « Mail » du même suivi écrite par l'équipe le même jour (ou brouillon sans date), pas encore reliée.
    log_id := null;
    -- mail déjà joint au suivi par une dépose (Apple Mail, .eml : clé « msgid:<Message-ID> », v1.60.4) : relié, jamais réécrit
    -- (v1.65 : seule l'heure réelle est complétée si elle manque)
    if m.rfc_message_id is not null then
      select l.id into log_id from prospect_logs l where l.prospect_id = t.prospect_id and l.import_key = 'msgid:' || m.rfc_message_id limit 1;
      if log_id is not null then
        update mail_messages set prospect_log_id = log_id where id = m.id;
        update prospect_logs set occurred_at = m.sent_at where id = log_id and occurred_at is null and m.sent_at is not null;
        perform public.mail_suspend(m.id, t.prospect_id);
        continue;
      end if;
    end if;
    if m.direction = 'out' then
      select l.id into log_id from prospect_logs l where l.prospect_id = t.prospect_id and l.gmail_message_id = m.gmail_message_id limit 1;
      if log_id is null then
        select l.id into log_id from prospect_logs l
          where l.prospect_id = t.prospect_id and l.kind = 'Mail' and coalesce(l.author, '') <> 'Messagerie' and l.gmail_message_id is null
            and l.body like '**%'   -- ligne écrite par un envoi de L'ArtBotrice (« **Prospection… », « **Relance… », « **… envoyée** »), jamais une note
            and (l.date is null or l.date = (coalesce(m.sent_at, now()) at time zone 'Europe/Paris')::date)
            and l.created_at <= coalesce(m.sent_at, now()) + interval '1 day'
            and not exists (select 1 from mail_messages x where x.prospect_log_id = l.id)
          order by l.created_at desc limit 1;
      end if;
      if log_id is not null then
        update mail_messages set prospect_log_id = log_id where id = m.id;
        update prospect_logs set gmail_message_id = m.gmail_message_id where id = log_id and gmail_message_id is null;
        update prospect_logs set occurred_at = m.sent_at where id = log_id and occurred_at is null and m.sent_at is not null;
        continue;
      end if;
    end if;
    -- clé « msgid:<Message-ID> » posée quand elle est libre : une dépose ultérieure du même mail la reconnaît (aucun doublon)
    insert into prospect_logs (prospect_id, date, kind, contact_name, body, author, gmail_message_id, import_key, occurred_at)
    values (t.prospect_id, (coalesce(m.sent_at, now()) at time zone 'Europe/Paris')::date, 'Mail',
      case when m.direction = 'in' then coalesce(nullif(m.from_name, ''), m.from_addr) end,
      (case m.auto_kind when 'ndr' then 'Avis de non-remise — ' when 'auto' then 'Réponse automatique — ' else '' end)
        || (case when m.direction = 'in' then 'Mail reçu de ' || coalesce(m.from_addr, '?') else 'Mail envoyé à ' || array_to_string(m.to_addrs || m.cc_addrs, ', ') end)
        || ' — « ' || coalesce(m.subject, '') || ' »'
        || coalesce(' — pièces jointes : ' || (select string_agg(a->>'name', ', ') from jsonb_array_elements(m.attachments) a
             where not coalesce((a->>'inline')::boolean, false)), '')   -- images intégrées au texte : pas des pièces jointes
        || case when coalesce(m.snippet, '') <> '' then E'\n' || m.snippet else '' end,
      'Messagerie', m.gmail_message_id,
      case when m.rfc_message_id is not null and not exists (select 1 from prospect_logs k where k.import_key = 'msgid:' || m.rfc_message_id)
           then 'msgid:' || m.rfc_message_id end,
      m.sent_at)
    returning id into log_id;
    update mail_messages set prospect_log_id = log_id where id = m.id;
    n := n + 1;
    -- réponse reçue : relances automatiques ouvertes du suivi, créées AVANT ce message, suspendues (annulées avec la raison), signalée
    perform public.mail_suspend(m.id, t.prospect_id);
  end loop;
  return n;
end $function$;

commit;
