#!/bin/bash
# Automated Edge Function Deployment
# Run once: npx supabase login (to get token)
# Then run: ./deploy-edge-function.sh

set -e

echo "🚀 Deploying update-technicians Edge Function..."

# Deploy using Supabase CLI
npx supabase functions deploy update-technicians \
  --project-ref nmmpemjcnncjfpooytpv \
  --no-verify-jwt

echo "✅ Function deployed successfully!"

# Test the function
echo "🧪 Testing function..."
RESPONSE=$(curl -s "https://api.onpointprodoors.com/functions/v1/update-technicians" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d '{"technicians":[]}')

if echo "$RESPONSE" | grep -q "Unauthorized"; then
  echo "✅ Function is working! (Returns Unauthorized as expected)"
  echo "🎉 Deployment complete - technician save should now work"
else
  echo "⚠️  Response: $RESPONSE"
  echo "If you see entrypoint error, the deployment failed"
fi
