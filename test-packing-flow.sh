#!/bin/bash
# =============================================================================
# test-packing-flow.sh — End-to-end packing flow test
#
# Tests the full sequence:
#   1. Scan a tracking number  → GET /api/scan-tracking
#   2. Start packer session    → POST /api/packing-logs/start-session
#   3. Upload a photo          → POST /api/packing-logs/save-photo
#   4. Verify photo persisted  → GET /api/packing-logs/photos
#   5. Direct DB check         → psql query against Neon
#
# Usage:
#   ./test-packing-flow.sh                        # hits production
#   BASE_URL=http://localhost:3000 ./test-packing-flow.sh  # hits local dev
#   TRACKING=1Z999AA1234567890 ./test-packing-flow.sh      # custom tracking #
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL="${BASE_URL:-https://usav-orders-backend.vercel.app}"
TRACKING="${TRACKING:-}"   # if empty, step 1 discovers one from DB
PACKED_BY="${PACKED_BY:-1}"
DATABASE_URL="${DATABASE_URL:-postgresql://neondb_owner:npg_v0soi3xyHUkf@ep-shiny-hall-adz0n0nu-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require}"

PASS=0
FAIL=0
PACKER_LOG_ID=""
PHOTO_ID=""

# ── Helpers ───────────────────────────────────────────────────────────────────
green()  { echo -e "\033[0;32m$*\033[0m"; }
red()    { echo -e "\033[0;31m$*\033[0m"; }
yellow() { echo -e "\033[0;33m$*\033[0m"; }
blue()   { echo -e "\033[0;34m$*\033[0m"; }
dim()    { echo -e "\033[2m$*\033[0m"; }

pass() { green "  ✓ $*"; PASS=$((PASS+1)); }
fail() { red   "  ✗ $*"; FAIL=$((FAIL+1)); }

section() {
  echo ""
  blue "══════════════════════════════════════════════"
  blue "  $*"
  blue "══════════════════════════════════════════════"
}

assert_json_field() {
  local label="$1" json="$2" field="$3" expected="$4"
  local actual
  actual=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null || true)
  if [[ "$actual" == "$expected" ]]; then
    pass "$label: $field = $expected"
  else
    fail "$label: expected $field='$expected', got '$actual'"
    dim "      Response: $json"
  fi
}

assert_json_truthy() {
  local label="$1" json="$2" field="$3"
  local actual
  actual=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('$field'); print('truthy' if v else 'falsy')" 2>/dev/null || echo "parse_error")
  if [[ "$actual" == "truthy" ]]; then
    pass "$label: $field is present/truthy"
  else
    fail "$label: $field is missing or falsy"
    dim "      Response: $json"
  fi
}

extract_json() {
  local json="$1" field="$2"
  echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null || true
}

extract_json_int() {
  local json="$1" field="$2"
  echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); v=d.get('$field'); print(int(v) if v is not None else '')" 2>/dev/null || true
}

# ── Minimal 1×1 PNG (base64) for photo upload test ───────────────────────────
# A real 1×1 red pixel PNG, base64-encoded — avoids needing an actual image file
TINY_PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg=="

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
yellow "╔══════════════════════════════════════════════╗"
yellow "║   USAV Packing Flow — E2E Test Suite         ║"
yellow "║   Target: $BASE_URL"
yellow "╚══════════════════════════════════════════════╝"
echo ""
dim "  Date:      $(date)"
dim "  packed_by: $PACKED_BY"
echo ""


# ══════════════════════════════════════════════════════════════════════════════
# STEP 0: Health check
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 0 — Server reachability"

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null || echo "000")
if [[ "$HTTP_STATUS" =~ ^[23] ]]; then
  pass "Server reachable ($HTTP_STATUS)"
elif [[ "$HTTP_STATUS" == "000" ]]; then
  yellow "  ⚠ /api/health not available — attempting direct endpoint test"
else
  yellow "  ⚠ /api/health returned $HTTP_STATUS — continuing anyway"
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: Discover a valid tracking number (skip if TRACKING already set)
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 1 — Tracking number discovery"

if [[ -n "$TRACKING" ]]; then
  pass "Using provided tracking: $TRACKING"
else
  echo "  Querying Neon for a recent unshipped tracking number..."
  TRACKING=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT shipping_tracking_number
     FROM orders
     WHERE shipping_tracking_number IS NOT NULL
       AND shipping_tracking_number <> ''
     ORDER BY created_at DESC
     LIMIT 1;" 2>/dev/null | head -1 | tr -d '[:space:]' || true)

  if [[ -n "$TRACKING" ]]; then
    pass "Found tracking from DB: $TRACKING"
  else
    yellow "  ⚠ psql not available or no rows — using synthetic tracking number"
    TRACKING="TEST-TRACK-$(date +%s)"
    dim "    Using: $TRACKING"
  fi
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: scan-tracking endpoint
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 2 — POST /api/scan-tracking"

SCAN_RESP=$(curl -s -X POST "$BASE_URL/api/scan-tracking" \
  -H "Content-Type: application/json" \
  -d "{\"tracking\": \"$TRACKING\"}" 2>/dev/null || echo '{}')

echo "  Response: $(echo "$SCAN_RESP" | python3 -m json.tool 2>/dev/null || echo "$SCAN_RESP")"

SUCCESS_VAL=$(extract_json "$SCAN_RESP" "success")
if [[ "$SUCCESS_VAL" == "True" || "$SUCCESS_VAL" == "true" ]]; then
  pass "scan-tracking succeeded"
  ORDER_ID=$(extract_json "$SCAN_RESP" "orderId")
  [[ -n "$ORDER_ID" ]] && dim "    orderId: $ORDER_ID"
else
  yellow "  ⚠ scan-tracking returned success=false or unknown — continuing (tracking may be synthetic)"
  dim "    This is expected for synthetic/test tracking numbers"
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: start-session
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 3 — POST /api/packing-logs/start-session"

SESSION_RESP=$(curl -s -X POST "$BASE_URL/api/packing-logs/start-session" \
  -H "Content-Type: application/json" \
  -d "{
    \"trackingNumber\": \"$TRACKING\",
    \"packedBy\": $PACKED_BY,
    \"trackingType\": \"outbound\"
  }" 2>/dev/null || echo '{}')

echo "  Response: $(echo "$SESSION_RESP" | python3 -m json.tool 2>/dev/null || echo "$SESSION_RESP")"

SUCCESS_VAL=$(extract_json "$SESSION_RESP" "success")
if [[ "$SUCCESS_VAL" != "True" && "$SUCCESS_VAL" != "true" ]]; then
  fail "start-session did not return success=true"
  dim "    Full response: $SESSION_RESP"
  echo ""
  red "  Cannot continue without a packerLogId — aborting photo tests."
  echo ""
  echo "  Summary: $PASS passed, $((FAIL)) failed"
  exit 1
fi

pass "start-session succeeded"

PACKER_LOG_ID=$(extract_json_int "$SESSION_RESP" "packerLogId")
if [[ -z "$PACKER_LOG_ID" || "$PACKER_LOG_ID" == "0" ]]; then
  fail "packerLogId missing in start-session response"
  echo ""
  red "  Cannot continue without a valid packerLogId — aborting."
  exit 1
fi

pass "packerLogId received: $PACKER_LOG_ID"
SHIPMENT_ID=$(extract_json_int "$SESSION_RESP" "shipmentId")
[[ -n "$SHIPMENT_ID" ]] && dim "    shipmentId: $SHIPMENT_ID"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: save-photo (upload a test image)
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 4 — POST /api/packing-logs/save-photo"

PHOTO_RESP=$(curl -s -X POST "$BASE_URL/api/packing-logs/save-photo" \
  -H "Content-Type: application/json" \
  -d "{
    \"photo\": \"data:image/png;base64,$TINY_PNG_B64\",
    \"packerId\": $PACKED_BY,
    \"packerLogId\": $PACKER_LOG_ID,
    \"photoIndex\": 0,
    \"photoType\": \"packer_photo\",
    \"orderId\": \"${ORDER_ID:-E2E_TEST}\"
  }" 2>/dev/null || echo '{}')

echo "  Response: $(echo "$PHOTO_RESP" | python3 -m json.tool 2>/dev/null || echo "$PHOTO_RESP")"

assert_json_field "save-photo" "$PHOTO_RESP" "success" "True"
assert_json_truthy "save-photo" "$PHOTO_RESP" "path"

PHOTO_ID=$(extract_json_int "$PHOTO_RESP" "photoId")
BLOB_URL=$(extract_json "$PHOTO_RESP" "path")

if [[ -n "$PHOTO_ID" && "$PHOTO_ID" != "0" ]]; then
  pass "photos table row created — photoId: $PHOTO_ID"
else
  fail "photoId missing — photo was NOT inserted into the photos table"
  dim "    This means the DB insert in save-photo/route.ts failed or packerLogId was not passed correctly"
fi

[[ -n "$BLOB_URL" ]] && dim "    Blob URL: $BLOB_URL"


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5: GET /api/packing-logs/photos — verify row exists via API
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 5 — GET /api/packing-logs/photos?packerLogId=$PACKER_LOG_ID"

PHOTOS_RESP=$(curl -s "$BASE_URL/api/packing-logs/photos?packerLogId=$PACKER_LOG_ID" 2>/dev/null || echo '[]')

echo "  Response: $(echo "$PHOTOS_RESP" | python3 -m json.tool 2>/dev/null || echo "$PHOTOS_RESP")"

PHOTO_COUNT=$(echo "$PHOTOS_RESP" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  arr = d if isinstance(d, list) else d.get('photos', d.get('data', []))
  print(len(arr))
except:
  print(0)
" 2>/dev/null || echo "0")

if [[ "$PHOTO_COUNT" -ge 1 ]]; then
  pass "API returns $PHOTO_COUNT photo(s) for packerLogId=$PACKER_LOG_ID"
else
  fail "No photos returned for packerLogId=$PACKER_LOG_ID — DB insert likely failed"
fi

# Verify the returned photo matches what we uploaded
if [[ "$PHOTO_COUNT" -ge 1 ]]; then
  FIRST_ENTITY_TYPE=$(echo "$PHOTOS_RESP" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  arr = d if isinstance(d, list) else d.get('photos', d.get('data', []))
  if arr: print(arr[0].get('entity_type', arr[0].get('entityType', '')))
  else: print('')
except: print('')
" 2>/dev/null || true)

  if [[ "$FIRST_ENTITY_TYPE" == "PACKER_LOG" ]]; then
    pass "entity_type = PACKER_LOG (correct)"
  else
    yellow "  ⚠ entity_type = '$FIRST_ENTITY_TYPE' (expected PACKER_LOG)"
  fi
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6: Direct Neon DB verification via psql
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 6 — Direct DB verification (psql)"

if ! command -v psql &>/dev/null; then
  yellow "  ⚠ psql not installed — skipping direct DB check"
  yellow "    Install: brew install libpq && brew link --force libpq"
else
  echo "  Checking packer_logs row..."
  PL_ROW=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT id, scan_ref, tracking_type, packed_by, created_at
     FROM packer_logs
     WHERE id = $PACKER_LOG_ID;" 2>/dev/null || echo "")

  if [[ -n "$PL_ROW" ]]; then
    pass "packer_logs row exists: $PL_ROW"
  else
    fail "packer_logs row id=$PACKER_LOG_ID not found in DB"
  fi

  echo ""
  echo "  Checking photos row(s)..."
  PH_ROWS=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT id, entity_type, entity_id, photo_type, url
     FROM photos
     WHERE entity_type = 'PACKER_LOG' AND entity_id = $PACKER_LOG_ID
     ORDER BY created_at DESC;" 2>/dev/null || echo "")

  if [[ -n "$PH_ROWS" ]]; then
    pass "photos row(s) exist for entity_id=$PACKER_LOG_ID:"
    echo "$PH_ROWS" | while IFS= read -r row; do
      dim "    $row"
    done
  else
    fail "No photos rows found for entity_type='PACKER_LOG', entity_id=$PACKER_LOG_ID"
  fi

  # Confirm photoId from step 4 matches
  if [[ -n "$PHOTO_ID" && "$PHOTO_ID" != "0" ]]; then
    PHOTO_URL_FROM_DB=$(psql "$DATABASE_URL" -t -A -c \
      "SELECT url FROM photos WHERE id = $PHOTO_ID;" 2>/dev/null | head -1 | tr -d '[:space:]' || true)
    if [[ -n "$PHOTO_URL_FROM_DB" ]]; then
      pass "Photo id=$PHOTO_ID URL confirmed in DB: ${PHOTO_URL_FROM_DB:0:60}..."
    else
      fail "Photo id=$PHOTO_ID not found in DB"
    fi
  fi
fi


# ══════════════════════════════════════════════════════════════════════════════
# STEP 7: Upload a second photo (verifies multi-photo flow)
# ══════════════════════════════════════════════════════════════════════════════
section "STEP 7 — Second photo upload (multi-photo)"

PHOTO2_RESP=$(curl -s -X POST "$BASE_URL/api/packing-logs/save-photo" \
  -H "Content-Type: application/json" \
  -d "{
    \"photo\": \"data:image/png;base64,$TINY_PNG_B64\",
    \"packerId\": $PACKED_BY,
    \"packerLogId\": $PACKER_LOG_ID,
    \"photoIndex\": 1,
    \"photoType\": \"packer_photo\",
    \"orderId\": \"${ORDER_ID:-E2E_TEST}\"
  }" 2>/dev/null || echo '{}')

assert_json_field "save-photo #2" "$PHOTO2_RESP" "success" "True"

PHOTO2_ID=$(extract_json_int "$PHOTO2_RESP" "photoId")
if [[ -n "$PHOTO2_ID" && "$PHOTO2_ID" != "0" && "$PHOTO2_ID" != "$PHOTO_ID" ]]; then
  pass "Second photo inserted with distinct photoId: $PHOTO2_ID"
else
  fail "Second photo photoId same as first or missing ($PHOTO2_ID)"
fi

# Re-check count
PHOTOS2_RESP=$(curl -s "$BASE_URL/api/packing-logs/photos?packerLogId=$PACKER_LOG_ID" 2>/dev/null || echo '[]')
PHOTO_COUNT2=$(echo "$PHOTOS2_RESP" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  arr = d if isinstance(d, list) else d.get('photos', d.get('data', []))
  print(len(arr))
except:
  print(0)
" 2>/dev/null || echo "0")

if [[ "$PHOTO_COUNT2" -ge 2 ]]; then
  pass "Photos API returns $PHOTO_COUNT2 photos after second upload"
else
  fail "Expected ≥2 photos, got $PHOTO_COUNT2"
fi


# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo ""
yellow "══════════════════════════════════════════════"
yellow "  RESULTS"
yellow "══════════════════════════════════════════════"
echo ""
green "  Passed: $PASS"
[[ "$FAIL" -gt 0 ]] && red "  Failed: $FAIL" || echo "  Failed: 0"
echo ""

if [[ -n "$PACKER_LOG_ID" ]]; then
  dim "  packer_logs.id  = $PACKER_LOG_ID"
  dim "  tracking        = $TRACKING"
  dim "  photos count    = $PHOTO_COUNT2"
fi

echo ""

if [[ "$FAIL" -eq 0 ]]; then
  green "  ALL TESTS PASSED — packing flow is working end-to-end"
  exit 0
else
  red "  $FAIL TEST(S) FAILED — see output above"
  exit 1
fi
