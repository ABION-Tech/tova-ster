#!/usr/bin/env bash
# Exercises the Stage 3 exit condition against a real running server:
# register -> me -> logout -> me(401) -> login -> duplicate register(409) ->
# wrong password(401) -> guest cart persists across two separate requests.
#
# Usage: BASE_URL=http://localhost:4000 ./scripts/smoke-test-auth.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

EMAIL="stage3-smoke-$(date +%s)@example.com"
PASSWORD="correct-horse-battery-staple"

pass() { echo "  ok: $1"; }
fail() { echo "  FAIL: $1"; exit 1; }

expect_status() {
  local expected="$1" actual="$2" label="$3"
  if [ "$actual" != "$expected" ]; then
    fail "$label — expected HTTP $expected, got $actual"
  fi
  pass "$label ($actual)"
}

echo "== register =="
CODE=$(curl -s -o "$WORKDIR/register.json" -w '%{http_code}' \
  -c "$WORKDIR/user.cookies" -X POST "$BASE_URL/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"firstName\":\"Stage3\",\"lastName\":\"Smoke\"}")
expect_status 201 "$CODE" "register returns 201"
grep -q "\"emailVerified\":false" "$WORKDIR/register.json" || fail "new account should start unverified"
pass "new account starts unverified (non-blocking verification)"

echo "== duplicate register is rejected =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"firstName\":\"Stage3\",\"lastName\":\"Smoke\"}")
expect_status 409 "$CODE" "duplicate email rejected"

echo "== /auth/me while logged in =="
CODE=$(curl -s -o "$WORKDIR/me.json" -w '%{http_code}' -b "$WORKDIR/user.cookies" "$BASE_URL/auth/me")
expect_status 200 "$CODE" "me returns 200 with session cookie"
grep -q "\"email\":\"$EMAIL\"" "$WORKDIR/me.json" || fail "me should return the registered email"

echo "== logout =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$WORKDIR/user.cookies" -c "$WORKDIR/user.cookies" \
  -X POST "$BASE_URL/auth/logout")
expect_status 200 "$CODE" "logout returns 200"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$WORKDIR/user.cookies" "$BASE_URL/auth/me")
expect_status 401 "$CODE" "me returns 401 after logout"

echo "== login with wrong password =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}")
expect_status 401 "$CODE" "wrong password rejected"

echo "== login with correct password =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$WORKDIR/user.cookies" -X POST "$BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
expect_status 200 "$CODE" "correct password accepted"

echo "== guest cart persists across requests (no login) =="
curl -s -c "$WORKDIR/guest.cookies" "$BASE_URL/cart" > "$WORKDIR/cart1.json"
CART_ID_1=$(grep -o '"id":"[^"]*"' "$WORKDIR/cart1.json" | head -1)
curl -s -b "$WORKDIR/guest.cookies" -c "$WORKDIR/guest.cookies" "$BASE_URL/cart" > "$WORKDIR/cart2.json"
CART_ID_2=$(grep -o '"id":"[^"]*"' "$WORKDIR/cart2.json" | head -1)
[ -n "$CART_ID_1" ] || fail "first /cart call returned no cart id"
[ "$CART_ID_1" = "$CART_ID_2" ] || fail "guest cart id changed between requests ($CART_ID_1 vs $CART_ID_2)"
pass "same guest cart id returned across two separate requests"

echo
echo "All Stage 3 auth/cart smoke checks passed."
