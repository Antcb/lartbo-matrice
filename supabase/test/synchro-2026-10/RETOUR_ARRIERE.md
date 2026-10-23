# Retour arrière de `synchro_test.sql` (projet de TEST uniquement)

## 1. Pendant l'exécution : rien à faire
- Le script tient en **une seule transaction**.
- Toute erreur annule tout : garde-fou, objet existant incompatible, contrôle de fin.
- Le test reste alors exactement dans son état d'avant. Essai local : après un refus, ni la table, ni le déclencheur, ni la colonne n'existent.
- Condition : lancer le script **en un seul envoi** (outil Supabase) ou avec `psql -v ON_ERROR_STOP=1 -1`.

## 2. Après validation (`commit`) : revenir à l'état du 23/10
### Points importants
- **Suppressions dans le test** (déclencheurs, fonctions, index, table, colonne) : elles exigent l'**autorisation explicite d'Anthony** (CLAUDE.md §3, `CONVENTIONS.md` §7.8).
- **Préférer, si possible, une correction ciblée** à un retour arrière complet.
- **Données perdues** en cas de retour complet :
  - les lignes de `client_errors` écrites depuis ;
  - les marques `prod_mode_manual` posées depuis.

  Ces données sont fictives ou techniques.
- **`_push` n'est pas restaurable** dans sa version du test, et ce n'est pas souhaitable. Elle contenait une phrase secrète, que je n'ai ni lue ni conservée. Sa suppression était de toute façon proposée (R4). Elle reste dans sa version neutralisée.
- `is_team()` et `private.comptes_suspendus` ne sont **pas concernées** : le script ne les modifie pas.

### Script de retour (à relire, NON exécuté)
Même procédure : une transaction, en un seul envoi, garde-fou en tête.

```sql
begin;
-- garde-fou : projet de test uniquement (mêmes conditions 1 à 3 que synchro_test.sql)
do $$ begin
  if coalesce((select value #>> '{}' from public.settings where key = 'functions_base_url'), '') not like '%dthfocplfzzmkgaxhmwk%'
     or not exists (select 1 from auth.users where md5(lower(email)) = '541b1b492bd5b71a3ae333605615bff2')
     or to_regclass('private.comptes_suspendus') is null then
    raise exception 'Refus : ce n''est pas le projet de test'; end if;
end $$;

-- 1. déclencheurs ajoutés
drop trigger if exists contacts_clean on public.contacts;
drop trigger if exists structures_place_clean on public.structures;
drop trigger if exists project_mode_to_shows on public.projects;
drop trigger if exists show_follow_project_mode on public.shows;
drop trigger if exists show_mode_payments on public.shows;

-- 2. fonctions ajoutées (après les déclencheurs ; sans CASCADE : une dépendance imprévue fait échouer et tout annuler)
drop function if exists public.show_mode_payments();
drop function if exists public.show_follow_project_mode();
drop function if exists public.project_mode_to_shows();
drop function if exists public.contacts_clean();
drop function if exists public.structures_place_clean();
drop function if exists public.ensure_production_payments(uuid);
drop function if exists public.ensure_movinmotion(uuid);
drop function if exists public.clean_email(text);
drop function if exists public.clean_phone(text);
-- generate_reminders (production) appelle workday : la remettre en version test AVANT de supprimer workday (étape 3)

-- 3. fonctions remplacées : réappliquer les définitions du test relevées le 23/10, md5 vérifiés, sans secret :
--    supabase/test/synchro-2026-10/avant/{artist_info_save,brevo_queue,generate_reminders,pennylane_status,set_pennylane_key}.sql
--    (coller ici leur contenu, chacun suivi d'un point-virgule)
drop function if exists public.workday(date);

-- 4. droits d'exécution d'avant (tous ouverts à public, anon, authenticated, service_role dans le test du 23/10)
grant execute on function public.generate_reminders(), public.import_secret(text), public.on_show_confirmed(), public.brevo_queue(uuid),
  public._push(text), public.ai_key_status(), public.mail_vars(uuid, uuid), public.request_drive_folder(uuid), public.set_ai_key(text),
  public.pennylane_status(), public.set_pennylane_key(text), public.fiche_get(text), public.fiche_submit(text, jsonb, jsonb),
  public.rh_get(text), public.rh_submit(text, jsonb, jsonb, jsonb)
  to public, anon, authenticated, service_role;
-- (rouvre le risque R3 : à ne faire que si le retour complet est vraiment voulu)

-- 5. index
drop index if exists public.budget_lines_one_auto;
drop index if exists public.budget_lines_project;
drop index if exists public.budget_lines_show;

-- 6. table de diagnostic (perte des erreurs notées depuis)
drop table if exists public.client_errors;

-- 7. colonne (perte des marques « mode réglé à la main » posées depuis ; l'application 1.40.2 l'utilise)
alter table public.shows drop column if exists prod_mode_manual;

-- 8. coffre et espace de fichiers
alter table private.import_secrets alter column value drop not null;
update storage.buckets set file_size_limit = null where id = 'suivi';

-- 9. contrôles : verrou S1 intact, volumes du jeu fictif (à adapter si des données ont été ajoutées depuis)
do $$ begin
  if position('comptes_suspendus' in pg_get_functiondef('public.is_team()'::regprocedure)) = 0 then raise exception 'is_team sans verrou'; end if;
  if (select count(*) from public.projects) <> 4 or (select count(*) from public.contacts) <> 25 or (select count(*) from public.shows) <> 30 then
    raise exception 'volumes inattendus'; end if;
end $$;
commit;
```

## 3. Contrôle après retour arrière
- Relancer `b1/per_ord.sql` sur le test. Pour le test, retirer la section 17 : le schéma `cron` y est absent.
- Les empreintes doivent redevenir celles du 23/10 avant synchronisation :

| Section | Empreinte |
|---|---|
| 1 | `bcf1f086…` |
| 3 | `3728d5df…` |
| 4 | `d515d5a6…` |
| 6 | `a41f409b…` |
| 8 | `6eec5879…`* |
| 10 | `7c77c45a…` |
| 11 | `4adcdb51…` |
| 12 | `90b39c44…` |
| 13 | `2cacc227…` |
| 14 | `9c742de3…` |
| 18 | `2ff0c55d…` |

\* Sauf la section 8, qui restera différente à cause de `_push`, désormais neutralisée.

## 4. Vérifié / non vérifié
- **Essayé en local** sur PostgreSQL 16, sur la base synchronisée par `synchro_test.sql`, avec les 5 définitions de `avant/` insérées. Résultat : aucune erreur. Comparé à la base d'origine :
  - mêmes déclencheurs (10) ;
  - mêmes fonctions : nombre, texte, droits du propriétaire, `search_path` ;
  - même nombre de colonnes de `shows` (70) ;
  - `client_errors` absente ;
  - limite de `suivi` vide.

  Seule exception : `_push`, comme prévu.
- **Non vérifié** :
  - exécution sur le vrai projet de test ;
  - empreintes `per_ord.sql` après retour.
