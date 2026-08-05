#!/usr/bin/env bash
# End-to-end test of the full business loop against the running backend.
# Every assertion is a real HTTP call — no mocks.
set -euo pipefail
API=${API:-http://localhost:4000}
S=$RANDOM

j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)$1??'')}catch(e){console.log('')}})"; }
# Query the database the API is actually using. Hardcoding the local container made every
# ledger assertion pass vacuously against an empty database whenever DATABASE_URL pointed
# somewhere else. psql runs inside the container either way, so none is needed on the host.
# One line out of .env, not the whole file: its values are unquoted, which Node's env-file
# parser accepts and `source` does not.
: "${DATABASE_URL:=$([ -f .env ] && sed -n 's/^DATABASE_URL=//p' .env | head -1)}"
q() {
  if [ -n "${DATABASE_URL:-}" ]; then docker exec qrreward-db psql "$DATABASE_URL" -tAc "$1"
  else docker exec qrreward-db psql -U qrreward -tAc "$1"; fi
}
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

echo "5. Scan → store listing (nothing redeemable reaches the device)"
# Register the publisher's apps, so scans go to a store rather than the web fallback.
curl -s -XPATCH $API/v1/orgs/me -H "Authorization: Bearer $PUB_TOKEN" -H 'Content-Type: application/json' \
  -d '{"android_package":"com.dramabox.app","ios_app_id":"123456789","bonus_label":"100 free coins"}' >/dev/null
ANDROID='Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
IOS='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

LOC=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
echo "$LOC" | grep -q '^https://play.google.com/store/apps/details?id=com.dramabox.app' \
  && pass "Android scan redirects to the Play listing" || fail "redirect: $LOC"
echo "$LOC" | grep -q 'qrm_claim%3D' && pass "claim id rides only in the Play install referrer" || fail "no referrer: $LOC"
# The negative that matters most: no bearer token, key or spendable code in the URL.
echo "$LOC" | grep -qE '(^|[?&])(st|token|jwt|code)=' && fail "redirect leaks a redeemable token: $LOC" \
  || pass "redirect carries no token the app could spend"
REFERRER=$(printf '%s' "$LOC" | sed 's/.*&referrer=//' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(decodeURIComponent(d.trim())))")

# The iOS leg is a two-hop flow now and is exercised in full in 6b, below.

echo "6. Attribution (the money path) — guest tier, then confirm"
# Deterministic path: the publisher's server replays the Play install referrer.
RED=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$REFERRER\",\"publisher_user_ref\":\"viewer$S@x.com\"}")
COINS=$(echo "$RED" | j .fee); RED_ID=$(echo "$RED" | j .attribution_id)
[ "$(echo "$RED" | j .attributed)" = "true" ] && pass "install matched to the scan by referrer" || fail "claim: $RED"
[ "$(echo "$RED" | j .match_method)" = "referrer" ] && pass "match recorded as deterministic" || fail "method: $RED"
[ "$COINS" = "10" ] && pass "unverified install pays guest tier only (10 credits)" || fail "fee: $RED"
[ "$(echo "$RED" | j .pending_fee)" = "40" ] && pass "40-credit delta held back pending identification" || fail "pending: $RED"
[ "$(echo "$RED" | j .bonus_label)" = "100 free coins" ] && pass "publisher's own bonus echoed back as a label" || fail "bonus: $RED"
REM=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$REM" = "90" ] && pass "budget debited 100→90 (guest tier only)" || fail "budget_remaining=$REM"

UP=$(curl -s -XPOST $API/v1/attribution/$RED_ID/confirm -H "Authorization: Bearer $API_KEY")
[ "$(echo "$UP" | j .fee)" = "50" ] && pass "confirming releases the delta (10→50 credits)" || fail "confirm: $UP"
UP2=$(curl -s -XPOST $API/v1/attribution/$RED_ID/confirm -H "Authorization: Bearer $API_KEY" | j .status)
[ "$UP2" = "already_full" ] && pass "confirm is idempotent (no double payout)" || fail "re-confirm: $UP2"
REM=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$REM" = "50" ] && pass "budget charged the delta exactly once (90→50)" || fail "budget_remaining=$REM"

echo "6b. iOS path — interstitial, then first-open and signup as separate stages"
# iOS has no install-referrer channel, so an iPhone scan no longer 302s. It gets an
# interstitial, which is the only moment this device's timezone, screen and locale can be
# read — in a browser, before the App Store takes the session away.
IOS_PAGE=$(curl -s -A "$IOS" "$API/r/$CODE")
echo "$IOS_PAGE" | grep -q 'Opening the App' && pass "iPhone scan serves the signal interstitial" || fail "no interstitial served"
echo "$IOS_PAGE" | grep -qE '(^|[^a-z])(st|token|jwt)=' && fail "interstitial leaks a redeemable token" \
  || pass "interstitial carries nothing the app could spend"
CLAIM=$(printf '%s' "$IOS_PAGE" | grep -o '/go/[A-Za-z0-9_-]\{6,\}' | head -1 | cut -d/ -f3)
[ -n "$CLAIM" ] && pass "interstitial hands the browser a forwarding hop" || fail "no /go hop in the page"

# What the page's script posts back, then the store hop itself.
STORE=$(curl -s -A "$IOS" -o /dev/null -w '%{redirect_url}' \
  "$API/go/$CLAIM?tz=Asia/Dhaka&sc=393x852@3&lang=en-US")
echo "$STORE" | grep -q '^https://apps.apple.com/app/id123456789$' \
  && pass "forwarding hop reaches the App Store listing, payload-free" || fail "go hop: $STORE"

# Stage one. Minutes after the scan, the app opens for the first time and the publisher's
# server presents the same signals. Nothing is paid here.
FO=$(curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"ip":"::1","platform":"ios","tz":"Asia/Dhaka","screen":"393x852@3","language":"en-US"}')
[ "$(echo "$FO" | j .attributed)" = "true" ] && pass "iOS first open matched on the full fingerprint" || fail "first-open: $FO"
[ "$(echo "$FO" | j .confidence)" = "100" ] && pass "every signal agreeing scores 100" || fail "confidence: $FO"
INSTALL_ID=$(echo "$FO" | j .install_id)
FO_BUDGET=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$FO_BUDGET" = "50" ] && pass "first open moves no money (budget untouched at 50)" || fail "first-open charged: $FO_BUDGET"

# Stage two, arbitrarily later: the user signs up and the fee is earned.
SU=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_id\":\"$INSTALL_ID\",\"publisher_user_ref\":\"ios$S@x.com\"}")
[ "$(echo "$SU" | j .attributed)" = "true" ] && pass "signup redeems the install banked at first open" || fail "signup: $SU"
[ "$(echo "$SU" | j .match_method)" = "fingerprint" ] && pass "match method carries through from first open" || fail "method: $SU"
[ "$(echo "$SU" | j .confidence)" = "100" ] && pass "the fee is paid on the confidence recorded at match time" || fail "confidence: $SU"
DUPI=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_id\":\"$INSTALL_ID\",\"publisher_user_ref\":\"iostwo$S@x.com\"}" | j .reason)
[ "$DUPI" = "already_claimed" ] && pass "one install pays exactly one signup" || fail "install reused: $DUPI"

# The headline behaviour change. A scan whose interstitial never ran leaves only IP + platform,
# which scores 55 against a floor of 70. That used to be paid. An IP is a postcode — carrier
# NAT, café wifi, an airport, a corporate VPN — and this is the case that must now refuse.
curl -s -A "$IOS" -o /dev/null "$API/r/$CODE"
WEAK=$(curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"ip":"::1","platform":"ios"}')
[ "$(echo "$WEAK" | j .attributed)" = "false" ] && pass "IP + platform alone is refused, never paid" || fail "weak fingerprint paid: $WEAK"
[ "$(echo "$WEAK" | j .confidence)" = "55" ] && pass "the refusal reports the score it refused on" || fail "score: $WEAK"

# An emulator is the shape of every install farm, and the SDK says so before we look anything up.
EMU=$(curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"ip":"::1","platform":"ios","tz":"Asia/Dhaka","screen":"393x852@3","language":"en-US","emulator":true}' | j .reason)
[ "$EMU" = "device_integrity" ] && pass "a self-declared emulator is refused before matching" || fail "emulator: $EMU"

MISS=$(curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"ip":"203.0.113.99","platform":"ios","tz":"Asia/Dhaka","screen":"393x852@3","language":"en-US"}')
[ "$(echo "$MISS" | j .attributed)" = "false" ] && pass "an organic install is unattributed, not an error" || fail "organic: $MISS"
[ "$(echo "$MISS" | j .reason)" = "no_match" ] && pass "unattributed answer names its reason" || fail "reason: $MISS"

echo "7. Security & fraud guards"
REPLAY=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$REFERRER\",\"publisher_user_ref\":\"replay$S@x.com\"}" | j .reason)
[ "$REPLAY" = "no_match" ] && pass "a claim id is single-use (replay attributes nothing)" || fail "replay: $REPLAY"

curl -s -A "$ANDROID" -o /dev/null "$API/r/$CODE"
LOC2=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
REFERRER2=$(printf '%s' "$LOC2" | sed 's/.*&referrer=//' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(decodeURIComponent(d.trim())))")
BUDGET_BEFORE=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
DUP2=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$REFERRER2\",\"publisher_user_ref\":\"viewer$S@x.com\"}")
[ "$(echo "$DUP2" | j .attribution_id)" = "$RED_ID" ] && pass "re-claiming one user replays the original attribution" || fail "dedupe: $DUP2"
[ "$(echo "$DUP2" | j .replay)" = "true" ] && pass "the replay is flagged, not disguised as a fresh match" || fail "replay flag: $DUP2"
BUDGET_AFTER=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$BUDGET_AFTER" = "$BUDGET_BEFORE" ] && pass "same user can't be counted twice (budget untouched)" || fail "double-charged: $BUDGET_BEFORE -> $BUDGET_AFTER"

FORGE=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"qrm_claim=AAAAAAAAAAAAAAAAAAAAAA\",\"publisher_user_ref\":\"forge$S@x.com\"}" | j .attributed)
[ "$FORGE" = "false" ] && pass "a guessed claim id attributes nothing" || fail "forged claim: $FORGE"

# The one property nothing else here tests. Every other assertion is sequential, but
# `FOR UPDATE OF s SKIP LOCKED`, the balance lock and the `consumed = false` re-check exist
# *only* for the simultaneous case — remove any one of the three and the whole suite still
# passes. Different user refs on purpose, so the UNIQUE constraint cannot be what saves it.
LOC4=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
REFERRER4=$(printf '%s' "$LOC4" | sed 's/.*&referrer=//' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(decodeURIComponent(d.trim())))")
RACE_BEFORE=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
RACE_DIR=$(mktemp -d)
for i in $(seq 1 20); do
  curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
    -d "{\"install_referrer\":\"$REFERRER4\",\"publisher_user_ref\":\"race$S-$i@x.com\"}" > "$RACE_DIR/$i" &
done
wait
WON=$(grep -l '"attributed":true' "$RACE_DIR"/* 2>/dev/null | wc -l | tr -d ' ')
[ "$WON" = "1" ] && pass "20 simultaneous claims on one scan: exactly one is attributed" || fail "concurrent double-spend: $WON claims attributed, expected 1"
RACE_AFTER=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$RACE_AFTER" = "$((RACE_BEFORE - 10))" ] && pass "budget charged exactly one guest-tier fee under contention" || fail "budget $RACE_BEFORE -> $RACE_AFTER, expected $((RACE_BEFORE - 10))"
rm -rf "$RACE_DIR"

# The exception filter's own stated purpose: a malformed uuid in the URL is a client mistake,
# not a 500. Nothing covered it, so the code it actually raises was missing from the switch.
BADUUID=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/qr-codes/not-a-uuid/image")
[ "$BADUUID" = "400" ] && pass "malformed uuid in a URL is a 400, not a 500" || fail "bad uuid: $BADUUID"

# A non-string password reached bcrypt as a number and threw inside the handler.
TYPEPW=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"x\",\"email\":\"typed$S@t.com\",\"password\":12345678,\"type\":\"promoter\"}")
[ "$TYPEPW" = "400" ] && pass "non-string password rejected (400, not a 500)" || fail "typed password: $TYPEPW"

BADKEY=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/attribution/claim -H "Authorization: Bearer pk_wrong" -H 'Content-Type: application/json' -d "{\"publisher_user_ref\":\"x@x.com\",\"ip\":\"127.0.0.1\"}")
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
# Top up to exactly one full-rate install, then spend it, so the drain is unambiguous.
NEED=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
curl -s -XPOST $API/v1/campaigns/$CAMP_ID/fund -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"coins\":$((50 - NEED))}" >/dev/null
LOC3=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
REFERRER3=$(printf '%s' "$LOC3" | sed 's/.*&referrer=//' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(decodeURIComponent(d.trim())))")
curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$REFERRER3\",\"publisher_user_ref\":\"other$S@x.com\",\"identified\":true}" >/dev/null
ENDED=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
echo "$ENDED" | grep -q 'campaign-ended' && pass "exhausted budget stops serving scans" || fail "expected campaign-ended, got $ENDED"

# A publisher whose store listing isn't configured must not burn print-run uses on a dead end.
NOAPP=$(curl -s -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"NoApp $S\",\"email\":\"noapp$S@t.com\",\"password\":\"password123\",\"type\":\"publisher\"}" | j .token)
BADPKG=$(curl -s -o /dev/null -w '%{http_code}' -XPATCH $API/v1/orgs/me -H "Authorization: Bearer $NOAPP" -H 'Content-Type: application/json' \
  -d '{"android_package":"com.evil&id=other.app"}')
[ "$BADPKG" = "400" ] && pass "malformed package name rejected (no store-URL injection)" || fail "package guard: $BADPKG"

# ...and a promoter must be able to see that before committing a print run, not after.
DIR=$(curl -s "$API/v1/publishers" -H "Authorization: Bearer $PRO_TOKEN")
READY=$(echo "$DIR" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.find(p=>p.name==='NoApp $S')?.ready, o.find(p=>p.name==='DramaBox $S')?.ready)})")
[ "$READY" = "false true" ] && pass "publisher directory flags who can actually receive scans" || fail "ready flags: $READY"

echo "10. Ledger integrity"
SUM=$(q "SELECT sum(amount) FROM ledger_entries")
[ "$SUM" = "0" ] && pass "double-entry ledger balances to zero" || fail "ledger sum=$SUM"
DRIFT=$(q "SELECT count(*) FROM account_balances b JOIN (SELECT account, sum(amount) s FROM ledger_entries GROUP BY account) l USING(account) WHERE b.balance <> l.s")
[ "$DRIFT" = "0" ] && pass "cached balances match ledger (no drift)" || fail "drift on $DRIFT accounts"
# The publisher reads its own earned balance — the same number the admin portal sees.
EARNED=$(curl -s "$API/v1/orgs/me" -H "Authorization: Bearer $PUB_TOKEN" | j .earnings)
# sum(), not the bare column: a publisher with no entries yet has no row at all, and the
# comparison has to see 0 there rather than an empty string.
LEDGERED=$(q "SELECT coalesce(sum(balance),0) FROM account_balances WHERE account='publisher:$PUB_ID'")
[ -n "$EARNED" ] && [ "$EARNED" = "$LEDGERED" ] && pass "publisher sees its own earnings ($EARNED coins)" || fail "earnings=$EARNED ledger=$LEDGERED pub=$PUB_ID"

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
# `--` and -F: short codes are base64url, so one starting with `-` is otherwise read as flags
echo "$SCAN0" | grep -qF -- "$CODE" && pass "scan log shows QR code, device and conversion" || fail "scans: $SCAN0"

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
REOPENED=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$ONCE_CODE")
echo "$REOPENED" | grep -q 'play.google.com' && pass "overridden code scans again" || fail "override not applied: $REOPENED"
A $API/v1/admin/audit-log | grep -q 'permanent store signage' && pass "every override lands in the audit log" || fail "no audit entry"

# Sending a partnership back to `pending` is the obvious lever for "suspend this relationship".
# It was checked only when a campaign was created, so afterwards it changed nothing at all:
# scans kept redirecting and claims kept paying out against a partnership under no agreement.
SUSPEND=$(A -XPATCH $API/v1/admin/partnerships/$PART_ID -H 'Content-Type: application/json' -d '{"status":"pending"}' | j .status)
[ "$SUSPEND" = "pending" ] && pass "admin can send a partnership back to pending" || fail "suspend: $SUSPEND"
HELD=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
echo "$HELD" | grep -q 'reason=partnership_inactive' && pass "an inactive partnership stops scans" || fail "suspended partnership still redirects: $HELD"
HELDCLAIM=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"publisher_user_ref\":\"held$S@x.com\",\"ip\":\"::1\",\"platform\":\"ios\"}" | j .attributed)
[ "$HELDCLAIM" = "false" ] && pass "...and stops claims paying out against it" || fail "suspended partnership still pays: $HELDCLAIM"
A -XPATCH $API/v1/admin/partnerships/$PART_ID -H 'Content-Type: application/json' -d '{"status":"active"}' >/dev/null

echo "12. Kill switch & offboarding"
KILL=$(A -XPOST $API/v1/admin/campaigns/$CAMP_ID/kill -H 'Content-Type: application/json' -d '{"reason":"abuse report"}')
[ "$(echo "$KILL" | j .status)" = "ended" ] && pass "kill switch ends the campaign" || fail "kill: $KILL"
DEADSCAN=$(curl -s -o /dev/null -w '%{redirect_url}' "$API/r/$ONCE_CODE")
echo "$DEADSCAN" | grep -q 'campaign-ended' && pass "killed campaign voids every code it issued" || fail "kill scan: $DEADSCAN"

OFF=$(A -XPOST $API/v1/admin/orgs/$PUB_ID/offboard -H 'Content-Type: application/json' -d '{"reason":"contract ended"}')
[ "$(echo "$OFF" | j .api_key_revoked)" = "true" ] && pass "offboarding revokes the publisher API key" || fail "offboard: $OFF"
GONE=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' -d '{"publisher_user_ref":"y@z.com","ip":"127.0.0.1"}')
[ "$GONE" = "401" ] && pass "departed tenant's API key no longer earns fees (401)" || fail "revoked key still works: $GONE"

echo "13. Ledger integrity after admin actions"
SUM2=$(q "SELECT sum(amount) FROM ledger_entries")
[ "$SUM2" = "0" ] && pass "ledger still balances after admin actions" || fail "ledger sum=$SUM2"

echo "14. Input bounds & abuse ceilings"
# Runs last on purpose: the flood below burns this IP's global budget for the minute.
# A fresh publisher, because the one used above was offboarded and its key revoked.
KEY2=$(curl -s -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"Bounds $S\",\"email\":\"bounds$S@t.com\",\"password\":\"password123\",\"type\":\"publisher\"}" | j .api_key)
LONGREF=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $KEY2" -H 'Content-Type: application/json' \
  -d "{\"publisher_user_ref\":\"$(printf 'x%.0s' $(seq 1 201))\",\"ip\":\"203.0.113.5\"}")
[ "$LONGREF" = "400" ] && pass "oversized publisher_user_ref rejected (400)" || fail "unbounded ref: $LONGREF"
NULREF=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $KEY2" -H 'Content-Type: application/json' \
  -d '{"publisher_user_ref":"bad\u0000ref","ip":"203.0.113.5"}' | j .message)
case "$NULREF" in *"null bytes"*) pass "null byte in publisher_user_ref rejected" ;; *) fail "NUL accepted: $NULREF" ;; esac
LONGPW=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"x\",\"email\":\"long$S@t.com\",\"password\":\"$(printf 'p%.0s' $(seq 1 73))\",\"type\":\"promoter\"}")
[ "$LONGPW" = "400" ] && pass "over-72-byte password rejected (bcrypt truncation trap)" || fail "long password: $LONGPW"

# The global per-IP ceiling under every route, including authenticated ones.
# Flood as a synthetic client rather than as ourselves: dev TRUST_PROXY is `loopback`, so
# X-Forwarded-For from localhost is honoured. That keeps this run's own budget intact (the
# suite stays re-runnable) and additionally proves the limiter keys on the forwarded client.
FAKE='198.51.100.77'
for i in $(seq 1 310); do curl -s -o /dev/null "$API/v1/publishers" -H "X-Forwarded-For: $FAKE" -H "Authorization: Bearer $PRO_TOKEN"; done
FLOOD=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/publishers" -H "X-Forwarded-For: $FAKE" -H "Authorization: Bearer $PRO_TOKEN")
[ "$FLOOD" = "429" ] && pass "global per-IP ceiling throttles authenticated routes (429)" || fail "no global limit: $FLOOD"
MINE=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/publishers" -H "Authorization: Bearer $PRO_TOKEN")
[ "$MINE" = "200" ] && pass "one flooding client is throttled without affecting others" || fail "limiter not per-IP: $MINE"
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' "$API/healthz")
[ "$HEALTH" = "200" ] && pass "health probe stays exempt, so a flood can't cause an outage" || fail "healthz throttled: $HEALTH"

echo; echo "ALL CHECKS PASSED"
