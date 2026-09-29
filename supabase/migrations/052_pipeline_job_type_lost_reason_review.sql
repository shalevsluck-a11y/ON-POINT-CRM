-- 052: funnel + reporting fields (CRM overhaul 2026-09-29). Applied via Supabase MCP.
alter table public.jobs
  add column if not exists job_type            text,
  add column if not exists lost_reason         text,
  add column if not exists lost_note           text,
  add column if not exists lost_at             timestamptz,
  add column if not exists dispatched_at       timestamptz,
  add column if not exists dispatched_to       text,
  add column if not exists closing_details     text,
  add column if not exists review_requested_at timestamptz,
  add column if not exists follow_up_count     integer not null default 0,
  add column if not exists last_follow_up_at   timestamptz;

create index if not exists idx_jobs_job_type on public.jobs (job_type);

alter table public.app_settings
  add column if not exists job_types    jsonb not null default '[]'::jsonb,
  add column if not exists lost_reasons jsonb not null default '[]'::jsonb,
  add column if not exists review_link  text  not null default '';

-- Old lost jobs get an approximate lost date so lost-by-period reports work.
update public.jobs set lost_at = coalesce(updated_at, created_at) where status = 'lost' and lost_at is null;

notify pgrst, 'reload schema';
