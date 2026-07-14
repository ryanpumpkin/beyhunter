#!/usr/bin/env bash
# beyhunter → NAS Docker host 部署。冇 git、冇 registry，直接檔案同步後 rebuild。
#
# 用法：./deploy.sh
#
# 點解係咁（摸過嘅坑，唔好改返轉頭）：
#   1. 推 source 用 tar-over-ssh，唔用 scp/rsync：NAS 個 sshd 冇 sftp subsystem
#      （scp 會 "subsystem request failed"），但 plain ssh 通，所以 tar | ssh 'tar x'。
#   2. rebuild 用 sudo docker-compose（有連字號）：呢部 NAS 係舊版 standalone
#      docker-compose v2.9，唔係新 `docker compose` plugin（會出 help）。
#   3. docker daemon socket 要 root：已設 passwordless sudo，所以 sudo -n 唔使打密碼。
#   4. 一定要 --build：server/ 同 shops.json 都係 COPY 入 image 嘅，淨係 restart
#      唔會 pick up 到任何 source/config 改動。
set -euo pipefail

# ---- NAS 連線設定（要改就改呢度，或用環境變數 override）----
NAS_HOST="${NAS_HOST:-192.168.0.100}"
NAS_PORT="${NAS_PORT:-1281}"
NAS_USER="${NAS_USER:-ryanpumpkin}"
NAS_DIR="${NAS_DIR:-/volume1/docker/beyhunter}"
DOCKER="/usr/local/bin/docker"
COMPOSE="/usr/local/bin/docker-compose"

SSH="ssh -p ${NAS_PORT} -o ConnectTimeout=10 ${NAS_USER}@${NAS_HOST}"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "▶ 推 source 上 ${NAS_USER}@${NAS_HOST}:${NAS_DIR} ..."
# COPYFILE_DISABLE=1：唔好連 macOS ._ AppleDouble metadata 一齊 tar（否則 NAS 會
# 出一堆 "Ignoring unknown extended header" 警告，兼污染目錄）。
# 只推 build context 需要嘅嘢；.env / *.db / wwebjs session / node_modules 一律唔郁,
# NAS 上果份為準（DB 同 WhatsApp 登入 session 喺 docker volume，唔受影響）。
COPYFILE_DISABLE=1 tar czf - \
  --exclude='node_modules' \
  --exclude='web/node_modules' \
  --exclude='web/dist' \
  --exclude='*.db' --exclude='*.db-*' \
  --exclude='.wwebjs_*' \
  --exclude='.git' --exclude='.DS_Store' \
  --exclude='graphify-out' --exclude='.claude-flow' \
  server web package.json package-lock.json Dockerfile docker-compose.yml .dockerignore \
  | $SSH "cd '${NAS_DIR}' && tar xzf -"
echo "✓ 檔案已同步"

echo "▶ rebuild + 重啟（npm install + web build，可能幾分鐘）..."
$SSH "cd '${NAS_DIR}' && sudo -n ${COMPOSE} up -d --build"

echo "▶ 等 healthcheck 轉 healthy ..."
health="?"
for _ in $(seq 1 12); do
  health="$($SSH "sudo -n ${DOCKER} inspect --format '{{.State.Health.Status}}' beyhunter" 2>/dev/null || echo '?')"
  echo "  health: ${health}"
  [ "${health}" = "healthy" ] && break
  sleep 5
done

echo "▶ fetcher 啟動狀況（巡查間隔 + error）："
$SSH "sudo -n ${DOCKER} logs --since 90s beyhunter 2>&1 | grep -iE '巡一次|error|抓取失敗|listen|started' | head -20" || true

if [ "${health}" = "healthy" ]; then
  echo "✓ 部署完成，container healthy"
else
  echo "⚠ 部署完成但 healthcheck 未 healthy（現狀：${health}）——上面 log 睇下發生咩事"
  exit 1
fi
