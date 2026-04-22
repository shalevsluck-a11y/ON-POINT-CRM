-- ON-POINT CRM Data Export from Supabase Cloud
-- Source: https://nmmpemjcnncjfpooytpv.supabase.co
-- Export Date: 2026-04-22 03:48 UTC
--
-- This file contains all data from the production database
-- to be imported into the self-hosted Supabase instance.

-- ============================================
-- TABLE: profiles (3 rows)
-- ============================================
INSERT INTO profiles (id, name, phone, role, color, zelle_handle, zip_codes, default_tech_percent, is_owner, created_at, updated_at, assigned_lead_source) VALUES
('83cd5cbb-b983-449a-af54-a69cf516db55', 'mami', '', 'tech', '#3B82F6', '', '{}', 40.00, false, '2026-04-21 22:03:49.410115+00', '2026-04-21 22:03:49.494725+00', NULL),
('a306db51-20e0-40c5-9258-1634d4c9079b', 'solomon', '', 'admin', '#3b82f6', '', '{}', 50.00, true, '2026-04-20 17:42:29.757971+00', '2026-04-20 19:18:22.775315+00', NULL),
('a4418815-3887-40b6-9bbe-a1365d9a4312', 'gere', '', 'tech', '#3B82F6', '', '{}', 40.00, false, '2026-04-22 00:30:11.538602+00', '2026-04-22 00:30:11.733209+00', NULL);

-- ============================================
-- TABLE: app_settings (1 row)
-- ============================================
INSERT INTO app_settings (id, owner_name, owner_phone, owner_zelle, tax_rate_ny, tax_rate_nj, default_state, apps_script_url, lead_sources, updated_at) VALUES
(1, 'Solomon', '(929) 429-2429', '', 8.875, 6.625, 'NY', 'https://script.google.com/macros/s/AKfycbxtQTugHHrsf47H3ZdOEZpygPF-ha7no0sbPMYp5OUf-uKG3T_58ldswnL1uhVMV1HZ/exec', '[{"id":"mo8zajhqWTUHR","name":"SONART CONSTRUCTION","contractorPercent":50}]'::jsonb, '2026-04-20 15:49:16.503559+00');

-- ============================================
-- TABLE: jobs (9 rows)
-- ============================================
INSERT INTO jobs (job_id, status, customer_name, phone, address, city, state, zip, scheduled_date, scheduled_time, description, notes, source, contractor_name, contractor_pct, assigned_tech_id, assigned_tech_name, is_self_assigned, tech_percent, estimated_total, job_total, parts_cost, tax_amount, tax_option, tech_payout, owner_payout, contractor_fee, payment_method, paid_at, sync_status, synced_at, photos, raw_lead, is_recurring_customer, overdue_flagged_at, follow_up_at, created_by, created_at, updated_at, owner_pct) VALUES
('1e1db99a-48e9-4dbd-8f11-a3c4caf4964b', 'in_progress', 'Bob Williams', '5554567890', '9012 Pine Road', 'Tempe', 'AZ', '85281', '2026-04-21', '11:00:00', 'Locksmith', 'Locked out of home. Lost keys.', 'my_lead', '', 0.00, '83cd5cbb-b983-449a-af54-a69cf516db55', 'mami', false, 45.00, 180.00, 0.00, 25.00, 0.00, 'none', 0.00, 0.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, NULL, '2026-04-20 23:17:22.223352+00', '2026-04-22 01:02:47.848067+00', 0),
('25f5e2f8-4916-43bb-8761-722b49812201', 'new', 'John Martinez', '5551234567', '1234 Oak Street', 'Phoenix', 'AZ', '85001', '2026-04-21', '09:00:00', 'Garage Door Repair', 'Broken spring on double car garage. Customer says very loud noise.', 'my_lead', '', 0.00, 'a4418815-3887-40b6-9bbe-a1365d9a4312', 'gere', false, 40.00, 350.00, 0.00, 45.00, 0.00, 'none', 0.00, 0.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, NULL, '2026-04-20 23:17:22.223352+00', '2026-04-22 01:02:43.761745+00', 0),
('53f5a8d5-13b8-4d48-8768-10e8cbe4d322', 'scheduled', 'Sarah Johnson', '5559876543', '5678 Maple Ave', 'Scottsdale', 'AZ', '85251', '2026-04-21', '14:00:00', 'Garage Door Installation', 'New 16x7 steel door. Customer wants white finish.', 'my_lead', '', 0.00, 'a4418815-3887-40b6-9bbe-a1365d9a4312', 'gere', false, 35.00, 1200.00, 0.00, 450.00, 0.00, 'none', 0.00, 0.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, NULL, '2026-04-20 23:17:22.223352+00', '2026-04-22 01:02:43.761745+00', 0),
('cf68a0a3-4665-4238-bca1-bd806f41de45', 'closed', 'Lisa Chen', '5552345678', '3456 Elm Drive', 'Mesa', 'AZ', '85201', '2026-04-20', '10:00:00', 'Garage Door Tune-Up', 'Annual maintenance. Replaced rollers and lubricated.', 'my_lead', '', 0.00, 'a4418815-3887-40b6-9bbe-a1365d9a4312', 'gere', false, 40.00, 150.00, 0.00, 20.00, 0.00, 'none', 0.00, 0.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, NULL, '2026-04-20 23:17:22.223352+00', '2026-04-22 01:02:43.761745+00', 0),
('fd2f7c7c-a5a2-402d-a567-0ba5f3afdf28', 'new', 'Carlos Ruiz', '5555678901', '6789 Walnut Lane', 'Peoria', 'AZ', '85345', '2026-04-22', '13:00:00', 'Garage Door Installation', 'Replace full door and opener. Wants smart opener.', 'my_lead', '', 0.00, '83cd5cbb-b983-449a-af54-a69cf516db55', 'mami', false, 35.00, 1800.00, 0.00, 600.00, 0.00, 'none', 0.00, 0.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, NULL, '2026-04-20 23:17:22.223352+00', '2026-04-22 02:11:51.427254+00', 0),
('mo7u4cek53ZZ6', 'scheduled', 'Test Customer Sharingan', '(555) 000-0999', '999 Test Ave', 'Phoenix', 'NY', '85001', '2026-04-21', '10:00:00', '', '', 'my_lead', '', 0.00, 'a4418815-3887-40b6-9bbe-a1365d9a4312', 'gere', false, 40.00, 500.00, 0.00, 75.00, 0.00, 'none', 170.00, 255.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, NULL, '2026-04-20 23:37:20.618558+00', '2026-04-22 01:02:43.761745+00', 0),
('TEST-CONT-001', 'scheduled', 'Carol White', '5552223333', '789 Pine Rd', 'Orlando', 'FL', '32803', '2026-04-22', NULL, 'Full door replacement', '', 'Google', '', 0.00, '83cd5cbb-b983-449a-af54-a69cf516db55', 'mami', false, 40.00, 800.00, 800.00, 0.00, 0.00, 'none', 0.00, 480.00, 320.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, 'a306db51-20e0-40c5-9258-1634d4c9079b', '2026-04-21 18:31:42.88853+00', '2026-04-22 01:02:47.848067+00', 0),
('TEST-DISP-001', 'scheduled', 'Bob Jones', '5559876543', '456 Oak Ave', 'Orlando', 'FL', '32802', '2026-04-22', NULL, 'Garage door opener installation', '', 'Referral', '', 0.00, NULL, NULL, false, 60.00, 500.00, 500.00, 0.00, 0.00, 'none', 0.00, 500.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, 'a306db51-20e0-40c5-9258-1634d4c9079b', '2026-04-21 18:31:42.88853+00', '2026-04-21 18:31:42.88853+00', 0),
('TEST-TECH-001', 'scheduled', 'Alice Smith', '5551234567', '123 Main St', 'Orlando', 'FL', '32801', '2026-04-22', NULL, 'Replace garage door spring', '', 'Google', '', 0.00, 'a4418815-3887-40b6-9bbe-a1365d9a4312', 'gere', false, 60.00, 350.00, 350.00, 0.00, 0.00, 'none', 210.00, 140.00, 0.00, 'cash', NULL, 'pending', NULL, '{}', '', false, NULL, NULL, 'a306db51-20e0-40c5-9258-1634d4c9079b', '2026-04-21 18:31:42.88853+00', '2026-04-22 01:02:43.761745+00', 0);

-- ============================================
-- TABLE: push_subscriptions (1 row)
-- ============================================
INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_key, created_at) VALUES
('b4240932-a57c-4061-8bc3-6a3f02d8fecb', 'a306db51-20e0-40c5-9258-1634d4c9079b', 'https://web.push.apple.com/QLQy8qJzi1wN7VKviIMH6_69xpFmqTEQHF2NnZHsMIHAwkluk5dCGjjK34lf0C41sS__cUka0plo33Y2xpOs9yYnnXkyGtdiVdWTqF5gQMJGSmKPX3dscprO7QJFBYjm0loRa3Gj08feMjktC6FV598Eh-VNW72BaTrW8AcPjI0', 'BK5cgO41ggMyb394BRJAZbpeSmOubAuYSbAOwJu0WAfA6E4aeNAc5tcF9Vex_hAjauDLnFoDqkFi_oUWAWpMG9E', 'REOhveaa3pokcrzywDQGLA', '2026-04-22 02:50:40.2953+00');

-- ============================================
-- TABLE: app_config (2 rows)
-- ============================================
-- NOTE: These values will need to be updated after import to point to self-hosted instance
INSERT INTO app_config (key, value, updated_at) VALUES
('supabase_url', 'https://nmmpemjcnncjfpooytpv.supabase.co', '2026-04-22 02:06:10.950772+00'),
('service_role_key', '***REDACTED-SUPABASE-SERVICE-KEY-2***', '2026-04-22 02:06:10.950772+00');

-- ============================================
-- IMPORT INSTRUCTIONS
-- ============================================
-- 1. Ensure all migrations are applied to self-hosted instance first
-- 2. Import this file: psql -h localhost -p 5432 -U postgres -d postgres -f data-export.sql
-- 3. Update app_config table with new self-hosted URLs and keys
-- 4. Verify row counts match source:
--    - profiles: 3 rows
--    - jobs: 9 rows
--    - app_settings: 1 row
--    - push_subscriptions: 1 row
--    - app_config: 2 rows
-- 5. Test login with existing user credentials
