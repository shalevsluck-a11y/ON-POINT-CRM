#!/bin/bash

# Test that the endpoints exist and respond correctly to unauthenticated requests
API_BASE="https://crm.onpointprodoors.com"

echo "==========================================="
echo "Testing Endpoint Availability (No Auth)"
echo "==========================================="
echo ""

# Test 1: Create user without auth should return 401
echo "TEST 1: POST /admin/create-user (no auth)"
echo "-------------------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/admin/create-user" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@test.com","role":"dispatcher"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" -eq 401 ]; then
  echo "✓ Correctly returns 401 Unauthorized"
else
  echo "✗ Expected 401, got $HTTP_CODE"
  exit 1
fi

echo ""

# Test 2: Delete user without auth should return 401
echo "TEST 2: DELETE /admin/delete-user/:id (no auth)"
echo "-------------------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_BASE/admin/delete-user/test-id")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" -eq 401 ]; then
  echo "✓ Correctly returns 401 Unauthorized"
else
  echo "✗ Expected 401, got $HTTP_CODE"
  exit 1
fi

echo ""

# Test 3: Create user with invalid token should return 401
echo "TEST 3: POST /admin/create-user (invalid token)"
echo "-------------------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/admin/create-user" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token-123" \
  -d '{"name":"Test","email":"test@test.com","role":"dispatcher"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" -eq 401 ]; then
  echo "✓ Correctly returns 401 Unauthorized"
else
  echo "✗ Expected 401, got $HTTP_CODE"
  exit 1
fi

echo ""
echo "==========================================="
echo "✅ ALL ENDPOINT TESTS PASSED"
echo "==========================================="
echo ""
echo "Endpoints exist and return correct error codes."
echo "To test with valid auth, run:"
echo "  1. node tests/get-admin-token.js"
echo "  2. tests/test-user-api.sh <TOKEN>"
