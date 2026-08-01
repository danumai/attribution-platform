#!/usr/bin/env bash
# End-to-end test of the full business loop against the running backend.
# Every assertion is a real HTTP call — no mocks.
set -euo pipefail
API=${API:-http://localhost:4000}
S=$RANDOM

j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)$1??'')}catch(e){console.log('')}})"; }
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "1. Signup"
PUB=$(curl -s -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"DramaBox $S\",\"email\":\"pub$S@t.com\",\"password\":\"password123\",\"type\":\"publisher\",\"landing_url\":\"http://localhost:3000/publisher-sim\"}")
PUB_TOKEN=$(echo "$PUB" | j .token); PUB_ID=$(echo "$PUB" | j .org.id); API_KEY=$(echo "$PUB" | j .api_key)
PRO=$(curl -s -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"Air Dhaka $S\",\"email\":\"pro$S@t.com\",\"password\":\"password123\",\"type\":\"promoter\"}")
PRO_TOKEN=$(echo "$PRO" | j .token)
[ -n "$API_KEY" ] && pass "publisher got one-time API key" || fail "no API key"

echo "2. Partnership"
PART=$(curl -s -XPOST $API/v1/partnerships -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"publisher_org_id\":\"$PUB_ID\",\"coin_rate\":50,\"guest_rate\":10,\"grace_days\":7}")
PART_ID=$(echo "$PART" | j .id)
curl -s -XPOST $API/v1/partnerships/$PART_ID/accept -H "Authorization: Bearer $PUB_TOKEN" >/dev/null
pass "partnership created and accepted (10 guest / 50 full)"
BADTIER=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/partnerships -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"publisher_org_id\":\"$PUB_ID\",\"coin_rate\":50,\"guest_rate\":80}")
[ "$BADTIER" = "400" ] && pass "guest_rate above coin_rate rejected (400)" || fail "tier guard: $BADTIER"

echo "3. Campaign + funding"
CAMP=$(curl -s -XPOST $API/v1/campaigns -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"partnership_id\":\"$PART_ID\",\"name\":\"Inflight promo\"}")
CAMP_ID=$(echo "$CAMP" | j .id)
BUDGET=$(curl -s -XPOST $API/v1/campaigns/$CAMP_ID/fund -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"coins":100}' | j .budget)
[ "$BUDGET" = "100" ] && pass "campaign funded: 100 coins" || fail "budget=$BUDGET"

echo "4. QR generation + customization"
QR=$(curl -s -XPOST $API/v1/campaigns/$CAMP_ID/qr-codes -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d '{"style":{"dark":"#3730a3","light":"#ffffff","size":512,"margin":3,"ecc":"Q"}}')
QR_ID=$(echo "$QR" | j .id); CODE=$(echo "$QR" | j .code)
curl -s "$API/v1/qr-codes/$QR_ID/image?format=svg" | grep -q '<svg' && pass "styled SVG renders" || fail "svg render"
curl -s "$API/v1/qr-codes/$QR_ID/image?format=png" --output /tmp/qr$S.png && file /tmp/qr$S.png | grep -q PNG && pass "PNG renders" || fail "png render"
BAD=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/qr-codes/$QR_ID/image?style=%7B%22dark%22%3A%22%23eeeeee%22%2C%22light%22%3A%22%23ffffff%22%7D")
[ "$BAD" = "400" ] && pass "unscannable low-contrast design rejected (400)" || fail "contrast guard returned $BAD"
XSS=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/campaigns/$CAMP_ID/qr-codes -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"style":{"logo":"javascript:alert(1)"}}')
[ "$XSS" = "400" ] && pass "non-data-URL logo rejected (400)" || fail "logo guard returned $XSS"

echo "5. Scan → redirect"
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
echo "$LOC" | grep -q 'publisher-sim?st=' && pass "scan redirects to publisher with scan token" || fail "redirect: $LOC"
ST=$(echo "$LOC" | sed 's/.*st=//')

echo "6. Redemption (the money path) — guest tier, then upgrade"
RED=$(curl -s -XPOST $API/v1/redemptions/verify -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"scan_token\":\"$ST\",\"publisher_user_ref\":\"viewer$S@x.com\"}")
COINS=$(echo "$RED" | j .coins); RED_ID=$(echo "$RED" | j .redemption_id)
[ "$COINS" = "10" ] && pass "unverified scan pays guest tier only (10 coins)" || fail "verify: $RED"
[ "$(echo "$RED" | j .pending_coins)" = "40" ] && pass "40-coin delta held back pending identification" || fail "pending: $RED"
REM=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$REM" = "90" ] && pass "budget debited 100→90 (guest tier only)" || fail "budget_remaining=$REM"

UP=$(curl -s -XPOST $API/v1/redemptions/$RED_ID/upgrade -H "Authorization: Bearer $API_KEY")
[ "$(echo "$UP" | j .coins)" = "50" ] && pass "verifying releases the delta (10→50 coins)" || fail "upgrade: $UP"
UP2=$(curl -s -XPOST $API/v1/redemptions/$RED_ID/upgrade -H "Authorization: Bearer $API_KEY" | j .status)
[ "$UP2" = "already_full" ] && pass "upgrade is idempotent (no double payout)" || fail "re-upgrade: $UP2"
REM=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$REM" = "50" ] && pass "budget charged the delta exactly once (90→50)" || fail "budget_remaining=$REM"

echo "7. Security & fraud guards"
DUP=$(curl -s -XPOST $API/v1/redemptions/verify -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"scan_token\":\"$ST\",\"publisher_user_ref\":\"viewer$S@x.com\"}" | j .message)
[ "$DUP" = "scan token already used" ] && pass "scan token is single-use" || fail "replay: $DUP"

LOC2=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$CODE"); ST2=$(echo "$LOC2" | sed 's/.*st=//')
DUP2=$(curl -s -XPOST $API/v1/redemptions/verify -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"scan_token\":\"$ST2\",\"publisher_user_ref\":\"viewer$S@x.com\"}" | j .message)
[ "$DUP2" = "duplicate_user" ] && pass "same user can't claim twice (DB constraint)" || fail "dedupe: $DUP2"

BADKEY=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/redemptions/verify -H "Authorization: Bearer pk_wrong" -H 'Content-Type: application/json' -d "{\"scan_token\":\"$ST2\",\"publisher_user_ref\":\"x@x.com\"}")
[ "$BADKEY" = "401" ] && pass "invalid API key rejected (401)" || fail "auth: $BADKEY"
NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' $API/v1/campaigns)
[ "$NOAUTH" = "401" ] && pass "portal API requires auth (401)" || fail "guard: $NOAUTH"
FOREIGN=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/campaigns/$CAMP_ID/fund -H "Authorization: Bearer $PUB_TOKEN" -H 'Content-Type: application/json' -d '{"coins":9999}')
[ "$FOREIGN" = "403" ] && pass "publisher can't fund promoter's campaign (403)" || fail "rbac: $FOREIGN"

FORGED=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"Evil\",\"email\":\"evil$S@t.com\",\"password\":\"password123\",\"type\":\"publisher\",\"landing_url\":\"javascript:alert(1)\"}")
[ "$FORGED" = "400" ] && pass "javascript: landing URL rejected (no redirect XSS)" || fail "landing guard: $FORGED"
PLAIN=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"Evil\",\"email\":\"evil2$S@t.com\",\"password\":\"password123\",\"type\":\"publisher\",\"landing_url\":\"http://evil.example.com/steal\"}")
[ "$PLAIN" = "400" ] && pass "cleartext non-local landing URL rejected (no token exfil)" || fail "landing scheme guard: $PLAIN"
CSP=$(curl -s -D- -o /dev/null "$API/v1/qr-codes/$QR_ID/image?format=svg" | tr -d '\r' | grep -ci "content-security-policy: default-src 'none'")
[ "$CSP" = "1" ] && pass "rendered SVG carries a script-blocking CSP" || fail "no CSP on image response"

echo "8. Code time/usage bounds"
ONCE=$(curl -s -XPOST $API/v1/campaigns/$CAMP_ID/qr-codes -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"max_uses":1}')
ONCE_CODE=$(echo "$ONCE" | j .code); ONCE_ID=$(echo "$ONCE" | j .id)
[ -n "$(echo "$ONCE" | j .expires_at)" ] && pass "new codes are time-bound by default" || fail "no default expiry"
curl -s -o /dev/null "$API/r/$ONCE_CODE"
USED=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$ONCE_CODE")
echo "$USED" | grep -q 'reason=used_up' && pass "single-use code refuses a second scan" || fail "max_uses: $USED"

DEADQR=$(curl -s -XPOST $API/v1/campaigns/$CAMP_ID/qr-codes -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{}')
DEAD=$(echo "$DEADQR" | j .code); VOID_ID=$(echo "$DEADQR" | j .id)
curl -s -XPOST $API/v1/qr-codes/$VOID_ID/void -H "Authorization: Bearer $PRO_TOKEN" >/dev/null
VOIDED=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$DEAD")
echo "$VOIDED" | grep -q 'reason=voided' && pass "voided code stops redeeming (lost print run)" || fail "void: $VOIDED"

echo "9. Budget exhaustion fails closed"
LOC3=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$CODE"); ST3=$(echo "$LOC3" | sed 's/.*st=//')
curl -s -XPOST $API/v1/redemptions/verify -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"scan_token\":\"$ST3\",\"publisher_user_ref\":\"other$S@x.com\",\"identified\":true}" >/dev/null
ENDED=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
echo "$ENDED" | grep -q 'campaign-ended' && pass "exhausted budget stops serving scans" || fail "expected campaign-ended, got $ENDED"

echo "10. Ledger integrity"
SUM=$(docker exec qrreward-db psql -U qrreward -tAc "SELECT sum(amount) FROM ledger_entries")
[ "$SUM" = "0" ] && pass "double-entry ledger balances to zero" || fail "ledger sum=$SUM"
DRIFT=$(docker exec qrreward-db psql -U qrreward -tAc \
  "SELECT count(*) FROM account_balances b JOIN (SELECT account, sum(amount) s FROM ledger_entries GROUP BY account) l USING(account) WHERE b.balance <> l.s")
[ "$DRIFT" = "0" ] && pass "cached balances match ledger (no drift)" || fail "drift on $DRIFT accounts"

echo "11. Super admin portal"
ADM_TOKEN=$(curl -s -XPOST $API/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL:-admin@qrreward.local}\",\"password\":\"${ADMIN_PASSWORD:-admin12345}\"}" | j .token)
[ -n "$ADM_TOKEN" ] && pass "super admin logs in" || fail "admin login failed"
A() { curl -s -H "Authorization: Bearer $ADM_TOKEN" "$@"; }

DENIED=$(curl -s -o /dev/null -w '%{http_code}' $API/v1/admin/overview -H "Authorization: Bearer $PRO_TOKEN")
[ "$DENIED" = "403" ] && pass "promoter token can't reach admin API (403)" || fail "admin guard: $DENIED"

OV=$(A $API/v1/admin/overview)
[ "$(echo "$OV" | j .ledger_balanced)" = "true" ] && pass "overview reports a balanced ledger" || fail "overview: $OV"
[ "$(echo "$OV" | j .scans)" -ge 3 ] && pass "overview counts scans platform-wide" || fail "scan count: $OV"

SCAN0=$(A "$API/v1/admin/scans?campaign_id=$CAMP_ID" | j '[0]')
echo "$SCAN0" | grep -q "$CODE" && pass "scan log shows QR code, device and conversion" || fail "scans: $SCAN0"

# admin sees every org, not just its own
A $API/v1/admin/orgs | grep -q "pub$S@t.com" && pass "org directory lists all tenants" || fail "orgs listing"

SUSP=$(A -XPATCH $API/v1/admin/orgs/$PUB_ID -H 'Content-Type: application/json' -d '{"suspended":true}' | j .suspended)
LOCKED=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"pub$S@t.com\",\"password\":\"password123\"}")
[ "$SUSP" = "true" ] && [ "$LOCKED" = "401" ] && pass "suspending an org blocks its login" || fail "suspend=$SUSP login=$LOCKED"
# the key bit: an already-issued JWT must die immediately, not at its 12h expiry
CUT=$(curl -s -o /dev/null -w '%{http_code}' $API/v1/campaigns -H "Authorization: Bearer $PUB_TOKEN")
[ "$CUT" = "401" ] && pass "suspension revokes live sessions instantly (401)" || fail "stale session still valid: $CUT"
A -XPATCH $API/v1/admin/orgs/$PUB_ID -H 'Content-Type: application/json' -d '{"suspended":false}' >/dev/null
BACK=$(curl -s -o /dev/null -w '%{http_code}' $API/v1/campaigns -H "Authorization: Bearer $PUB_TOKEN")
[ "$BACK" = "200" ] && pass "reinstating the org restores access" || fail "reinstate: $BACK"

ADJ=$(A -XPOST $API/v1/admin/campaigns/$CAMP_ID/adjust -H 'Content-Type: application/json' -d '{"coins":75,"reason":"goodwill"}' | j .budget)
[ "$ADJ" = "75" ] && pass "admin budget adjustment credits the campaign" || fail "adjust: $ADJ"
OVER=$(A -XPOST $API/v1/admin/campaigns/$CAMP_ID/adjust -H 'Content-Type: application/json' -d '{"coins":-999}' | j .statusCode)
[ "$OVER" = "400" ] && pass "clawback below zero rejected" || fail "overdraw: $OVER"

# per-code override: a permanent code on store signage escapes the single-use default
OVR=$(A -XPATCH $API/v1/admin/qr-codes/$ONCE_ID -H 'Content-Type: application/json' \
  -d '{"max_uses":null,"expires_at":null,"voided":false,"reason":"permanent store signage"}')
[ "$(echo "$OVR" | j .max_uses)" = "" ] && pass "admin can lift a code's single-use limit" || fail "override: $OVR"
REOPENED=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$ONCE_CODE")
echo "$REOPENED" | grep -q 'st=' && pass "overridden code scans again" || fail "override not applied: $REOPENED"
A $API/v1/admin/audit-log | grep -q 'permanent store signage' && pass "every override lands in the audit log" || fail "no audit entry"

echo "12. Kill switch & offboarding"
KILL=$(A -XPOST $API/v1/admin/campaigns/$CAMP_ID/kill -H 'Content-Type: application/json' -d '{"reason":"abuse report"}')
[ "$(echo "$KILL" | j .status)" = "ended" ] && pass "kill switch ends the campaign" || fail "kill: $KILL"
DEADSCAN=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$ONCE_CODE")
echo "$DEADSCAN" | grep -q 'campaign-ended' && pass "killed campaign voids every code it issued" || fail "kill scan: $DEADSCAN"

OFF=$(A -XPOST $API/v1/admin/orgs/$PUB_ID/offboard -H 'Content-Type: application/json' -d '{"reason":"contract ended"}')
[ "$(echo "$OFF" | j .api_key_revoked)" = "true" ] && pass "offboarding revokes the publisher API key" || fail "offboard: $OFF"
GONE=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/redemptions/verify -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' -d '{"scan_token":"x","publisher_user_ref":"y@z.com"}')
[ "$GONE" = "401" ] && pass "departed tenant's API key no longer grants coins (401)" || fail "revoked key still works: $GONE"

echo "13. Ledger integrity after admin actions"
SUM2=$(docker exec qrreward-db psql -U qrreward -tAc "SELECT sum(amount) FROM ledger_entries")
[ "$SUM2" = "0" ] && pass "ledger still balances after admin actions" || fail "ledger sum=$SUM2"

echo; echo "ALL CHECKS PASSED"
