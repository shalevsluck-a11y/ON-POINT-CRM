-- 053: how the customer found us (Google, Yelp, Marketplace, ...). Applied via Supabase MCP 2026-11-23.
alter table public.jobs add column if not exists lead_channel text;
notify pgrst, 'reload schema';
