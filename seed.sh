#!/usr/bin/env bash
# Creates a ready-to-use promoter + publisher + accepted partnership + funded campaign + QR.
set -euo pipefail
API=${API:-http://localhost:4000}
S=$RANDOM
j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)$1??'')}catch(e){console.log('')}})"; }

PUB=$(curl -s -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"DramaBox\",\"email\":\"publisher$S@demo.com\",\"password\":\"password123\",\"type\":\"publisher\",\"landing_url\":\"http://localhost:3000/publisher-sim\"}")
PUB_TOKEN=$(echo "$PUB" | j .token); PUB_ID=$(echo "$PUB" | j .org.id); API_KEY=$(echo "$PUB" | j .api_key)

PRO=$(curl -s -XPOST $API/v1/auth/signup -H 'Content-Type: application/json' \
  -d "{\"name\":\"Air Dhaka\",\"email\":\"promoter$S@demo.com\",\"password\":\"password123\",\"type\":\"promoter\"}")
PRO_TOKEN=$(echo "$PRO" | j .token)

PART=$(curl -s -XPOST $API/v1/partnerships -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"publisher_org_id\":\"$PUB_ID\",\"coin_rate\":50}" | j .id)
curl -s -XPOST $API/v1/partnerships/$PART/accept -H "Authorization: Bearer $PUB_TOKEN" >/dev/null

CAMP=$(curl -s -XPOST $API/v1/campaigns -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"partnership_id\":\"$PART\",\"name\":\"Inflight entertainment promo\"}" | j .id)
curl -s -XPOST $API/v1/campaigns/$CAMP/fund -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d '{"coins":5000}' >/dev/null
CODE=$(curl -s -XPOST $API/v1/campaigns/$CAMP/qr-codes -H "Authorization: Bearer $PRO_TOKEN" -H 'Content-Type: application/json' \
  -d '{"style":{"dark":"#3730a3","light":"#ffffff","size":512,"margin":3,"ecc":"Q"}}' | j .code)

cat <<EOF

  Seeded. Sign in at http://localhost:3000/login

  Promoter   promoter$S@demo.com   password123   (Air Dhaka — 5000 coin budget)
  Publisher  publisher$S@demo.com  password123   (DramaBox — 50 coins/signup)

  Publisher API key   $API_KEY
  Scan this QR URL    $API/r/$CODE

  Open the scan URL in a private window to run the end-user flow.
  Paste the API key into the publisher-sim form (it stands in for the publisher's server config).
EOF
