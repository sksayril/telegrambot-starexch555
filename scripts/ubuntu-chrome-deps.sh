#!/usr/bin/env bash
# Install Chrome + system libraries needed by Puppeteer on Ubuntu/Debian.
set -euo pipefail

echo "==> Installing Chromium/Chrome runtime dependencies..."
sudo apt-get update -y

# Package names differ slightly across Ubuntu versions
sudo apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libasound2t64 || sudo apt-get install -y libasound2 || true

sudo apt-get install -y \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libxshmfence1 \
  wget \
  xdg-utils \
  chromium-browser || sudo apt-get install -y chromium || true

echo "==> Installing Puppeteer Chrome binary..."
cd "$(dirname "$0")/.."
npx puppeteer browsers install chrome

echo "==> Done."
echo "Optional: set CHROME_PATH in .env if needed, e.g."
echo "  CHROME_PATH=/usr/bin/google-chrome-stable"
echo "  CHROME_PATH=/usr/bin/chromium-browser"
