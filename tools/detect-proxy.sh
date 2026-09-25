#!/bin/sh
# ตรวจการตั้งค่า reverse proxy บนเซิร์ฟเวอร์ แล้วพิมพ์ค่าที่ deploy script เอาไปใช้
# เกณฑ์: ยึดจากบริการที่ใช้งานได้จริงอยู่แล้ว (เช่น luckydraw) เป็นต้นแบบก่อน
docker ps --format '{{.Names}}' > /tmp/_aqg_ps 2>/dev/null

PROXY=$(grep -iE 'traefik' /tmp/_aqg_ps | head -1)
echo "PROXY=$PROXY"
if [ -n "$PROXY" ]; then
  docker inspect "$PROXY" --format '{{range $k,$v := .NetworkSettings.Networks}}PNET={{$k}}
{{end}}' 2>/dev/null
  docker inspect "$PROXY" --format '{{range .Config.Cmd}}{{println .}}{{end}}{{range .Args}}{{println .}}{{end}}' 2>/dev/null \
    | grep -E 'certificatesresolvers|entrypoints' | sed 's/^/PARG=/'
fi

# บริการอ้างอิงที่ทำงานได้อยู่แล้ว
REF=$(grep -ivE 'traefik|aqg' /tmp/_aqg_ps | head -5 | tr '\n' ' ')
echo "CANDIDATES=$REF"
for c in $REF; do
  n=$(docker inspect "$c" --format '{{range $k,$v := .Config.Labels}}{{if eq $k "traefik.enable"}}{{$v}}{{end}}{{end}}' 2>/dev/null)
  [ "$n" = "true" ] || continue
  echo "REF=$c"
  docker inspect "$c" --format '{{range $k,$v := .NetworkSettings.Networks}}RNET={{$k}}
{{end}}' 2>/dev/null
  docker inspect "$c" --format '{{range $k,$v := .Config.Labels}}RLBL={{$k}}={{$v}}
{{end}}' 2>/dev/null | grep -i 'traefik'
  break
done

docker network ls --format 'NETLIST={{.Name}}' 2>/dev/null
rm -f /tmp/_aqg_ps
