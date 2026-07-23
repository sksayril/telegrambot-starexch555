/**
 * OS-aware Chromium/Chrome launcher.
 * - Windows  → Windows Chrome paths + Windows-safe args
 * - Ubuntu/Linux → Chromium/Chrome paths + Linux-safe args
 * - macOS    → Chrome.app paths
 *
 * Override anytime with CHROME_PATH in .env
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const puppeteer = require("puppeteer");

const HEADLESS = process.env.HEADLESS !== "false";

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
    process.env.CHROME_PATH,
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
    // Edge as last Windows fallback (Chromium-based)
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
}

function linuxChromeCandidates() {
  return [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/lib/chromium-browser/chromium-browser",
    "/usr/lib/chromium/chromium",
    "/snap/bin/chromium",
  ].filter(Boolean);
}

function macChromeCandidates() {
  return [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter(Boolean);
}

function getPuppeteerBundledChrome() {
  try {
    const bundled = puppeteer.executablePath();
    return fileExists(bundled) ? bundled : null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve best Chrome/Chromium for current OS.
 * Order: CHROME_PATH → Puppeteer bundled → OS system browser
 */
function resolveChromePath() {
  const os = getOs();

  // Explicit override always wins (any OS)
  if (process.env.CHROME_PATH && fileExists(process.env.CHROME_PATH)) {
    return { executablePath: process.env.CHROME_PATH, source: "env:CHROME_PATH", os };
  }

  // Puppeteer downloaded Chrome (best cross-platform)
  const bundled = getPuppeteerBundledChrome();
  if (bundled) {
    return { executablePath: bundled, source: "puppeteer-bundled", os };
  }

  let candidates = [];
  if (os === "windows") candidates = windowsChromeCandidates();
  else if (os === "linux") candidates = linuxChromeCandidates();
  else if (os === "mac") candidates = macChromeCandidates();

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return { executablePath: candidate, source: "system", os };
    }
  }

  // Linux PATH lookup
  if (os === "linux") {
    for (const cmd of [
      "google-chrome-stable",
      "google-chrome",
      "chromium-browser",
      "chromium",
    ]) {
      const found = whichLinux(cmd);
      if (found) return { executablePath: found, source: `which:${cmd}`, os };
    }
  }

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
    return [
      ...common,
      ...(HEADLESS ? ["--disable-gpu", "--hide-scrollbars"] : []),
    ];
  }

  // Ubuntu / Linux — sandbox + /dev/shm fixes are required
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

  // macOS
  return [
    ...common,
    ...(HEADLESS ? ["--disable-gpu", "--hide-scrollbars"] : []),
  ];
}

function missingChromeHelp(os) {
  if (os === "windows") {
    return (
      "Windows: Install Google Chrome, or run:\n" +
      "  npx puppeteer browsers install chrome\n" +
      "Or set CHROME_PATH=C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe"
    );
  }
  if (os === "linux") {
    return (
      "Ubuntu/Linux: run:\n" +
      "  npx puppeteer browsers install chrome\n" +
      "  bash scripts/ubuntu-chrome-deps.sh\n" +
      "Or set CHROME_PATH=/usr/bin/google-chrome-stable (or /usr/bin/chromium-browser)"
    );
  }
  return "Install Chrome or run: npx puppeteer browsers install chrome";
}

/**
 * Launch Chromium correctly for the current OS (Windows / Ubuntu / macOS).
 */
async function createBrowser() {
  const { executablePath, source, os } = resolveChromePath();

  if (!executablePath) {
    throw new Error(`Chrome/Chromium not found on ${os}.\n${missingChromeHelp(os)}`);
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
