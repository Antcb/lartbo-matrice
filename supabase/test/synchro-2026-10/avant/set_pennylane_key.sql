CREATE OR REPLACE FUNCTION public.set_pennylane_key(k text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$ begin raise exception 'Pennylane n’est pas branché dans l’espace de test'; end $function$
