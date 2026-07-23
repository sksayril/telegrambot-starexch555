require("dotenv").config();

const { Telegraf, Markup } = require("telegraf");
const store = require("./store");
const { processAccount } = require("./login-and-balance");

const BOT_TOKEN = process.env.BOT_TOKEN;
/** Root admins from .env — cannot be removed by other admins */
const ROOT_ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN in .env — copy .env.example to .env and set your token.");
  process.exit(1);
}

if (!ROOT_ADMIN_IDS.length) {
  console.warn("Warning: ADMIN_IDS is empty. Set at least one root admin Telegram ID in .env");
}

// Wallet scrape can take 1–3 minutes on Ubuntu — default Telegraf timeout is 90s
const HANDLER_TIMEOUT_MS = Number(process.env.HANDLER_TIMEOUT_MS || 300000); // 5 min

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: HANDLER_TIMEOUT_MS,
});

/** In-memory wizard: telegramId -> { step, username? } */
const sessions = new Map();
const balanceLocks = new Set();

/** All admins = root (.env) + extra (added by admins) */
function getAllAdminIds() {
  const extra = store.getExtraAdminIds();
  return [...new Set([...ROOT_ADMIN_IDS, ...extra].map(String))];
}

function isRootAdmin(telegramId) {
  return ROOT_ADMIN_IDS.includes(String(telegramId));
}

function isAdmin(ctx) {
  return getAllAdminIds().includes(String(ctx.from?.id));
}

function statusLabel(status) {
  const map = {
    approved: "✅ Approved",
    rejected: "❌ Rejected",
    pending: "⏳ Pending",
    blocked: "🚫 Blocked",
  };
  return map[status] || status || "Unknown";
}

function userMenu() {
  return Markup.keyboard([
    ["🔗 Link / Change ID", "💰 Wallet"],
    ["👤 My Status", "❓ Help"],
  ]).resize();
}

function adminMenu() {
  return Markup.keyboard([
    ["⏳ Pending", "✅ Approved"],
    ["❌ Rejected", "🚫 Blocked"],
    ["👥 All Users", "👑 Admins"],
    ["📊 Admin Panel", "➕ Add Admin"],
    ["🔗 Link / Change ID", "💰 Wallet"],
    ["👤 My Status", "❓ Help"],
  ]).resize();
}

function mainMenu(ctx) {
  return isAdmin(ctx) ? adminMenu() : userMenu();
}

async function notifyAdmins(text, extra = {}) {
  for (const adminId of getAllAdminIds()) {
    try {
      await bot.telegram.sendMessage(adminId, text, extra);
    } catch (err) {
      console.error(`Failed to notify admin ${adminId}:`, err.message);
    }
  }
}

function manageKeyboard(telegramId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Approve", `approve:${telegramId}`),
      Markup.button.callback("❌ Reject", `reject:${telegramId}`),
    ],
    [Markup.button.callback("🚫 Block", `block:${telegramId}`)],
  ]);
}

function formatUserCard(u) {
  return (
    `${statusLabel(u.status)}\n` +
    `TG ID: \`${u.telegramId}\`\n` +
    `TG user: @${u.telegramUsername || "n/a"}\n` +
    `Name: ${u.displayName || "-"}\n` +
    `Login/Email: \`${u.username}\`\n` +
    (u.submittedAt ? `Submitted: ${u.submittedAt}\n` : "") +
    (u.approvedAt ? `Approved: ${u.approvedAt}\n` : "") +
    (u.rejectedAt ? `Rejected: ${u.rejectedAt}\n` : "") +
    (u.blockedAt ? `Blocked: ${u.blockedAt}\n` : "")
  );
}

// ─── Commands ───────────────────────────────────────────────

bot.start(async (ctx) => {
  sessions.delete(String(ctx.from.id));
  const user = store.getUser(ctx.from.id);
  const role = isAdmin(ctx) ? "Admin" : "User";

  await ctx.reply(
    `👋 Welcome to *Starexch Wallet Bot*\n\n` +
      `Role: *${role}*\n` +
      (user
        ? `Status: ${statusLabel(user.status)}\nCurrent login: \`${user.username}\`\n`
        : `Status: Not linked yet\n`) +
      `\n` +
      `📌 *How to link your account*\n\n` +
      `*Step 1:* Tap 🔗 *Link / Change ID*\n\n` +
      `*Step 2:* Send your Username / Email / Mobile\n` +
      `Example:\n` +
      `\`sannysayril123@gmail.com\`\n` +
      `or\n` +
      `\`myusername\`\n` +
      `or\n` +
      `\`9876543210\`\n\n` +
      `*Step 3:* Bot will ask for password — send it next\n` +
      `Example:\n` +
      `\`Sksayril@123\`\n\n` +
      `⚠️ Send username and password in *2 separate messages*\n` +
      `(first username, then password)\n\n` +
      `*Step 4:* Wait for admin approval *(one time only)*\n\n` +
      `*Step 5:* After approval use /wallet\n` +
      `You can change Starexch ID anytime — no re-approval needed.`,
    { parse_mode: "Markdown", ...mainMenu(ctx) }
  );
});

bot.help(async (ctx) => {
  let text =
    `*User commands*\n` +
    `/start — Open menu\n` +
    `/register — Link Starexch login\n` +
    `/wallet — Get wallet balance\n` +
    `/balance — Same as /wallet\n` +
    `/status — Your approval status\n` +
    `/cancel — Cancel current input\n`;

  if (isAdmin(ctx)) {
    text +=
      `\n*Admin commands*\n` +
      `/admin — Admin panel summary\n` +
      `/admins — List all admins\n` +
      `/addadmin <telegramId> — Give admin access\n` +
      `/removeadmin <telegramId> — Remove admin access\n` +
      `/pending — List pending users\n` +
      `/approved — List approved users\n` +
      `/rejected — List rejected users\n` +
      `/blocked — List blocked users\n` +
      `/users — List all users\n` +
      `/approve <id|email|username>\n` +
      `/reject <id|email|username>\n` +
      `/block <id|email|username>\n` +
      `/unblock <id|email|username>\n` +
      `\nExamples:\n` +
      `/addadmin 987654321\n` +
      `/approve sannysayril123@gmail.com\n` +
      `/approve 123456789\n` +
      `/reject username123\n`;
  }

  await ctx.reply(text, { parse_mode: "Markdown", ...mainMenu(ctx) });
});

bot.command("cancel", async (ctx) => {
  sessions.delete(String(ctx.from.id));
  await ctx.reply("Cancelled.", mainMenu(ctx));
});

bot.command("status", async (ctx) => sendStatus(ctx));
bot.hears("👤 My Status", async (ctx) => sendStatus(ctx));
bot.hears("❓ Help", async (ctx) => {
  await ctx.reply("Use /help for full command list.", mainMenu(ctx));
});

async function sendStatus(ctx) {
  const user = store.getUser(ctx.from.id);
  if (!user) {
    return ctx.reply("You have not linked an account yet. Tap 🔗 Link Account.", mainMenu(ctx));
  }

  await ctx.reply(
    `*Your profile*\n` +
      `Telegram ID: \`${user.telegramId}\`\n` +
      `Login: \`${user.username}\`\n` +
      `Status: ${statusLabel(user.status)}\n` +
      (user.approvedAt ? `Approved at: ${user.approvedAt}\n` : "") +
      (user.lastBalanceAt ? `Last balance check: ${user.lastBalanceAt}\n` : ""),
    { parse_mode: "Markdown", ...mainMenu(ctx) }
  );
}

// ─── Registration ───────────────────────────────────────────

async function startRegister(ctx) {
  const existing = store.getUser(ctx.from.id);
  if (existing?.status === "blocked") {
    return ctx.reply("🚫 You are blocked. Contact admin.", mainMenu(ctx));
  }

  sessions.set(String(ctx.from.id), { step: "username" });

  if (existing?.status === "approved") {
    await ctx.reply(
      `✅ Your Telegram ID is already *approved*.\n\n` +
        `Current login: \`${existing.username}\`\n\n` +
        `Send *new Username / Email / Mobile*:\n\n` +
        `Example:\n` +
        `\`test@gmail.com\`\n` +
        `or \`myusername\`\n` +
        `or \`9876543210\`\n\n` +
        `Then bot will ask for password.\n` +
        `No new admin approval needed.\n\n(or /cancel)`,
      { parse_mode: "Markdown", ...Markup.removeKeyboard() }
    );
    return;
  }

  await ctx.reply(
    `Send your Starexch *Username / Email / Mobile*:\n\n` +
      `Example:\n` +
      `\`test@gmail.com\`\n` +
      `or \`myusername\`\n` +
      `or \`9876543210\`\n\n` +
      `(or /cancel)`,
    { parse_mode: "Markdown", ...Markup.removeKeyboard() }
  );
}

bot.command("register", startRegister);
bot.hears("🔗 Link Account", startRegister);
bot.hears("🔗 Link / Change ID", startRegister);

// ─── Wallet (approved only) ─────────────────────────────────

function formatWalletSuccess(user, result) {
  const name = user.displayName || user.telegramUsername || "Player";
  return (
    `✨ *Wallet Fetched Successfully!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👋 Hello *${name}*\n` +
    `🔐 Login: \`${user.username}\`\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💼 *My Wallet*\n` +
    `   ${result.myWallet}\n\n` +
    `📉 *Exposure*\n` +
    `   ${result.exposure}\n\n` +
    `💚 *Available Balance*\n` +
    `   ${result.available}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Request completed\n` +
    `🕐 ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
  );
}

async function handleBalance(ctx) {
  const tid = String(ctx.from.id);
  const user = store.getUser(tid);

  if (!user) {
    return ctx.reply("No linked account. Tap 🔗 Link Account first.", mainMenu(ctx));
  }
  if (user.status === "blocked") {
    return ctx.reply("🚫 Your account is blocked. Contact admin.", mainMenu(ctx));
  }
  if (user.status !== "approved") {
    return ctx.reply(
      `Your account is *${statusLabel(user.status)}*.\nBalance is available only after admin approval.`,
      { parse_mode: "Markdown", ...mainMenu(ctx) }
    );
  }

  // Same user cannot start another wallet request while one is running
  if (balanceLocks.has(tid)) {
    return ctx.reply(
      `⚠️ *Request already in progress*\n\n` +
        `You already have one wallet balance request running.\n` +
        `Please wait until it finishes — you cannot send another request at the same time.`,
      { parse_mode: "Markdown", ...mainMenu(ctx) }
    );
  }

  balanceLocks.add(tid);

  let progressMsg;
  try {
    progressMsg = await ctx.reply(
      `⏳ *We are processing your request...*\n\n` +
        `Please wait while we securely fetch your wallet details.\n` +
        `This usually takes about 30–60 seconds.\n\n` +
        `🚫 Do not send /wallet again until this finishes.`,
      { parse_mode: "Markdown" }
    );
  } catch (_) {
    /* ignore */
  }

  try {
    const result = await processAccount({
      id: `tg-${tid}`,
      username: user.username,
      password: user.password,
    });

    if (!result.ok) {
      if (progressMsg) {
        await ctx.telegram
          .editMessageText(
            ctx.chat.id,
            progressMsg.message_id,
            undefined,
            `❌ *Could not fetch wallet*\n\n${result.error}\n\nPlease try again in a moment.`,
            { parse_mode: "Markdown" }
          )
          .catch(() => {});
      }
      await ctx.reply(`Please try /wallet again.`, mainMenu(ctx));
      return;
    }

    store.upsertUser(tid, {
      lastBalanceAt: new Date().toISOString(),
      lastBalance: {
        myWallet: result.myWallet,
        exposure: result.exposure,
        available: result.available,
      },
    });

    const successText = formatWalletSuccess(user, result);

    if (progressMsg) {
      await ctx.telegram
        .editMessageText(ctx.chat.id, progressMsg.message_id, undefined, successText, {
          parse_mode: "Markdown",
        })
        .catch(async () => {
          await ctx.reply(successText, { parse_mode: "Markdown", ...mainMenu(ctx) });
        });
      await ctx.reply("Tap 💰 Wallet anytime to refresh.", mainMenu(ctx));
    } else {
      await ctx.reply(successText, { parse_mode: "Markdown", ...mainMenu(ctx) });
    }
  } catch (err) {
    if (progressMsg) {
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          undefined,
          `❌ *Request failed*\n\n${err.message}`,
          { parse_mode: "Markdown" }
        )
        .catch(() => {});
    }
    await ctx.reply(`❌ Error: ${err.message}`, mainMenu(ctx));
  } finally {
    balanceLocks.delete(tid);
  }
}

bot.command("wallet", handleBalance);
bot.command("balance", handleBalance);
bot.hears("💰 Wallet", handleBalance);
bot.hears("💰 My Balance", handleBalance);

// ─── Admin actions ──────────────────────────────────────────

async function resolveTarget(query) {
  const user = store.findUser(query);
  if (!user) return { ok: false, message: `User not found for: ${query}` };
  return { ok: true, user };
}

async function setUserStatus(telegramId, status, adminCtx) {
  const user = store.getUser(telegramId);
  if (!user) return { ok: false, message: "User not found." };

  const extra = { [`${status}At`]: new Date().toISOString(), [`${status}By`]: String(adminCtx.from.id) };

  // Clean conflicting timestamps lightly
  if (status === "approved") {
    extra.approvedAt = new Date().toISOString();
    extra.approvedBy = String(adminCtx.from.id);
  }
  if (status === "rejected") {
    extra.rejectedAt = new Date().toISOString();
    extra.rejectedBy = String(adminCtx.from.id);
  }
  if (status === "blocked") {
    extra.blockedAt = new Date().toISOString();
    extra.blockedBy = String(adminCtx.from.id);
  }
  if (status === "pending") {
    extra.unblockedAt = new Date().toISOString();
  }

  store.setStatus(telegramId, status, extra);

  const messages = {
    approved: "✅ Your Starexch account was *approved*.\nYou can now use /wallet.",
    rejected: "❌ Your account link was *rejected*.\nYou can submit again with 🔗 Link Account.",
    blocked: "🚫 Your account has been *blocked* by admin.",
    pending: "⏳ Your account is back to *pending*. Wait for admin approval.",
  };

  try {
    await bot.telegram.sendMessage(telegramId, messages[status] || `Status: ${status}`, {
      parse_mode: "Markdown",
      ...userMenu(),
    });
  } catch (_) {
    /* user may have blocked bot */
  }

  return { ok: true, user: store.getUser(telegramId) };
}

async function adminActionByQuery(ctx, status) {
  if (!isAdmin(ctx)) return ctx.reply("Admins only.");

  const parts = ctx.message.text.trim().split(/\s+/);
  const query = parts.slice(1).join(" ").trim();
  if (!query) {
    return ctx.reply(
      `Usage: /${status === "pending" ? "unblock" : status} <telegramId | email | username>\n` +
        `Example: /${status === "pending" ? "unblock" : status} user@email.com`,
      adminMenu()
    );
  }

  const found = await resolveTarget(query);
  if (!found.ok) return ctx.reply(found.message, adminMenu());

  const res = await setUserStatus(found.user.telegramId, status, ctx);
  if (!res.ok) return ctx.reply(res.message, adminMenu());

  await ctx.reply(
    `${statusLabel(status)} → \`${res.user.username}\` (TG \`${res.user.telegramId}\`)`,
    { parse_mode: "Markdown", ...adminMenu() }
  );
}

bot.command("approve", (ctx) => adminActionByQuery(ctx, "approved"));
bot.command("reject", (ctx) => adminActionByQuery(ctx, "rejected"));
bot.command("block", (ctx) => adminActionByQuery(ctx, "blocked"));
bot.command("unblock", (ctx) => adminActionByQuery(ctx, "pending"));

async function handleStatusAction(ctx, status) {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("Admins only");
  const telegramId = ctx.match[1];
  const res = await setUserStatus(telegramId, status, ctx);
  await ctx.answerCbQuery(res.ok ? statusLabel(status) : res.message);
  if (res.ok) {
    const base = ctx.callbackQuery.message.text || "";
    await ctx
      .editMessageText(`${base}\n\n→ ${statusLabel(status)} by admin.`, { parse_mode: "Markdown" })
      .catch(() => {});
    await ctx.reply(
      `${statusLabel(status)} \`${res.user.username}\` (\`${telegramId}\`)`,
      { parse_mode: "Markdown", ...adminMenu() }
    );
  }
}

bot.action(/^approve:(.+)$/, (ctx) => handleStatusAction(ctx, "approved"));
bot.action(/^reject:(.+)$/, (ctx) => handleStatusAction(ctx, "rejected"));
bot.action(/^block:(.+)$/, (ctx) => handleStatusAction(ctx, "blocked"));

async function listByStatus(ctx, status, title) {
  if (!isAdmin(ctx)) return ctx.reply("Admins only.");

  const list = status === "all" ? store.getAllUsers() : store.getUsersByStatus(status);
  if (!list.length) {
    return ctx.reply(`${title}: none.`, adminMenu());
  }

  await ctx.reply(`*${title}* (${list.length})`, {
    parse_mode: "Markdown",
    ...adminMenu(),
  });

  // Send each pending/manageable user as a card with buttons
  for (const u of list) {
    await ctx.reply(formatUserCard(u), {
      parse_mode: "Markdown",
      ...(status === "all" || status === "pending" || status === "approved" || status === "rejected"
        ? manageKeyboard(u.telegramId)
        : status === "blocked"
          ? Markup.inlineKeyboard([
              [Markup.button.callback("⏳ Unblock → Pending", `approve_pending:${u.telegramId}`)],
              [Markup.button.callback("✅ Approve", `approve:${u.telegramId}`)],
            ])
          : {}),
    });
  }
}

bot.action(/^approve_pending:(.+)$/, (ctx) => handleStatusAction(ctx, "pending"));

async function adminPanel(ctx) {
  if (!isAdmin(ctx)) return ctx.reply("Admins only.");
  const c = store.counts();
  const admins = getAllAdminIds();
  await ctx.reply(
    `*Admin Panel*\n\n` +
      `⏳ Pending: *${c.pending}*\n` +
      `✅ Approved: *${c.approved}*\n` +
      `❌ Rejected: *${c.rejected}*\n` +
      `🚫 Blocked: *${c.blocked}*\n` +
      `👥 Users: *${c.total}*\n` +
      `👑 Admins: *${admins.length}*\n\n` +
      `*User actions*\n` +
      `/approve email@or.username\n` +
      `/reject email@or.username\n` +
      `/block email@or.username\n` +
      `/unblock email@or.username\n\n` +
      `*Admin access*\n` +
      `/admins — list admins\n` +
      `/addadmin <telegramId>\n` +
      `/removeadmin <telegramId>`,
    { parse_mode: "Markdown", ...adminMenu() }
  );
}

async function listAdmins(ctx) {
  if (!isAdmin(ctx)) return ctx.reply("Admins only.");

  const lines = [];
  for (const id of ROOT_ADMIN_IDS) {
    lines.push(`• \`${id}\` — ⭐ Root admin (.env)`);
  }

  const records = store.getAdminRecords();
  const extraIds = store.getExtraAdminIds();
  for (const id of extraIds) {
    const rec = records.find((r) => String(r.telegramId) === String(id));
    const by = rec?.addedBy ? ` (added by \`${rec.addedBy}\`)` : "";
    const removeBtn = !isRootAdmin(id);
    lines.push(`• \`${id}\` — 👑 Admin${by}`);
    if (removeBtn) {
      // listed with remove buttons below
    }
  }

  const buttons = extraIds
    .filter((id) => !isRootAdmin(id))
    .map((id) => [Markup.button.callback(`🗑 Remove ${id}`, `removeadmin:${id}`)]);

  await ctx.reply(
    `*Admins (${getAllAdminIds().length})*\n\n` +
      (lines.length ? lines.join("\n") : "No admins configured.") +
      `\n\nAdd: /addadmin <telegramId>\nRemove: /removeadmin <telegramId>`,
    {
      parse_mode: "Markdown",
      ...(buttons.length
        ? Markup.inlineKeyboard(buttons)
        : adminMenu()),
    }
  );
}

async function startAddAdmin(ctx) {
  if (!isAdmin(ctx)) return ctx.reply("Admins only.");
  sessions.set(String(ctx.from.id), { step: "add_admin_id" });
  await ctx.reply(
    "Send the *Telegram user ID* of the person to make admin.\n\n" +
      "They can get their ID from @userinfobot\n\n(or /cancel)",
    { parse_mode: "Markdown" }
  );
}

async function doAddAdmin(ctx, targetId) {
  if (!isAdmin(ctx)) return ctx.reply("Admins only.");

  const id = String(targetId || "").trim();
  if (!/^\d+$/.test(id)) {
    return ctx.reply("Invalid ID. Use a numeric Telegram user ID.\nExample: /addadmin 987654321", adminMenu());
  }

  if (getAllAdminIds().includes(id)) {
    return ctx.reply(`Already an admin: \`${id}\``, { parse_mode: "Markdown", ...adminMenu() });
  }

  const res = store.addAdmin(id, ctx.from.id);
  if (!res.ok) return ctx.reply(res.message, adminMenu());

  try {
    await bot.telegram.sendMessage(
      id,
      "👑 You were granted *admin access* to Starexch Wallet Bot.\nSend /start to open the admin menu.",
      { parse_mode: "Markdown", ...adminMenu() }
    );
  } catch (_) {
    /* user may not have started the bot yet */
  }

  await notifyAdmins(
    `👑 New admin added\nID: \`${id}\`\nBy: \`${ctx.from.id}\``,
    { parse_mode: "Markdown" }
  );

  await ctx.reply(`✅ Admin access granted to \`${id}\``, {
    parse_mode: "Markdown",
    ...adminMenu(),
  });
}

async function doRemoveAdmin(ctx, targetId) {
  if (!isAdmin(ctx)) return ctx.reply("Admins only.");

  const id = String(targetId || "").trim();
  if (!id) {
    return ctx.reply("Usage: /removeadmin <telegramId>", adminMenu());
  }

  if (isRootAdmin(id)) {
    return ctx.reply(
      "⭐ Root admins (from .env) cannot be removed here.\nEdit ADMIN_IDS in .env instead.",
      adminMenu()
    );
  }

  if (!store.getExtraAdminIds().includes(id)) {
    return ctx.reply(`Not found in admin list: \`${id}\``, {
      parse_mode: "Markdown",
      ...adminMenu(),
    });
  }

  // Prevent removing yourself if you're the only extra... actually allow, root still remains
  const res = store.removeAdmin(id, ctx.from.id);
  if (!res.ok) return ctx.reply(res.message, adminMenu());

  try {
    await bot.telegram.sendMessage(
      id,
      "Your admin access was *removed*. You are now a normal user.",
      { parse_mode: "Markdown", ...userMenu() }
    );
  } catch (_) {
    /* ignore */
  }

  await ctx.reply(`✅ Admin access removed from \`${id}\``, {
    parse_mode: "Markdown",
    ...adminMenu(),
  });
}

bot.command("admin", adminPanel);
bot.command("admins", listAdmins);
bot.command("addadmin", async (ctx) => {
  const id = ctx.message.text.split(/\s+/)[1];
  if (!id) return startAddAdmin(ctx);
  return doAddAdmin(ctx, id);
});
bot.command("removeadmin", async (ctx) => {
  const id = ctx.message.text.split(/\s+/)[1];
  return doRemoveAdmin(ctx, id);
});

bot.action(/^removeadmin:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("Admins only");
  await ctx.answerCbQuery();
  await doRemoveAdmin(ctx, ctx.match[1]);
});

bot.command("pending", (ctx) => listByStatus(ctx, "pending", "Pending users"));
bot.command("approved", (ctx) => listByStatus(ctx, "approved", "Approved users"));
bot.command("rejected", (ctx) => listByStatus(ctx, "rejected", "Rejected users"));
bot.command("blocked", (ctx) => listByStatus(ctx, "blocked", "Blocked users"));
bot.command("users", (ctx) => listByStatus(ctx, "all", "All users"));

bot.hears("⏳ Pending", (ctx) => listByStatus(ctx, "pending", "Pending users"));
bot.hears("⏳ Pending Users", (ctx) => listByStatus(ctx, "pending", "Pending users"));
bot.hears("✅ Approved", (ctx) => listByStatus(ctx, "approved", "Approved users"));
bot.hears("❌ Rejected", (ctx) => listByStatus(ctx, "rejected", "Rejected users"));
bot.hears("🚫 Blocked", (ctx) => listByStatus(ctx, "blocked", "Blocked users"));
bot.hears("👥 All Users", (ctx) => listByStatus(ctx, "all", "All users"));
bot.hears("📊 Admin Panel", adminPanel);
bot.hears("👑 Admins", listAdmins);
bot.hears("➕ Add Admin", startAddAdmin);

// Wizard input (after hears)
bot.on("text", async (ctx, next) => {
  const tid = String(ctx.from.id);
  const session = sessions.get(tid);
  const text = (ctx.message.text || "").trim();

  if (!session) return next();

  if (text.startsWith("/")) {
    sessions.delete(tid);
    return next();
  }

  if (session.step === "add_admin_id") {
    sessions.delete(tid);
    return doAddAdmin(ctx, text);
  }

  if (session.step === "username") {
    if (text.length < 3) {
      return ctx.reply("Username/email too short. Try again:");
    }
    sessions.set(tid, { step: "password", username: text });
    return ctx.reply(
      `✅ Username saved: \`${text}\`\n\n` +
        `Now send your *Password*:\n\n` +
        `Example:\n` +
        `\`Sksayril@123\`\n\n` +
        `(or /cancel)`,
      { parse_mode: "Markdown" }
    );
  }

  if (session.step === "password") {
    if (text.length < 5) {
      return ctx.reply("Password too short. Try again:");
    }

    const existing = store.getUser(tid);
    if (existing?.status === "blocked") {
      sessions.delete(tid);
      return ctx.reply("🚫 You are blocked. Contact admin.", mainMenu(ctx));
    }

    const username = session.username;
    sessions.delete(tid);

    // Once Telegram ID is approved, user can switch any Starexch ID without re-approval
    const alreadyApproved = existing?.status === "approved";
    const nextStatus = alreadyApproved
      ? "approved"
      : existing?.status === "blocked"
        ? "blocked"
        : "pending";

    const user = store.upsertUser(tid, {
      username,
      password: text,
      status: nextStatus,
      displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || null,
      telegramUsername: ctx.from.username || null,
      submittedAt: new Date().toISOString(),
      ...(alreadyApproved
        ? { lastCredentialChangeAt: new Date().toISOString() }
        : {}),
    });

    if (alreadyApproved) {
      await ctx.reply(
        `✅ *Starexch ID updated successfully!*\n\n` +
          `New login: \`${username}\`\n` +
          `Status: ✅ Approved (no new approval needed)\n\n` +
          `You can check balance now with /wallet`,
        { parse_mode: "Markdown", ...mainMenu(ctx) }
      );

      // Optional soft notify to admins (info only, no approve buttons)
      await notifyAdmins(
        `🔄 *Approved user switched Starexch ID*\n\n` +
          `TG: \`${tid}\` @${user.telegramUsername || "n/a"}\n` +
          `Old → New login: \`${existing.username}\` → \`${username}\`\n` +
          `No approval required (already approved).`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await ctx.reply(
      `✅ Account linked and sent for *admin approval*.\n\n` +
        `Login: \`${username}\`\n` +
        `Status: ${statusLabel(user.status)}\n\n` +
        `You can use /wallet only after admin approval.\n` +
        `After one approval, you can change Starexch ID anytime without re-approval.`,
      { parse_mode: "Markdown", ...mainMenu(ctx) }
    );

    await notifyAdmins(
      `🆕 *New pending request*\n\n` + formatUserCard(user),
      { parse_mode: "Markdown", ...manageKeyboard(tid) }
    );
    return;
  }

  return next();
});

bot.catch(async (err, ctx) => {
  console.error("Bot error:", err);
  const msg = String(err?.message || err);
  const isTimeout =
    err?.name === "TimeoutError" ||
    msg.includes("timed out") ||
    msg.includes("Timeout");

  try {
    if (isTimeout) {
      const tid = ctx?.from?.id ? String(ctx.from.id) : null;
      if (tid) balanceLocks.delete(tid);
      await ctx.reply(
        `⏱️ *Request timed out*\n\n` +
          `Wallet check took too long (server/network slow).\n` +
          `Please try /wallet again in a minute.`,
        { parse_mode: "Markdown", ...(ctx?.from ? mainMenu(ctx) : {}) }
      );
      return;
    }
    await ctx.reply("Something went wrong. Try again.");
  } catch (_) {
    /* ignore */
  }
});

bot.launch().then(() => {
  const { getOs, resolveChromePath } = require("./browser-launcher");
  const chrome = resolveChromePath();
  console.log("Starexch Telegram bot is running.");
  console.log("OS:", getOs());
  console.log("Chrome:", chrome.executablePath || "NOT FOUND", `(${chrome.source})`);
  console.log("Root admins (.env):", ROOT_ADMIN_IDS.join(", ") || "(none)");
  console.log("Extra admins:", store.getExtraAdminIds().join(", ") || "(none)");
  console.log("Headless:", process.env.HEADLESS !== "false");
  console.log("Handler timeout ms:", HANDLER_TIMEOUT_MS);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
