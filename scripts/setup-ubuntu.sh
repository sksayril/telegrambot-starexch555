#!/usr/bin/env bash
# Full Ubuntu server setup for telegrambot-starexch555
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Project: $ROOT"
echo "==> OS: $(uname -a)"

if [ ! -f .env ]; then
  echo "ERROR: .env missing. Copy from Windows or create it."
  echo "  BOT_TOKEN=123456:AAH..."
  echo "  ADMIN_IDS=your_telegram_id"
  echo "  HEADLESS=true"
  echo "  HANDLER_TIMEOUT_MS=300000"
  exit 1
fi

# Fix common bad token: duplicated bot id (123:123:AAH...)
if grep -qE '^BOT_TOKEN=[0-9]+:[0-9]+:' .env; then
  echo "==> Fixing duplicated BOT_TOKEN in .env..."
  sed -i -E 's/^BOT_TOKEN=([0-9]+):\1:/BOT_TOKEN=\1:/' .env
fi

echo "==> Installing npm packages..."
npm install

echo "==> Installing Chrome for Puppeteer..."
npx puppeteer browsers install chrome || true

echo "==> Installing Ubuntu system libraries..."
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates fonts-liberation \
  libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
  libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 \
  libnspr4 libnss3 libpango-1.0-0 \
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxrandr2 libxshmfence1 \
  wget xdg-utils || true

# alsa package name differs by Ubuntu version
sudo apt-get install -y libasound2t64 2>/dev/null || sudo apt-get install -y libasound2 2>/dev/null || true
sudo apt-get install -y chromium-browser 2>/dev/null || sudo apt-get install -y chromium 2>/dev/null || true

echo "==> Running setup check..."
node scripts/check-setup.js

echo ""
echo "==> Done. Start with PM2:"
echo "  pm2 delete telegrambot2 2>/dev/null || true"
echo "  pm2 start bot.js --name telegrambot2"
echo "  pm2 save"
echo "  pm2 logs telegrambot2"
