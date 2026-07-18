const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const SITE_URL = "https://starexch555.com/";
// Default: headless background (no visible window). Set HEADLESS=false to show browser.
const HEADLESS = process.env.HEADLESS !== "false";
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 3));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

/**
 * Load accounts for multi-process run.
 * Priority:
 *  1) accounts.json  [{ "username": "...", "password": "..." }, ...]
 *  2) STAREXCH_ACCOUNTS env JSON array
 *  3) single STAREXCH_USER / STAREXCH_PASS (or defaults)
 */
function loadAccounts() {
  const accountsPath = path.join(__dirname, "accounts.json");

  if (fs.existsSync(accountsPath)) {
    const raw = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
    if (Array.isArray(raw) && raw.length) {
      return raw.map((a, i) => ({
        id: a.id || `acc-${i + 1}`,
        username: a.username || a.email || a.user,
        password: a.password || a.pass,
      }));
    }
  }

  if (process.env.STAREXCH_ACCOUNTS) {
    const raw = JSON.parse(process.env.STAREXCH_ACCOUNTS);
    if (Array.isArray(raw) && raw.length) {
      return raw.map((a, i) => ({
        id: a.id || `acc-${i + 1}`,
        username: a.username || a.email || a.user,
        password: a.password || a.pass,
      }));
    }
  }

  return [
    {
      id: "acc-1",
      username: process.env.STAREXCH_USER || "sannysayril123@gmail.com",
      password: process.env.STAREXCH_PASS || "Sksayril@123",
    },
  ];
}

async function waitForSelectorAny(page, selectors, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) return { el, selector };
    }
    await sleep(300);
  }
  throw new Error(`None of selectors found within ${timeout}ms: ${selectors.join(", ")}`);
}

async function dismissPromoPopup(page, tag) {
  log(tag, "Looking for promo popup...");

  const closed = await page.evaluate(() => {
    const closeBtn =
      document.querySelector(".mnPopupClose") ||
      document.querySelector(".mnPopupBtn.mnPopupClose") ||
      document.querySelector('button.mnPopupBtn[onclick*="closePopup"]');

    if (closeBtn) {
      closeBtn.click();
      return "clicked-close";
    }

    if (typeof window.closePopup === "function") {
      window.closePopup();
      return "called-closePopup";
    }

    const popup =
      document.querySelector(".mnPopupCtntPar") ||
      document.querySelector(".popupPicPar")?.closest("div");

    if (popup) {
      const root = popup.closest(".mnPopupCtntPar") || popup.parentElement || popup;
      root.remove();
      return "removed-dom";
    }

    return null;
  });

  if (closed) {
    log(tag, `Promo popup handled via: ${closed}`);
    await sleep(800);
  } else {
    log(tag, "No promo popup found (may already be closed).");
  }

  for (let i = 0; i < 5; i++) {
    const stillThere = await page.$(".mnPopupCtntPar");
    if (!stillThere) break;
    await page.evaluate(() => {
      document.querySelectorAll(".mnPopupCtntPar").forEach((n) => n.remove());
      if (typeof window.closePopup === "function") window.closePopup();
    });
    await sleep(400);
  }
}

async function openLoginModal(page, tag) {
  log(tag, "Clicking Login button...");

  await waitForSelectorAny(page, [
    "a.cls_loginbtn",
    "a.loginBtn",
    "a.Buttons__login___2_odk",
    "nav.authBtnTopbar a.mb-button--login",
  ]);

  await page.evaluate(() => {
    const loginBtn =
      document.querySelector("a.cls_loginbtn") ||
      document.querySelector("a.loginBtn") ||
      document.querySelector("a.Buttons__login___2_odk") ||
      document.querySelector("nav.authBtnTopbar a.mb-button--login");
    if (!loginBtn) throw new Error("Login button not found");
    loginBtn.click();
  });

  await waitForSelectorAny(page, [
    "#nwGuestSec",
    ".login_popup_wrpr",
    "#user_login_id",
    "input.cls_login_username",
  ]);

  log(tag, "Login modal is open.");
}

async function fillAndSubmitLogin(page, account, tag) {
  log(tag, "Filling login form...");

  await page.waitForSelector("#user_login_id, input.cls_login_username", {
    visible: true,
    timeout: 30000,
  });
  await page.waitForSelector("#passwordId, input.cls_login_password", {
    visible: true,
    timeout: 30000,
  });

  await page.evaluate(() => {
    const user =
      document.querySelector("#user_login_id") ||
      document.querySelector("input.cls_login_username");
    const pass =
      document.querySelector("#passwordId") ||
      document.querySelector("input.cls_login_password");
    if (user) {
      user.focus();
      user.value = "";
      user.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (pass) {
      pass.focus();
      pass.value = "";
      pass.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  const userSelector = (await page.$("#user_login_id"))
    ? "#user_login_id"
    : "input.cls_login_username";
  const passSelector = (await page.$("#passwordId"))
    ? "#passwordId"
    : "input.cls_login_password";

  await page.click(userSelector, { clickCount: 3 });
  await page.type(userSelector, account.username, { delay: 30 });

  await page.click(passSelector, { clickCount: 3 });
  await page.type(passSelector, account.password, { delay: 30 });

  log(tag, `Credentials filled for: ${account.username}`);
  log(tag, "Clicking LOGIN button...");

  await page.waitForSelector("#loginbutton, button.action_btn", {
    visible: true,
    timeout: 15000,
  });

  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 })
      .catch(() => null),
    page.evaluate(() => {
      const btn =
        document.querySelector("#loginbutton") ||
        document.querySelector(".cls_login_view button.action_btn") ||
        document.querySelector("button.action_btn");
      if (!btn) throw new Error("LOGIN button not found");
      btn.click();
    }),
  ]);

  await sleep(2000);
  try {
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 });
  } catch (_) {
    /* site may keep polling */
  }
}

async function waitForDashboard(page, tag) {
  log(tag, "Waiting for dashboard / wallet balances...");

  const start = Date.now();
  const timeout = 90000;

  while (Date.now() - start < timeout) {
    try {
      if (page.isClosed()) throw new Error("Page was closed unexpectedly.");

      const ready = await page.evaluate(() => {
        const wallet = document.querySelector(
          ".total_balance, .hdrMyWlt .Balances__value___3Ht3w span"
        );
        const exposure = document.querySelector(
          ".totalExposure, [data-value='exposurebalance'] span"
        );
        const available = document.querySelector(
          ".wallet_balance, [data-value='availablebalance'] span, .availableBalance .Balances__value___3Ht3w span"
        );
        const balancesRoot = document.querySelector(
          ".Balances__balances___1bDig, .cls-Balances__balances___1bDig, .cls_wal_pop, .expAvalHdrPar"
        );

        if (!balancesRoot && !wallet) return null;

        return {
          myWallet: (wallet?.textContent || "").trim(),
          exposure: (exposure?.textContent || "").trim(),
          available: (available?.textContent || "").trim(),
        };
      });

      if (ready && (ready.myWallet || ready.available || ready.exposure)) {
        await sleep(1200);
        return ready;
      }
    } catch (err) {
      if (!String(err.message || err).includes("Execution context was destroyed")) {
        throw err;
      }
    }

    await sleep(700);
  }

  throw new Error("Dashboard wallet balances did not appear after login.");
}

async function readBalances(page) {
  return page.evaluate(() => {
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : null;
    };

    const myWallet =
      text(".total_balance") ||
      text(".Balances__item--wallet___1Ic-G .Balances__value___3Ht3w span") ||
      text(".hdrMyWlt .Balances__value___3Ht3w span");

    const exposure =
      text(".totalExposure") ||
      text("[data-value='exposurebalance'] span") ||
      text(".Balances__item--exposure___1PgFm .Balances__value___3Ht3w span");

    const available =
      text(".wallet_balance") ||
      text("[data-value='availablebalance'] span") ||
      text(".availableBalance .Balances__value___3Ht3w span");

    const availableEl = document.querySelector(".wallet_balance");

    return {
      myWallet,
      exposure,
      available,
      availableActual: availableEl?.getAttribute("data-actual") || null,
      availableWager: availableEl?.getAttribute("data-wager") || null,
    };
  });
}

function resolveChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  // Prefer Puppeteer's downloaded Chrome
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (_) {
    /* not installed yet */
  }

  // Fallback: system Google Chrome (Windows / common paths)
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

async function createBrowser() {
  const executablePath = resolveChromePath();
  if (!executablePath) {
    throw new Error(
      "Chrome not found. Run: npx puppeteer browsers install chrome\n" +
        "Or set CHROME_PATH in .env to your chrome.exe path."
    );
  }

  console.log(`[browser] Using Chrome: ${executablePath}`);

  return puppeteer.launch({
    executablePath,
    headless: HEADLESS ? "new" : false,
    defaultViewport: { width: 1366, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,900",
      ...(HEADLESS ? ["--disable-gpu", "--hide-scrollbars"] : []),
    ],
  });
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return page;
}

/**
 * Process one account: open site → close popup → login → read balances.
 */
async function processAccount(account, sharedBrowser = null) {
  const tag = account.id || account.username;
  const ownBrowser = !sharedBrowser;
  const browser = sharedBrowser || (await createBrowser());
  const page = await setupPage(browser);
  const startedAt = Date.now();

  try {
    log(tag, "Opening site...");
    await page.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await sleep(2000);

    await dismissPromoPopup(page, tag);
    await openLoginModal(page, tag);
    await fillAndSubmitLogin(page, account, tag);
    await waitForDashboard(page, tag);

    const balances = await readBalances(page);
    const result = {
      ok: true,
      id: account.id,
      username: account.username,
      ...balances,
      durationMs: Date.now() - startedAt,
    };

    console.log(`\n========== WALLET [${tag}] ==========`);
    console.log("User      :", account.username);
    console.log("My Wallet :", balances.myWallet);
    console.log("Exposure  :", balances.exposure);
    console.log("Available :", balances.available);
    console.log("=====================================\n");

    return result;
  } catch (err) {
    const safeName = String(account.id || "acc").replace(/[^\w.-]/g, "_");
    const shot = path.join(__dirname, `error-${safeName}.png`);
    try {
      await page.screenshot({ path: shot, fullPage: true });
      log(tag, `Saved ${path.basename(shot)}`);
    } catch (_) {
      /* ignore */
    }

    const result = {
      ok: false,
      id: account.id,
      username: account.username,
      error: err.message,
      durationMs: Date.now() - startedAt,
    };
    console.error(`[${tag}] FAILED:`, err.message);
    return result;
  } finally {
    await page.close().catch(() => {});
    if (ownBrowser) {
      await browser.close().catch(() => {});
      log(tag, "Browser closed.");
    }
  }
}

/**
 * Run many accounts in parallel with a concurrency limit.
 * Example: concurrency=3 → up to 3 Chromium sessions at once.
 */
async function processAccountsParallel(accounts, concurrency = CONCURRENCY) {
  const list = accounts.filter((a) => a.username && a.password);
  if (!list.length) throw new Error("No valid accounts to process.");

  console.log("========================================");
  console.log(`Multi-process run: ${list.length} account(s)`);
  console.log(`Concurrency     : ${concurrency}`);
  console.log(`Headless        : ${HEADLESS}`);
  console.log(`Target          : ${SITE_URL}`);
  console.log("========================================\n");

  const results = [];
  let index = 0;

  async function worker() {
    while (index < list.length) {
      const current = index++;
      const account = list[current];
      // Each account gets its own isolated Chromium (safe for parallel logins)
      const result = await processAccount(account);
      results[current] = result;
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

async function main() {
  const accounts = loadAccounts();
  const results = await processAccountsParallel(accounts, CONCURRENCY);

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log("\n========== SUMMARY ==========");
  console.log(`Total   : ${results.length}`);
  console.log(`Success : ${ok.length}`);
  console.log(`Failed  : ${failed.length}`);
  console.log("=============================\n");

  console.log(JSON.stringify({ results }, null, 2));

  if (failed.length) process.exitCode = 1;
}

module.exports = {
  processAccount,
  processAccountsParallel,
  loadAccounts,
  createBrowser,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exitCode = 1;
  });
}
