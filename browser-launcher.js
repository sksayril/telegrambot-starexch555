/**
 * OS-aware Chromium/Chrome launcher.
 * - Windows  → Windows Chrome
 * - Ubuntu   → System Google Chrome first (not Puppeteer cache)
 * - Override → CHROME_PATH in .env
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const puppeteer = require("puppeteer");

const HEADLESS = process.env.HEADLESS !== "false";
// On Linux, prefer real Google Chrome over Puppeteer download (default true)
const PREFER_SYSTEM_CHROME =
  process.env.PREFER_SYSTEM_CHROME !== "false" &&
  (process.env.PREFER_SYSTEM_CHROME === "true" || process.platform === "linux");

function getOs() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "mac";
  return process.platform;
}

function fileExists(p) {
  try {
    return !!(p && fs.existsSync(p));
  } catch (_) {
    return false;
  }
}

function whichLinux(cmd) {
  try {
    const out = execSync(`command -v ${cmd} 2>/dev/null || true`, {
      encoding: "utf8",
      shell: "/bin/bash",
    })
      .trim()
      .split("\n")[0];
    return fileExists(out) ? out : null;
  } catch (_) {
    return null;
  }
}

function windowsChromeCandidates() {
  return [
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.env["PROGRAMFILES(X86)"]
      ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
}

function linuxChromeCandidates() {
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/lib/chromium-browser/chromium-browser",
    "/usr/lib/chromium/chromium",
    "/snap/bin/chromium",
  ];
}

function macChromeCandidates() {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
}

function getPuppeteerBundledChrome() {
  try {
    const bundled = puppeteer.executablePath();
    return fileExists(bundled) ? bundled : null;
  } catch (_) {
    return null;
  }
}

function findSystemChrome(os) {
  let candidates = [];
  if (os === "windows") candidates = windowsChromeCandidates();
  else if (os === "linux") candidates = linuxChromeCandidates();
  else if (os === "mac") candidates = macChromeCandidates();

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return { executablePath: candidate, source: "system" };
    }
  }

  if (os === "linux") {
    for (const cmd of [
      "google-chrome-stable",
      "google-chrome",
      "chromium-browser",
      "chromium",
    ]) {
      const found = whichLinux(cmd);
      if (found) return { executablePath: found, source: `which:${cmd}` };
    }
  }

  return null;
}

/**
 * Resolve Chrome for current OS.
 * Linux default: SYSTEM Google Chrome first, Puppeteer only as fallback.
 */
function resolveChromePath() {
  const os = getOs();

  if (process.env.CHROME_PATH && fileExists(process.env.CHROME_PATH)) {
    return { executablePath: process.env.CHROME_PATH, source: "env:CHROME_PATH", os };
  }

  const system = findSystemChrome(os);
  const bundled = getPuppeteerBundledChrome();

  // Ubuntu/Linux: prefer installed Google Chrome (not puppeteer cache)
  if (os === "linux" && PREFER_SYSTEM_CHROME) {
    if (system) return { ...system, os };
    if (bundled) return { executablePath: bundled, source: "puppeteer-bundled-fallback", os };
    return { executablePath: null, source: "not-found", os };
  }

  // Windows/mac: puppeteer bundled OR system
  if (bundled) return { executablePath: bundled, source: "puppeteer-bundled", os };
  if (system) return { ...system, os };

  return { executablePath: null, source: "not-found", os };
}

function buildLaunchArgs(os, executablePath) {
  const common = [
    "--disable-blink-features=AutomationControlled",
    "--window-size=1366,900",
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
  ];

  if (os === "windows") {
    return [...common, ...(HEADLESS ? ["--disable-gpu", "--hide-scrollbars"] : [])];
  }

  if (os === "linux") {
    const isSnap = String(executablePath || "").includes("/snap/");
    return [
      ...common,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--hide-scrollbars",
      "--disable-features=VizDisplayCompositor",
      ...(isSnap ? ["--single-process"] : []),
    ];
  }

  return [...common, ...(HEADLESS ? ["--disable-gpu", "--hide-scrollbars"] : [])];
}

function missingChromeHelp(os) {
  if (os === "linux") {
    return (
      "Install Google Chrome on Ubuntu:\n" +
      "  bash scripts/install-google-chrome-ubuntu.sh\n" +
      "Or:\n" +
      "  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb\n" +
      "  sudo apt install -y ./google-chrome-stable_current_amd64.deb\n" +
      "Then set in .env:\n" +
      "  CHROME_PATH=/usr/bin/google-chrome-stable\n" +
      "  PREFER_SYSTEM_CHROME=true"
    );
  }
  if (os === "windows") {
    return "Install Google Chrome, or set CHROME_PATH to chrome.exe";
  }
  return "Install Google Chrome";
}

async function createBrowser() {
  const { executablePath, source, os } = resolveChromePath();

  if (!executablePath) {
    throw new Error(`Chrome not found on ${os}.\n${missingChromeHelp(os)}`);
  }

  const isSnap = String(executablePath).includes("/snap/");
  const args = buildLaunchArgs(os, executablePath);

  console.log(`[browser] OS=${os} | source=${source}`);
  console.log(`[browser] Using: ${executablePath}`);
  console.log(`[browser] Headless=${HEADLESS}`);

  try {
    return await puppeteer.launch({
      executablePath,
      headless: HEADLESS,
      defaultViewport: { width: 1366, height: 900 },
      ignoreDefaultArgs: isSnap ? ["--disable-extensions"] : undefined,
      args,
    });
  } catch (err) {
    throw new Error(
      `Failed to launch browser on ${os} (${executablePath})\n` +
        `${err.message}\n\n${missingChromeHelp(os)}`
    );
  }
}

module.exports = {
  getOs,
  resolveChromePath,
  createBrowser,
  HEADLESS,
};
