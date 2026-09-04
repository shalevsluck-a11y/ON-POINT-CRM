-- 047 — Stop the public (anon) key from reading customer data.
--
-- PROVEN 2026-09-04: GET /rest/v1/jobs?select=* with only the public anon key
-- (which ships in js/supabase-client.js) returned all 142 jobs — customer
-- names, phone numbers, addresses. Every other table (profiles, job_zelle,
-- app_settings, notifications, push_subscriptions) already denies anon; only
-- `jobs` leaked.
--
-- Revoking the table grant from the anon role is the guaranteed fix: PostgREST
-- runs anon requests as the `anon` DB role, so with no grant it can read
-- nothing, whatever the policies say. The `authenticated` role keeps its grant,
-- so the logged-in app (and realtime) are unaffected.

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jobs FROM anon;

-- Belt and suspenders: make sure no policy targets the anon role.
DROP POLICY IF EXISTS jobs_anon_select ON public.jobs;
