#!/bin/bash
# Apply migration 044 via Supabase Management API

SUPABASE_URL="https://api.onpointprodoors.com"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tbXBlbWpjbm5jamZwb295dHB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUxNTgzMTAsImV4cCI6MjA2MDczNDMxMH0.0pCfTKtKZwKp4KfFj6TtBNe7CqYmJjw93x2lSMw4uSI"

SQL=$(cat supabase/migrations/044_apply_technicians_and_rpc.sql)

curl -X POST "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | jq -Rs .)}"
