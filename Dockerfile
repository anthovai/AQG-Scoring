# AQG — ไม่มี dependency ใดๆ ใช้ node เปล่าๆ
FROM node:22-alpine

WORKDIR /app

# โค้ดและสื่อทั้งหมด (วีดีโอถูก mount เป็น volume ตอนรัน ดู docker-compose.yml)
COPY server.js package.json ./
COPY index.html admin.html app.js styles.css ./
COPY data ./data
COPY assets ./assets
COPY tools/check.js ./tools/check.js

# results/ และ config/ ผูกเป็น volume เพื่อให้ข้อมูลอยู่รอดตอน redeploy
RUN mkdir -p /app/results /app/config /app/video

ENV PORT=5190
EXPOSE 5190

# ตรวจว่ายังตอบสนองอยู่ (docker จะรีสตาร์ตให้ถ้าเสีย)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5190/api/config >/dev/null || exit 1

CMD ["node", "server.js"]
