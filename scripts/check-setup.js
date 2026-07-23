#!/usr/bin/env node
/**
 * Quick health check for Windows + Ubuntu.
 * Run: node scripts/check-setup.js
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const root = path.join(__dirname, "..");
console.log("=== Starexch Bot Setup Check ===\n");
console.log("Platform :", process.platform);
console.log("Node     :", process.version);
console.log("CWD      :", process.cwd());
console.log("Root     :", root);

const envPath = path.join(root, ".env");
console.log("\n.env     :", fs.existsSync(envPath) ? "FOUND" : "MISSING ❌");

const token = process.env.BOT_TOKEN || "";
if (!token) {
  console.log("BOT_TOKEN: MISSING ❌");
} else if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  console.log("BOT_TOKEN: INVALID FORMAT ❌");
  console.log("  Got parts:", token.split(":").length, "(should be 2: id:secret)");
} else {
  console.log("BOT_TOKEN: OK ✅ (", token.split(":")[0] + ":****)");
}

console.log("ADMIN_IDS:", process.env.ADMIN_IDS || "(empty)");
console.log("HEADLESS :", process.env.HEADLESS !== "false");

let browserLauncher;
try {
  browserLauncher = require(path.join(root, "browser-launcher"));
} catch (err) {
  console.log("\nbrowser-launcher.js: MISSING ❌ — upload latest code to Ubuntu");
  process.exit(1);
}

const { getOs, resolveChromePath } = browserLauncher;
const chrome = resolveChromePath();
console.log("\nOS detect:", getOs());
console.log("Chrome   :", chrome.executablePath || "NOT FOUND ❌");
console.log("Source   :", chrome.source);

if (!chrome.executablePath) {
  console.log("\nUbuntu fix:");
  console.log("  cd", root);
  console.log("  npx puppeteer browsers install chrome");
  console.log("  bash scripts/ubuntu-chrome-deps.sh");
  process.exit(1);
}

console.log("\nTrying launch test (5s)...");
(async () => {
  try {
    const browser = await browserLauncher.createBrowser();
    const page = await browser.newPage();
    await page.goto("about:blank");
    await browser.close();
    console.log("Browser launch: OK ✅");
    console.log("\nAll good. Start bot with: npm start   or   pm2 restart telegrambot2");
  } catch (err) {
    console.log("Browser launch: FAILED ❌");
    console.log(err.message);
    console.log("\nUbuntu fix:");
    console.log("  bash scripts/ubuntu-chrome-deps.sh");
    process.exit(1);
  }
})();
