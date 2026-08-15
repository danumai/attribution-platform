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
# ...except when it points at the container's own host-mapped port. `localhost:5436` is the
# host's view; inside the container Postgres is on :5432 and 5436 is nothing, so passing the
# URL through unchanged fails to connect on exactly the default setup the README documents.
case "${DATABASE_URL:-}" in
  *@localhost:*|*@127.0.0.1:*|*@'[::1]':*) DATABASE_URL='' ;;
esac
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
PRO_TOKEN=$(echo "$PRO" | j .token); PRO_ID=$(echo "$PRO" | j .org.id); PRO_KEY=$(echo "$PRO" | j .api_key)
[ -n "$API_KEY" ] && pass "publisher got one-time API key" || fail "no API key"
# The promoter has a server too now — it mints one code per ticket sold on /v1/issue.
[ -n "$PRO_KEY" ] && pass "promoter got one-time API key (transaction issuance)" || fail "no promoter API key"

echo "2. Partnership"
PART=$(curl -s -XPOST $API/v1/partnerships -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"publisher_org_id\":\"$PUB_ID\",\"coin_rate\":50,\"guest_rate\":10,\"grace_days\":7}")
PART_ID=$(echo "$PART" | j .id)
curl -s -XPOST $API/v1/partnerships/$PART_ID/accept -H "Authorization: Bearer $PUB_TOKEN" >/dev/null
pass "partnership created and accepted (10 guest / 50 full)"
BADTIER=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/partnerships -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"publisher_org_id\":\"$PUB_ID\",\"coin_rate\":50,\"guest_rate\":80}")
[ "$BADTIER" = "400" ] && pass "guest_rate above coin_rate rejected (400)" || fail "tier guard: $BADTIER"
# The foreign key only proves the id names an org. A partnership pointed at a promoter has no
# app, no landing page and no API key, so every code printed for it dies at `no_destination`.
BADPUB=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/partnerships -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"publisher_org_id\":\"$PRO_ID\"}")
[ "$BADPUB" = "400" ] && pass "partnership with a non-publisher rejected (400)" || fail "publisher guard: $BADPUB"

# Repricing: the promoter asks, the publisher decides, and the rates in force keep paying out
# the whole time. Ends where it started (10 / 50) — every payout assertion below is priced on it.
RATES() { curl -s -XPATCH $API/v1/partnerships/$PART_ID/rates -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$2"; }
NOTPRO=$(curl -s -o /dev/null -w '%{http_code}' -XPATCH $API/v1/partnerships/$PART_ID/rates -H "Authorization: Bearer $PUB_TOKEN" -H 'Content-Type: application/json' -d '{"coin_rate":9999}')
[ "$NOTPRO" = "404" ] && pass "publisher cannot reprice itself upward (404)" || fail "propose guard: $NOTPRO"
PROP=$(RATES "$PRO_TOKEN" '{"coin_rate":65,"guest_rate":12}')
[ "$(echo "$PROP" | j .coin_rate)" = "50" ] && [ "$(echo "$PROP" | j .proposed_coin_rate)" = "65" ] \
  && pass "proposed rate is stored without changing what pays out" || fail "propose: $PROP"
BADPAIR=$(curl -s -o /dev/null -w '%{http_code}' -XPATCH $API/v1/partnerships/$PART_ID/rates -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"coin_rate":5}')
[ "$BADPAIR" = "400" ] && pass "proposal below the guest tier rejected (400)" || fail "pair rule: $BADPAIR"
SELFOK=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/partnerships/$PART_ID/rates/accept -H "Authorization: Bearer $PRO_TOKEN")
[ "$SELFOK" = "404" ] && pass "promoter cannot approve its own proposal (404)" || fail "self-approval: $SELFOK"
DECL=$(curl -s -XPOST $API/v1/partnerships/$PART_ID/rates/decline -H "Authorization: Bearer $PUB_TOKEN")
[ -z "$(echo "$DECL" | j .proposed_coin_rate)" ] && [ "$(echo "$DECL" | j .coin_rate)" = "50" ] \
  && pass "publisher declines: proposal cleared, agreed rate untouched" || fail "decline: $DECL"
RATES "$PRO_TOKEN" '{"coin_rate":65,"guest_rate":12}' >/dev/null
ACC=$(curl -s -XPOST $API/v1/partnerships/$PART_ID/rates/accept -H "Authorization: Bearer $PUB_TOKEN")
[ "$(echo "$ACC" | j .coin_rate)" = "65" ] && [ "$(echo "$ACC" | j .guest_rate)" = "12" ] && [ -z "$(echo "$ACC" | j .proposed_coin_rate)" ] \
  && pass "publisher accepts: new rates take force, proposal cleared" || fail "accept: $ACC"
STALE=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/partnerships/$PART_ID/rates/accept -H "Authorization: Bearer $PUB_TOKEN")
[ "$STALE" = "404" ] && pass "an accepted proposal cannot be accepted twice (404)" || fail "replayed accept: $STALE"
RATES "$PRO_TOKEN" '{"coin_rate":50,"guest_rate":10}' >/dev/null
BACK=$(curl -s -XPOST $API/v1/partnerships/$PART_ID/rates/accept -H "Authorization: Bearer $PUB_TOKEN" | j .coin_rate)
[ "$BACK" = "50" ] && pass "repriced back to 10 / 50 for the payout assertions below" || fail "restore rates: $BACK"

echo "3. Campaign + funding"
CAMP=$(curl -s -XPOST $API/v1/campaigns -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"partnership_id\":\"$PART_ID\",\"name\":\"Inflight promo\"}")
CAMP_ID=$(echo "$CAMP" | j .id)
BUDGET=$(curl -s -XPOST $API/v1/campaigns/$CAMP_ID/fund -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"coins":100}' | j .budget)
[ "$BUDGET" = "100" ] && pass "campaign funded: 100 coins" || fail "budget=$BUDGET"
# A rename must not restate the status to keep it — a name-only patch that reset status would
# quietly reactivate a paused campaign, and the rest of this script runs on this one.
PAUSED=$(curl -s -XPATCH $API/v1/campaigns/$CAMP_ID -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"status":"paused"}' | j .status)
RENAMED=$(curl -s -XPATCH $API/v1/campaigns/$CAMP_ID -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Inflight promo v2"}')
[ "$PAUSED" = "paused" ] && [ "$(echo "$RENAMED" | j .name)" = "Inflight promo v2" ] && [ "$(echo "$RENAMED" | j .status)" = "paused" ] \
  && pass "promoter renamed the campaign without touching its status" || fail "patch campaign: $PAUSED / $RENAMED"
NOTMINE=$(curl -s -o /dev/null -w '%{http_code}' -XPATCH $API/v1/campaigns/$CAMP_ID -H "Authorization: Bearer $PUB_TOKEN" -H 'Content-Type: application/json' -d '{"name":"hijacked"}')
[ "$NOTMINE" = "403" ] && pass "publisher cannot rename the promoter's campaign (403)" || fail "rename guard: $NOTMINE"
curl -s -XPATCH $API/v1/campaigns/$CAMP_ID -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"status":"active"}' >/dev/null

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
# Asserted on the `/go/` hand-off, not on the heading: the copy is presentation and has already
# been reworded once, which failed this line while the mechanism it guards was working fine.
echo "$IOS_PAGE" | grep -q '/go/' && pass "iPhone scan serves the signal interstitial" || fail "no interstitial served"
echo "$IOS_PAGE" | grep -qE '(^|[^a-z])(st|token|jwt)=' && fail "interstitial leaks a redeemable token" \
  || pass "interstitial carries nothing the app could spend"
CLAIM=$(printf '%s' "$IOS_PAGE" | grep -o '/go/[A-Za-z0-9_-]\{6,\}' | head -1 | cut -d/ -f3)
[ -n "$CLAIM" ] && pass "interstitial hands the browser a forwarding hop" || fail "no /go hop in the page"

# What the page's script posts back, then the store hop itself.
STORE=$(curl -s -A "$IOS" -o /dev/null -w '%{redirect_url}' \
  "$API/go/$CLAIM?tz=Asia/Dhaka&sc=393x852@3&lang=en-US&cores=8&dark=1")
echo "$STORE" | grep -q '^https://apps.apple.com/app/id123456789$' \
  && pass "forwarding hop reaches the App Store listing, payload-free" || fail "go hop: $STORE"

# Stage one. Minutes after the scan, the app opens for the first time and the publisher's
# server presents the same signals. Nothing is paid here.
FO=$(curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"ip":"::1","platform":"ios","tz":"Asia/Dhaka","screen":"393x852@3","language":"en-US","cores":8,"dark":true}')
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

echo "6c. Repeat purchases — the same traveller, paid again for the next ticket"
# Everything above pays for an *acquisition*: one person, one signup, one fee, forever. This
# section is the other product. NovoAir sells a seat, its booking system mints a code against
# that booking, and the traveller who flies eleven times a year is paid eleven times.
#
# The whole difference is which guarantee applies. Acquisition: one payout per user per
# campaign. Engagement: one payout per issued code — so "one per purchase", because the only
# system that can know a purchase happened is the one that took the money.

ECAMP=$(curl -s -XPOST $API/v1/campaigns -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"partnership_id\":\"$PART_ID\",\"name\":\"Boarding pass rewards\",\"mode\":\"engagement\"}")
ECAMP_ID=$(echo "$ECAMP" | j .id)
[ "$(echo "$ECAMP" | j .mode)" = "engagement" ] && pass "engagement campaign created" || fail "mode: $ECAMP"
BADMODE=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/campaigns -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"partnership_id\":\"$PART_ID\",\"name\":\"x\",\"mode\":\"whatever\"}")
[ "$BADMODE" = "400" ] && pass "an unknown campaign mode is rejected (400)" || fail "mode guard: $BADMODE"
curl -s -XPOST $API/v1/campaigns/$ECAMP_ID/fund -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"coins":100}' >/dev/null

# Issuance. The booking system calls this, not a human — the portal's QR studio is for print
# artwork and this is one machine call per transaction.
ISS() { curl -s -XPOST $API/v1/issue -H "Authorization: Bearer $PRO_KEY" -H 'Content-Type: application/json' -d "$1"; }
T1=$(ISS "{\"campaign_id\":\"$ECAMP_ID\",\"issued_ref\":\"PNR-AAA$S\"}")
ECODE=$(echo "$T1" | j .code)
[ -n "$ECODE" ] && pass "promoter's booking system minted a code for one ticket" || fail "issue: $T1"
# A booking webhook fires twice. It must not hand one traveller two rewards for one seat.
T1B=$(ISS "{\"campaign_id\":\"$ECAMP_ID\",\"issued_ref\":\"PNR-AAA$S\"}")
[ "$(echo "$T1B" | j .code)" = "$ECODE" ] && [ "$(echo "$T1B" | j .replay)" = "true" ] \
  && pass "re-issuing the same booking reference replays the original code" || fail "issue idempotency: $T1B"
# Minting against an acquisition campaign would produce a code that scans, pays a signup fee
# once, and then silently never pays a purchase reward however many tickets are bought.
WRONGC=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/issue -H "Authorization: Bearer $PRO_KEY" \
  -H 'Content-Type: application/json' -d "{\"campaign_id\":\"$CAMP_ID\",\"issued_ref\":\"PNR-NOPE$S\"}")
[ "$WRONGC" = "404" ] && pass "cannot issue transaction codes against an acquisition campaign (404)" || fail "issue mode guard: $WRONGC"
# The publisher's key is not the promoter's, and neither opens the other's door.
XKEY=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/issue -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' -d "{\"campaign_id\":\"$ECAMP_ID\",\"issued_ref\":\"PNR-X$S\"}")
[ "$XKEY" = "401" ] && pass "a publisher key cannot mint transaction codes (401)" || fail "key separation: $XKEY"

# The scan. An engagement code is sent to the publisher's App Link so the OS can open the app
# when it is installed — the one question no server can answer and both platforms already do.
curl -s -XPATCH $API/v1/orgs/me -H "Authorization: Bearer $PUB_TOKEN" -H 'Content-Type: application/json' \
  -d '{"deeplink_url":"http://localhost:3000/publisher-sim"}' >/dev/null
ELOC=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$ECODE")
echo "$ELOC" | grep -q '^http://localhost:3000/publisher-sim?' \
  && pass "engagement scan is sent to the publisher's app link" || fail "engagement redirect: $ELOC"
echo "$ELOC" | grep -q "qrm_code=$ECODE" && pass "the transaction code travels to the app" || fail "no qrm_code: $ELOC"
# Built by us, not by the publisher's page: it contains the Play install referrer, and a
# referrer assembled wrong is an attribution rate of zero with no error anywhere.
echo "$ELOC" | grep -q 'qrm_fallback=https%3A%2F%2Fplay.google.com' \
  && pass "a phone without the app falls through to the store listing we built" || fail "no fallback: $ELOC"
echo "$ELOC" | grep -q 'qrm_claim' && pass "the fallback still carries the acquisition claim id" || fail "fallback lost the claim: $ELOC"

# The payout. No install stage, no fingerprint, no window to guess inside: the code names the
# purchase outright, which is stronger evidence than a referrer names a device.
EC() { curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' -d "$1"; }
FLYER="flyer$S@x.com"
E1=$(EC "{\"code\":\"$ECODE\",\"publisher_user_ref\":\"$FLYER\"}")
[ "$(echo "$E1" | j .attributed)" = "true" ] && pass "purchase reward paid on the transaction code" || fail "engagement claim: $E1"
[ "$(echo "$E1" | j .kind)" = "engagement" ] && pass "recorded as a repeat purchase, not a signup" || fail "kind: $E1"
[ "$(echo "$E1" | j .match_method)" = "code" ] && [ "$(echo "$E1" | j .confidence)" = "100" ] \
  && pass "match method is the code itself, at full confidence" || fail "method: $E1"
[ "$(echo "$E1" | j .fee)" = "20" ] && pass "paid at the engagement rate (20), not the signup rate" || fail "fee: $E1"
[ "$(echo "$E1" | j .pending_fee)" = "0" ] && pass "no guest tier — a repeat customer already transacted" || fail "pending: $E1"

# A lost response is the normal reason a publisher calls twice.
E1R=$(EC "{\"code\":\"$ECODE\",\"publisher_user_ref\":\"$FLYER\"}")
[ "$(echo "$E1R" | j .replay)" = "true" ] && [ "$(echo "$E1R" | j .attribution_id)" = "$(echo "$E1" | j .attribution_id)" ] \
  && pass "a retried claim replays the original answer" || fail "replay: $E1R"
# A forwarded screenshot is not a retry. Replaying here would hand a second person the reward
# the first one earned, and tell the publisher it was attributed.
ESTOLEN=$(EC "{\"code\":\"$ECODE\",\"publisher_user_ref\":\"thief$S@x.com\"}")
[ "$(echo "$ESTOLEN" | j .attributed)" = "false" ] && [ "$(echo "$ESTOLEN" | j .reason)" = "already_claimed" ] \
  && pass "a shared code pays the first user only, never a second" || fail "shared code: $ESTOLEN"

# THE HEADLINE. Same traveller, second ticket, second code — and they are paid again. This is
# the assertion the old UNIQUE (campaign_id, publisher_user_ref) made impossible, and the only
# reason this whole mode exists.
ECODE2=$(ISS "{\"campaign_id\":\"$ECAMP_ID\",\"issued_ref\":\"PNR-BBB$S\"}" | j .code)
curl -s -A "$ANDROID" -o /dev/null "$API/r/$ECODE2"
E2=$(EC "{\"code\":\"$ECODE2\",\"publisher_user_ref\":\"$FLYER\"}")
[ "$(echo "$E2" | j .attributed)" = "true" ] && [ "$(echo "$E2" | j .fee)" = "20" ] \
  && pass "the SAME traveller is paid again for a second ticket" || fail "repeat purchase refused: $E2"
[ "$(echo "$E2" | j .attribution_id)" != "$(echo "$E1" | j .attribution_id)" ] \
  && pass "the second purchase is its own attribution, not a replay of the first" || fail "collapsed into one: $E2"
EREM=$(curl -s $API/v1/campaigns/$ECAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$EREM" = "60" ] && pass "budget charged exactly twice (100→60), once per purchase" || fail "engagement budget: $EREM"

# The regression that matters most: acquisition mode must be bit-for-bit what it was. The
# partial index is the only thing standing between "paid twice for two tickets" and "paid
# twice for one signup", and the second one is a bug in the money path.
# A second, genuinely different scan of the acquisition code — a new claim id, a new pending
# attribution, everything the engagement flow would have been paid twice for. Here it must not
# be: the user has already counted for this campaign and the fee was bought once.
ALOC=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
AREF=$(printf '%s' "$ALOC" | sed 's/.*&referrer=//' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(decodeURIComponent(d.trim())))")
ABEFORE=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
AREPLAY=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$AREF\",\"publisher_user_ref\":\"viewer$S@x.com\"}")
[ "$(echo "$AREPLAY" | j .replay)" = "true" ] && [ "$(echo "$AREPLAY" | j .attribution_id)" = "$RED_ID" ] \
  && pass "acquisition still pays one fee per user per campaign, ever" || fail "acquisition regression: $AREPLAY"
AAFTER=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$AAFTER" = "$ABEFORE" ] && pass "the refused second acquisition moved no money" || fail "acquisition double-charged: $ABEFORE -> $AAFTER"
# And the two modes do not answer each other's questions.
NOTENG=$(EC "{\"code\":\"$CODE\",\"publisher_user_ref\":\"crossover$S@x.com\"}")
[ "$(echo "$NOTENG" | j .reason)" = "not_engagement" ] \
  && pass "a code from an acquisition campaign earns no purchase reward" || fail "cross-mode: $NOTENG"
BADCODE=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' -d "{\"code\":\"!!! not a code !!!\",\"publisher_user_ref\":\"x$S\"}")
[ "$BADCODE" = "400" ] && pass "a malformed code is a 400, never a silent fallthrough" || fail "code shape: $BADCODE"

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

# The SDK's own shape: it banked the claim id on device rather than replaying Play's whole
# referrer string, and it asserts whether the signup actually created an account.
LOC5=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
CLAIM5=$(printf '%s' "$LOC5" | sed 's/.*qrm_claim%3D//')
NEW_BEFORE=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
OLDUSER=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"claim_id\":\"$CLAIM5\",\"publisher_user_ref\":\"returning$S@x.com\",\"is_new_user\":false}" | j .reason)
[ "$OLDUSER" = "not_a_new_user" ] && pass "a returning account earns no fee, however it was matched" || fail "paid a returning user: $OLDUSER"
NEW_MID=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$NEW_MID" = "$NEW_BEFORE" ] && pass "the refusal costs the budget nothing" || fail "returning user charged: $NEW_BEFORE -> $NEW_MID"
# Same claim id still works, which is the point of refusing before anything is consumed.
BARE=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"claim_id\":\"$CLAIM5\",\"publisher_user_ref\":\"bare$S@x.com\",\"is_new_user\":true}")
[ "$(echo "$BARE" | j .match_method)" = "referrer" ] && pass "a bare claim_id matches deterministically, no referrer string needed" || fail "bare claim_id: $BARE"
BADCLAIM=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"claim_id\":\"../../etc/passwd\",\"ip\":\"203.0.113.7\",\"publisher_user_ref\":\"path$S@x.com\"}")
[ "$BADCLAIM" = "400" ] && pass "a malformed claim_id is a 400, never quietly re-matched on IP" || fail "bad claim_id: $BADCLAIM"
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

# ...and a signup that arrives one credit short must not burn the scan getting there. The
# scan is consumed before the fee is known (it depends on `identified`), so a plain return
# from the transaction used to commit that — leaving a real scanner permanently unattributable
# even after the promoter topped the budget back up, with the account already created.
# Two scans while the budget still allows them, then drain it with the first.
curl -s -XPOST $API/v1/campaigns/$CAMP_ID/fund -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"coins":50}' >/dev/null
ref_of() { printf '%s' "$1" | sed 's/.*&referrer=//' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(decodeURIComponent(d.trim())))"; }
R_A=$(ref_of "$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")")
R_B=$(ref_of "$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")")
curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$R_A\",\"publisher_user_ref\":\"drain$S@x.com\",\"identified\":true}" >/dev/null
BROKE=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$R_B\",\"publisher_user_ref\":\"short$S@x.com\",\"identified\":true}" | j .reason)
[ "$BROKE" = "budget_exhausted" ] && pass "signup past the budget is refused, not errored" || fail "expected budget_exhausted, got $BROKE"
curl -s -XPOST $API/v1/campaigns/$CAMP_ID/fund -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' -d '{"coins":50}' >/dev/null
AGAIN=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"install_referrer\":\"$R_B\",\"publisher_user_ref\":\"short$S@x.com\",\"identified\":true}" | j .attributed)
[ "$AGAIN" = "true" ] && pass "refusal released the scan — attributable once the budget is topped up" || fail "scan burned by budget_exhausted"

# Money in is replay-safe when the caller keys it: same key, one credit.
BEFORE=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
for _ in 1 2; do curl -s -XPOST $API/v1/campaigns/$CAMP_ID/fund -H "Authorization: Bearer $PRO_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"coins\":25,\"idempotency_key\":\"e2e-$S\"}" >/dev/null; done
AFTER=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
[ "$AFTER" = "$((BEFORE + 25))" ] && pass "retried funding credits once (idempotency key)" || fail "double-funded: $BEFORE → $AFTER"

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

# The promoter has funded, renamed and repriced by now, so the inbox must be carrying it. This
# is the notification path: one stream, and the actor is what decides whether it needs an eye.
NOTIF=$(A "$API/v1/admin/notifications?limit=500")
FUNDED=$(echo "$NOTIF" | j ".filter(n=>n.action==='campaign.fund'&&n.target==='campaign:$CAMP_ID')[0].detail.budget")
[ -n "$FUNDED" ] && pass "promoter's budget top-up reached the admin inbox (budget $FUNDED)" || fail "no fund notification: $NOTIF"
# Everything a tenant has done in the sections above, from the one stream. A write that stops
# emitting is a write the admin silently loses sight of, so the whole set is asserted at once.
for WROTE in partnership.create partnership.accept campaign.create campaign.patch \
             partnership.rates.propose partnership.rates.accept partnership.rates.decline \
             org.patch qr_code.void; do
  echo "$NOTIF" | grep -q "$WROTE" || fail "no notification for $WROTE"
done
pass "every tenant write reaches the inbox (9 kinds, one stream)"
[ "$(echo "$OV" | j .open_notifications)" -ge 2 ] && pass "overview counts the unacknowledged ones" || fail "open_notifications: $OV"
NID=$(echo "$NOTIF" | j ".filter(n=>n.action==='campaign.fund')[0].id")
ACKED=$(A -XPOST $API/v1/admin/notifications/ack -H 'Content-Type: application/json' -d "{\"ids\":[\"$NID\"]}" | j .acknowledged)
LEFT=$(A "$API/v1/admin/notifications?limit=500" | j ".filter(n=>n.id==='$NID').length")
AGAIN=$(A -XPOST $API/v1/admin/notifications/ack -H 'Content-Type: application/json' -d "{\"ids\":[\"$NID\"]}" | j .acknowledged)
[ "$ACKED" = "1" ] && [ "$LEFT" = "0" ] && [ "$AGAIN" = "0" ] \
  && pass "acknowledging clears it from the inbox exactly once" || fail "ack=$ACKED left=$LEFT again=$AGAIN"
# ...and the record itself is untouched: the audit log is not an inbox and does not empty.
A "$API/v1/admin/audit-log?limit=500" | grep -q 'campaign.fund' && pass "the audit log still holds it" || fail "ack deleted history"
ACKALL=$(A -XPOST $API/v1/admin/notifications/ack -H 'Content-Type: application/json' -d '{}' | j .acknowledged)
EMPTY=$(A "$API/v1/admin/notifications" | j .length)
[ "$ACKALL" -ge 1 ] && [ "$EMPTY" = "0" ] && pass "mark-all-handled empties the inbox ($ACKALL entries)" || fail "ack all: $ACKALL / $EMPTY"

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

# Relative to whatever is left, not an absolute: this asserted `75` on the assumption that
# section 9 had drained the campaign to exactly zero, which coupled it to every earlier
# section's arithmetic and broke the moment one of them spent differently.
PRE_ADJ=$(curl -s $API/v1/campaigns/$CAMP_ID/stats -H "Authorization: Bearer $PRO_TOKEN" | j .budget_remaining)
ADJ=$(A -XPOST $API/v1/admin/campaigns/$CAMP_ID/adjust -H 'Content-Type: application/json' -d '{"coins":75,"reason":"goodwill"}' | j .budget)
[ "$ADJ" = "$((PRE_ADJ + 75))" ] && pass "admin budget adjustment credits the campaign" || fail "adjust: $PRE_ADJ → $ADJ"
# The inbox was emptied above, and this credit was the platform's own doing — an admin must not
# be notified of itself, or the badge never reaches zero and stops meaning anything.
SELFNOTIF=$(A "$API/v1/admin/notifications" | j .length)
[ "$SELFNOTIF" = "0" ] && pass "admin's own adjustment raises no notification" || fail "self-notification: $SELFNOTIF"
OVER=$(A -XPOST $API/v1/admin/campaigns/$CAMP_ID/adjust -H 'Content-Type: application/json' -d '{"coins":-999}' | j .statusCode)
[ "$OVER" = "400" ] && pass "clawback below zero rejected" || fail "overdraw: $OVER"

# per-code override: a permanent code on store signage escapes the single-use default
OVR=$(A -XPATCH $API/v1/admin/qr-codes/$ONCE_ID -H 'Content-Type: application/json' \
  -d '{"max_uses":null,"expires_at":null,"voided":false,"reason":"permanent store signage"}')
[ "$(echo "$OVR" | j .max_uses)" = "" ] && pass "admin can lift a code's single-use limit" || fail "override: $OVR"
REOPENED=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$ONCE_CODE")
echo "$REOPENED" | grep -q 'play.google.com' && pass "overridden code scans again" || fail "override not applied: $REOPENED"
A $API/v1/admin/audit-log | grep -q 'permanent store signage' && pass "every override lands in the audit log" || fail "no audit entry"

# Suspending a partnership is the lever for "stop this relationship now". It was checked only
# when a campaign was created, so afterwards it changed nothing at all: scans kept redirecting
# and claims kept paying out against a partnership under no agreement.
SUSPEND=$(A -XPATCH $API/v1/admin/partnerships/$PART_ID -H 'Content-Type: application/json' -d '{"status":"suspended"}' | j .status)
[ "$SUSPEND" = "suspended" ] && pass "admin can suspend a partnership" || fail "suspend: $SUSPEND"
# ...and the publisher cannot lift it. This used to be one call: `accept` moved any partnership
# of yours to `active` regardless of where it started, so the org being suspended was the org
# that could undo the suspension.
UNDO=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/partnerships/$PART_ID/accept -H "Authorization: Bearer $PUB_TOKEN")
[ "$UNDO" = "404" ] && pass "...which the publisher cannot re-accept its way out of" || fail "publisher lifted an admin suspension: HTTP $UNDO"
HELD=$(curl -s -A "$ANDROID" -o /dev/null -w '%{redirect_url}' "$API/r/$CODE")
echo "$HELD" | grep -q 'reason=partnership_inactive' && pass "an inactive partnership stops scans" || fail "suspended partnership still redirects: $HELD"
HELDCLAIM=$(curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"publisher_user_ref\":\"held$S@x.com\",\"ip\":\"::1\",\"platform\":\"ios\"}" | j .attributed)
[ "$HELDCLAIM" = "false" ] && pass "...and stops claims paying out against it" || fail "suspended partnership still pays: $HELDCLAIM"
A -XPATCH $API/v1/admin/partnerships/$PART_ID -H 'Content-Type: application/json' -d '{"status":"active"}' >/dev/null

echo "11b. The business layer: revenue, money in, money out"
# Runs here on purpose: after section 11 has finished counting the admin inbox (these flows
# add audit entries of their own) and before section 12 offboards the publisher.

# ---------- the platform's cut ----------
# Every payout writes three rows under one ref: the campaign is debited the gross, the
# publisher credited its net, and the platform credited the difference. The invariant worth
# asserting is not any single number but that those three still reconcile — a cut that rounds
# independently of the net is a book that silently stops balancing.
PLATFORM_REV=$(q "SELECT coalesce(sum(amount),0) FROM ledger_entries WHERE account='platform:fees'")
[ "$PLATFORM_REV" -gt 0 ] && pass "the platform earns a fee on every payout ($PLATFORM_REV credits)" \
  || fail "platform:fees is empty — the business model is not wired to the ledger"
# Gross spent by campaigns on payouts == publisher net + platform cut, exactly.
SPENT=$(q "SELECT coalesce(-sum(amount),0) FROM ledger_entries WHERE account LIKE 'campaign:%' AND amount<0 AND (ref LIKE 'redemption:%' OR ref LIKE 'upgrade:%')")
CREDITED=$(q "SELECT coalesce(sum(amount),0) FROM ledger_entries WHERE amount>0 AND (ref LIKE 'redemption:%' OR ref LIKE 'upgrade:%')")
[ "$SPENT" = "$CREDITED" ] && pass "every payout splits without losing a credit ($SPENT out = $CREDITED in)" \
  || fail "payout split leaks: campaigns spent $SPENT, accounts received $CREDITED"
# ...and no single payout ref is unbalanced, which a global sum could hide.
BADREF=$(q "SELECT count(*) FROM (SELECT ref FROM ledger_entries GROUP BY ref HAVING sum(amount)<>0) x")
[ "$BADREF" = "0" ] && pass "every ledger ref sums to zero individually" || fail "$BADREF unbalanced refs"

# ---------- money in: PSP checkout + signed webhook ----------
BUDGET_BEFORE=$(q "SELECT coalesce(balance,0) FROM account_balances WHERE account='campaign:$CAMP_ID'")
CHECKOUT=$(curl -s -XPOST $API/v1/payments/checkout -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"campaign_id\":\"$CAMP_ID\",\"coins\":500}")
PAY_ID=$(echo "$CHECKOUT" | j .payment_id)
[ -n "$PAY_ID" ] && [ "$(echo "$CHECKOUT" | j .status)" = "pending" ] \
  && pass "checkout records an intended funding before any money moves" || fail "checkout: $CHECKOUT"
# Nothing is credited until the provider confirms — a pending row must not spend.
MID=$(q "SELECT coalesce(balance,0) FROM account_balances WHERE account='campaign:$CAMP_ID'")
[ "$MID" = "$BUDGET_BEFORE" ] && pass "a pending payment credits nothing" || fail "budget moved on checkout: $MID"

HOOK_BODY="{\"payment_id\":\"$PAY_ID\",\"provider_ref\":\"pi_test_$S\",\"status\":\"succeeded\"}"
SECRET=$(sed -n 's/^PAYMENT_WEBHOOK_SECRET=//p' .env | head -1)
SIG=$(node -e "console.log(require('crypto').createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$HOOK_BODY")
# An unsigned or wrongly-signed callback is the whole attack surface of money-in: it mints
# budget for whoever finds the URL.
BADSIG=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/payments/webhook -H 'Content-Type: application/json' \
  -H 'x-payment-signature: 0000000000000000000000000000000000000000000000000000000000000000' --data-binary "$HOOK_BODY")
[ "$BADSIG" = "401" ] && pass "a wrongly-signed payment webhook is refused (401)" || fail "bad signature accepted: $BADSIG"
UNSIGNED=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/payments/webhook -H 'Content-Type: application/json' --data-binary "$HOOK_BODY")
[ "$UNSIGNED" = "401" ] && pass "an unsigned payment webhook is refused (401)" || fail "unsigned accepted: $UNSIGNED"

PAID=$(curl -s -XPOST $API/v1/payments/webhook -H 'Content-Type: application/json' \
  -H "x-payment-signature: $SIG" --data-binary "$HOOK_BODY")
[ "$(echo "$PAID" | j .status)" = "completed" ] && pass "a signed webhook completes the payment" || fail "webhook: $PAID"
BUDGET_AFTER=$(q "SELECT balance FROM account_balances WHERE account='campaign:$CAMP_ID'")
[ "$BUDGET_AFTER" = "$((BUDGET_BEFORE + 500))" ] && pass "confirmed payment credits the campaign budget (+500)" \
  || fail "budget $BUDGET_BEFORE -> $BUDGET_AFTER, expected +500"
# A PSP redelivers. At-least-once is the normal contract, so crediting twice is the default bug.
REPLAY=$(curl -s -XPOST $API/v1/payments/webhook -H 'Content-Type: application/json' \
  -H "x-payment-signature: $SIG" --data-binary "$HOOK_BODY")
[ "$(echo "$REPLAY" | j .replay)" = "true" ] && pass "a redelivered webhook replays instead of re-crediting" || fail "replay: $REPLAY"
BUDGET_REPLAY=$(q "SELECT balance FROM account_balances WHERE account='campaign:$CAMP_ID'")
[ "$BUDGET_REPLAY" = "$BUDGET_AFTER" ] && pass "...and the budget is unchanged by the redelivery" \
  || fail "double credit: $BUDGET_AFTER -> $BUDGET_REPLAY"

# ---------- money out: settlement-gated withdrawals ----------
ME=$(curl -s "$API/v1/orgs/me" -H "Authorization: Bearer $PUB_TOKEN")
EARN=$(echo "$ME" | j .earnings); AVAIL=$(echo "$ME" | j .withdrawable)
[ -n "$AVAIL" ] && [ "$AVAIL" -le "$EARN" ] && pass "publisher sees what has cleared settlement ($AVAIL of $EARN)" \
  || fail "withdrawable=$AVAIL earnings=$EARN"
OVERDRAW=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/withdrawals -H "Authorization: Bearer $PUB_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"coins\":$((EARN + 1000))}")
[ "$OVERDRAW" = "400" ] && pass "a publisher cannot withdraw more than it has earned" || fail "overdraw allowed: $OVERDRAW"
WD=$(curl -s -XPOST $API/v1/withdrawals -H "Authorization: Bearer $PUB_TOKEN" -H 'Content-Type: application/json' -d '{"coins":40}')
WD_ID=$(echo "$WD" | j .id)
[ "$(echo "$WD" | j .status)" = "requested" ] && pass "publisher requests a payout (40 credits)" || fail "withdrawal: $WD"
# The request holds no money yet — the ledger must not move until an admin decides.
BAL_REQ=$(q "SELECT balance FROM account_balances WHERE account='publisher:$PUB_ID'")
[ "$BAL_REQ" = "$EARN" ] && pass "a requested payout moves no money" || fail "balance moved on request: $BAL_REQ"
# ...but it is reserved, so a second request cannot promise the same credits twice.
AVAIL2=$(curl -s "$API/v1/orgs/me" -H "Authorization: Bearer $PUB_TOKEN" | j .withdrawable)
[ "$AVAIL2" = "$((AVAIL - 40))" ] && pass "a queued request is reserved against further withdrawals" \
  || fail "withdrawable $AVAIL -> $AVAIL2, expected $((AVAIL - 40))"
PAYOUT=$(A -XPOST $API/v1/admin/withdrawals/$WD_ID/pay -H 'Content-Type: application/json' -d '{"note":"bank ref 99"}')
[ "$(echo "$PAYOUT" | j .status)" = "paid" ] && pass "admin approves it and the money leaves" || fail "pay: $PAYOUT"
BAL_PAID=$(q "SELECT balance FROM account_balances WHERE account='publisher:$PUB_ID'")
[ "$BAL_PAID" = "$((EARN - 40))" ] && pass "publisher balance debited exactly once (-40)" || fail "balance=$BAL_PAID expected $((EARN - 40))"
PAYOUTS=$(q "SELECT coalesce(sum(amount),0) FROM ledger_entries WHERE account='external:payouts'")
[ "$PAYOUTS" -ge 40 ] && pass "the payout is recorded as money leaving the platform" || fail "external:payouts=$PAYOUTS"
TWICE=$(A -o /dev/null -w '%{http_code}' -XPOST $API/v1/admin/withdrawals/$WD_ID/pay -H 'Content-Type: application/json' -d '{}')
[ "$TWICE" = "404" ] && pass "paying the same withdrawal twice is refused" || fail "double payout: $TWICE"
SUM3=$(q "SELECT sum(amount) FROM ledger_entries")
[ "$SUM3" = "0" ] && pass "ledger still balances after real money moved in and out" || fail "ledger sum=$SUM3"

# ---------- publisher vetting ----------
# The dev stack auto-approves so the demo works; production does not. Flip this one publisher
# to the production behaviour to prove the gate is real rather than merely configured.
NEWPUB=$(curl -s -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"Unvetted $S\",\"email\":\"unvetted$S@t.com\",\"password\":\"password123\",\"type\":\"publisher\",\"landing_url\":\"https://unvetted.example/get\"}")
NEWPUB_ID=$(echo "$NEWPUB" | j .org.id)
q "UPDATE orgs SET approved=false WHERE id='$NEWPUB_ID'" >/dev/null
HIDDEN=$(curl -s "$API/v1/publishers" -H "Authorization: Bearer $PRO_TOKEN" | grep -c "Unvetted $S" || true)
[ "$HIDDEN" = "0" ] && pass "an unapproved publisher is hidden from the directory" || fail "unvetted publisher listed"
BLOCKED=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/partnerships -H "Authorization: Bearer $PRO_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"publisher_org_id\":\"$NEWPUB_ID\"}")
[ "$BLOCKED" = "400" ] && pass "...and cannot be partnered with, so it can never be paid" || fail "partnered with unvetted: $BLOCKED"
A -XPATCH $API/v1/admin/orgs/$NEWPUB_ID -H 'Content-Type: application/json' -d '{"approved":true}' >/dev/null
SHOWN=$(curl -s "$API/v1/publishers" -H "Authorization: Bearer $PRO_TOKEN" | grep -c "Unvetted $S" || true)
[ "$SHOWN" = "1" ] && pass "admin approval puts it in the directory" || fail "approval did not publish it"

# ---------- account recovery ----------
RT=$(A -XPOST $API/v1/admin/orgs/$NEWPUB_ID/reset-token | j .reset_token)
[ -n "$RT" ] && pass "admin issues a single-use reset token" || fail "no reset token"
RESET=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/auth/reset -H 'Content-Type: application/json' \
  -d "{\"token\":\"$RT\",\"password\":\"brand-new-password\"}")
[ "$RESET" = "201" ] && pass "the locked-out tenant sets a new password" || fail "reset: $RESET"
RELOGIN=$(curl -s -XPOST $API/v1/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"unvetted$S@t.com\",\"password\":\"brand-new-password\"}" | j .token)
[ -n "$RELOGIN" ] && pass "...and can log in with it" || fail "new password rejected"
REUSE=$(curl -s -o /dev/null -w '%{http_code}' -XPOST $API/v1/auth/reset -H 'Content-Type: application/json' \
  -d "{\"token\":\"$RT\",\"password\":\"another-password\"}")
[ "$REUSE" = "401" ] && pass "a spent reset token cannot be replayed" || fail "token reusable: $REUSE"

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
