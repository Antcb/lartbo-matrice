CREATE OR REPLACE FUNCTION public.pennylane_status()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select false $function$
