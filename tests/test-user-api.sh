#!/bin/bash

# Test script for user management API endpoints
# Usage: ./test-user-api.sh <JWT_TOKEN>

if [ -z "$1" ]; then
  echo "ERROR: No JWT token provided"
  echo ""
  echo "To get a token:"
  echo "1. Open https://crm.onpointprodoors.com in your browser"
  echo "2. Log in as admin"
  echo "3. Open DevTools Console (F12)"
  echo "4. Run: (await supabase.auth.getSession()).data.session.access_token"
  echo "5. Copy the token and run: ./test-user-api.sh <TOKEN>"
  exit 1
fi

TOKEN="$1"
API_BASE="https://crm.onpointprodoors.com"

echo "==========================================="
echo "Testing User Management API Endpoints"
echo "==========================================="
echo ""

# Test 1: Create a new dispatcher
echo "TEST 1: Create new dispatcher"
echo "-------------------------------------------"
TEST_NAME="Test Dispatcher $(date +%s)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/admin/create-user" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"$TEST_NAME\",\"email\":\"test.$(date +%s)@onpointprodoors.com\",\"role\":\"dispatcher\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "✓ User creation succeeded"
  USER_ID=$(echo "$BODY" | grep -o '"userId":"[^"]*' | cut -d'"' -f4)
  MAGIC_LINK=$(echo "$BODY" | grep -o '"magicLink":"[^"]*' | cut -d'"' -f4)
  echo "✓ User ID: $USER_ID"
  echo "✓ Magic Link: ${MAGIC_LINK:0:50}..."
else
  echo "✗ User creation failed"
  exit 1
fi

echo ""

# Test 2: Delete the user
echo "TEST 2: Delete dispatcher"
echo "-------------------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_BASE/admin/delete-user/$USER_ID" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "✓ User deletion succeeded"
else
  echo "✗ User deletion failed"
  exit 1
fi

echo ""
echo "==========================================="
echo "✅ ALL TESTS PASSED"
echo "==========================================="
