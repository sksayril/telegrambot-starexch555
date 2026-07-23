#!/usr/bin/env bash
# Install REAL Google Chrome on Ubuntu (not Puppeteer cache).
set -euo pipefail

echo "==> Installing Google Chrome (stable) on Ubuntu..."

sudo apt-get update -y
sudo apt-get install -y wget gnupg ca-certificates

# Google Chrome repo
wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y /tmp/google-chrome.deb || sudo dpkg -i /tmp/google-chrome.deb
sudo apt-get install -f -y

echo "==> Chrome version:"
google-chrome-stable --version || google-chrome --version

CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome)"
echo "==> Chrome path: $CHROME_BIN"

# Write/update CHROME_PATH in project .env
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  if grep -q '^CHROME_PATH=' "$ENV_FILE"; then
    sed -i "s|^CHROME_PATH=.*|CHROME_PATH=$CHROME_BIN|" "$ENV_FILE"
  else
    echo "CHROME_PATH=$CHROME_BIN" >> "$ENV_FILE"
  fi
  # Prefer system chrome
  if grep -q '^PREFER_SYSTEM_CHROME=' "$ENV_FILE"; then
    sed -i 's|^PREFER_SYSTEM_CHROME=.*|PREFER_SYSTEM_CHROME=true|' "$ENV_FILE"
  else
    echo "PREFER_SYSTEM_CHROME=true" >> "$ENV_FILE"
  fi
  echo "==> Updated $ENV_FILE"
else
  echo "CHROME_PATH=$CHROME_BIN" > "$ENV_FILE"
  echo "PREFER_SYSTEM_CHROME=true" >> "$ENV_FILE"
  echo "HEADLESS=true" >> "$ENV_FILE"
  echo "==> Created $ENV_FILE (add BOT_TOKEN / ADMIN_IDS yourself)"
fi

echo ""
echo "✅ Done. Test:"
echo "  $CHROME_BIN --headless --disable-gpu --no-sandbox --dump-dom https://example.com | head"
echo "  cd $ROOT && npm run check"
echo "  pm2 restart telegrambot-2"
