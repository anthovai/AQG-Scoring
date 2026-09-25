#!/usr/bin/env bash
# deploy AQG UAT ขึ้นเซิร์ฟเวอร์ — รันจากเครื่อง dev
#
#   bash tools/deploy-uat.sh                       # ใช้ค่าเริ่มต้น (root@152.42.177.130)
#   HOST=root@1.2.3.4 bash tools/deploy-uat.sh     # เปลี่ยนปลายทาง
#   SKIP_VIDEO=1 bash tools/deploy-uat.sh          # อัปเฉพาะโค้ด (วีดีโออยู่บนเซิร์ฟเวอร์แล้ว)
#
# สิ่งที่ทำ:
#   1. rsync โค้ด + วีดีโอไปที่ /opt/aqg บนเซิร์ฟเวอร์ (ไม่เอา results/ ของเครื่อง dev ไป)
#   2. สร้าง .env พร้อม admin key ถ้ายังไม่มี
#   3. docker compose up -d --build
#   4. ตรวจว่า https ใช้งานได้
set -euo pipefail

HOST="${HOST:-root@152.42.177.130}"
DIR="${DIR:-/opt/aqg}"
DOMAIN="${DOMAIN:-aqg-uat.152.42.177.130.sslip.io}"
COMPOSE="${COMPOSE:-docker-compose.yml}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ ปลายทาง: $HOST:$DIR   (โดเมน $DOMAIN)"
ssh "$HOST" "mkdir -p $DIR/video"

echo "→ อัปโค้ด"
rsync -az --delete \
  --exclude 'results/' --exclude 'logs/' --exclude '.git/' \
  --exclude 'video/' --exclude 'tools/shots/' --exclude 'config/admin-key.txt' \
  --exclude '*.pdf' \
  "$HERE/" "$HOST:$DIR/"

if [ "${SKIP_VIDEO:-0}" != "1" ]; then
  echo "→ อัปวีดีโอรุ่นเว็บ (261 MB — ครั้งแรกจะนาน)"
  rsync -az --progress "$HERE/video/"S0*-web.mp4 "$HOST:$DIR/video/"
fi

echo "→ เตรียม .env (admin key)"
ssh "$HOST" "cd $DIR && [ -f .env ] || printf 'AQG_ADMIN_KEY=%s\n' \"\$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')\" > .env && chmod 600 .env"

echo "→ build + start"
ssh "$HOST" "cd $DIR && docker compose -f $COMPOSE up -d --build"

echo "→ ตรวจผล"
sleep 6
ssh "$HOST" "cd $DIR && docker compose -f $COMPOSE ps"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/api/config" || true)
echo
if [ "$code" = "200" ]; then
  echo "✅ ใช้งานได้แล้ว: https://$DOMAIN"
  echo "   หลังบ้าน:    https://$DOMAIN/admin.html"
  echo "   admin key:  $(ssh "$HOST" "grep AQG_ADMIN_KEY $DIR/.env | cut -d= -f2")"
else
  echo "⚠️  ยังเรียกผ่าน https ไม่ได้ (HTTP $code)"
  echo "   ดู log:  ssh $HOST 'cd $DIR && docker compose logs --tail 50'"
  echo "   ถ้าเซิร์ฟเวอร์ยังไม่มี reverse proxy ให้ใช้:  COMPOSE=docker-compose.caddy.yml bash tools/deploy-uat.sh"
fi
