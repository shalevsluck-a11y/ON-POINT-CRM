-- Fix: dispatcher_can_access_job() defaulted to allow-all when a dispatcher's
-- allowed_lead_sources was NULL/empty ("backward compatibility"). In practice
-- this means every dispatcher created through the normal Add User flow --
-- which never sets allowed_lead_sources -- starts with unrestricted read
-- access to every job's full financials (owner_payout, contractor_fee,
-- job_total) until an admin separately visits a different screen to scope
-- them. Confirmed live: "Dispatcher One" and "Dispatcher Two" currently sit
-- in exactly this state. Flip the default to deny, matching the operator's
-- explicit intent ("make sure they don't see all the info").
CREATE OR REPLACE FUNCTION public.dispatcher_can_access_job(job_source text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  user_role TEXT;
  allowed_sources TEXT[];
  source_name TEXT;
BEGIN
  user_role := get_user_role();
  IF user_role != 'dispatcher' THEN
    RETURN FALSE;
  END IF;

  SELECT allowed_lead_sources INTO allowed_sources
  FROM profiles WHERE id = auth.uid();

  -- No restrictions configured: DENY by default (was: allow all).
  -- A dispatcher must be explicitly scoped to one or more lead sources
  -- before they can see anything.
  IF allowed_sources IS NULL OR array_length(allowed_sources, 1) IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Direct match: source already a name
  IF job_source = ANY(allowed_sources) THEN
    RETURN TRUE;
  END IF;

  -- Special case
  IF job_source = 'my_lead' THEN
    RETURN 'my_lead' = ANY(allowed_sources);
  END IF;

  -- Legacy id-based lookup
  SELECT ls->>'name' INTO source_name
  FROM app_settings, jsonb_array_elements(lead_sources) ls
  WHERE ls->>'id' = job_source
  LIMIT 1;
  IF source_name IS NOT NULL AND source_name = ANY(allowed_sources) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION public.dispatcher_can_access_job IS
  'Deny-by-default: a dispatcher with no allowed_lead_sources configured sees nothing, not everything.';
