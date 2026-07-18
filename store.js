const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ADMINS_FILE = path.join(DATA_DIR, "admins.json");

const STATUSES = ["pending", "approved", "rejected", "blocked"];

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  if (!fs.existsSync(ADMINS_FILE)) {
    fs.writeFileSync(
      ADMINS_FILE,
      JSON.stringify({ admins: [], adminsDetailed: [], history: [] }, null, 2)
    );
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

function readAdminsFile() {
  ensureStore();
  return JSON.parse(fs.readFileSync(ADMINS_FILE, "utf8"));
}

function writeAdminsFile(data) {
  ensureStore();
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(data, null, 2));
}

/** Extra admins added by other admins (not from .env) */
function getExtraAdminIds() {
  const data = readAdminsFile();
  return (data.admins || []).map(String);
}

function getAdminRecords() {
  const data = readAdminsFile();
  return data.adminsDetailed || [];
}

function addAdmin(telegramId, addedBy) {
  const id = String(telegramId).trim();
  if (!/^\d+$/.test(id)) {
    return { ok: false, message: "Admin Telegram ID must be numeric." };
  }

  const data = readAdminsFile();
  const list = (data.admins || []).map(String);
  if (list.includes(id)) {
    return { ok: false, message: `Already an admin: ${id}` };
  }

  list.push(id);
  data.admins = list;
  data.adminsDetailed = data.adminsDetailed || [];
  data.adminsDetailed.push({
    telegramId: id,
    addedBy: String(addedBy),
    addedAt: new Date().toISOString(),
  });
  data.history = data.history || [];
  data.history.push({
    action: "add",
    telegramId: id,
    by: String(addedBy),
    at: new Date().toISOString(),
  });
  writeAdminsFile(data);
  return { ok: true, telegramId: id, message: `Admin added: ${id}` };
}

function removeAdmin(telegramId, removedBy) {
  const id = String(telegramId).trim();
  const data = readAdminsFile();
  const list = (data.admins || []).map(String);
  if (!list.includes(id)) {
    return { ok: false, message: `Not in extra admin list: ${id}` };
  }

  data.admins = list.filter((a) => a !== id);
  data.adminsDetailed = (data.adminsDetailed || []).filter(
    (a) => String(a.telegramId) !== id
  );
  data.history = data.history || [];
  data.history.push({
    action: "remove",
    telegramId: id,
    by: String(removedBy),
    at: new Date().toISOString(),
  });
  writeAdminsFile(data);
  return { ok: true, telegramId: id, message: `Admin removed: ${id}` };
}

function getUser(telegramId) {
  const store = readStore();
  return store.users[String(telegramId)] || null;
}

function getAllUsers() {
  const store = readStore();
  return Object.values(store.users);
}

function getUsersByStatus(status) {
  return getAllUsers().filter((u) => u.status === status);
}

function getPendingUsers() {
  return getUsersByStatus("pending");
}

function getApprovedUsers() {
  return getUsersByStatus("approved");
}

function getRejectedUsers() {
  return getUsersByStatus("rejected");
}

function getBlockedUsers() {
  return getUsersByStatus("blocked");
}

function findUser(query) {
  if (!query) return null;
  const q = String(query).trim();
  if (!q) return null;

  const byId = getUser(q);
  if (byId) return byId;

  const lower = q.toLowerCase();
  return (
    getAllUsers().find(
      (u) =>
        String(u.username || "").toLowerCase() === lower ||
        String(u.telegramUsername || "").toLowerCase() === lower ||
        String(u.telegramUsername || "").toLowerCase() === lower.replace(/^@/, "")
    ) || null
  );
}

function findUsersByLogin(login) {
  const lower = String(login || "").trim().toLowerCase();
  if (!lower) return [];
  return getAllUsers().filter((u) => String(u.username || "").toLowerCase() === lower);
}

function upsertUser(telegramId, patch) {
  const store = readStore();
  const key = String(telegramId);
  const existing = store.users[key] || {
    telegramId: key,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  store.users[key] = {
    ...existing,
    ...patch,
    telegramId: key,
    updatedAt: new Date().toISOString(),
  };

  writeStore(store);
  return store.users[key];
}

function setStatus(telegramId, status, extra = {}) {
  if (!STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  return upsertUser(telegramId, { status, ...extra });
}

function deleteUser(telegramId) {
  const store = readStore();
  delete store.users[String(telegramId)];
  writeStore(store);
}

function counts() {
  const all = getAllUsers();
  return {
    total: all.length,
    pending: all.filter((u) => u.status === "pending").length,
    approved: all.filter((u) => u.status === "approved").length,
    rejected: all.filter((u) => u.status === "rejected").length,
    blocked: all.filter((u) => u.status === "blocked").length,
  };
}

module.exports = {
  STATUSES,
  getUser,
  getAllUsers,
  getUsersByStatus,
  getPendingUsers,
  getApprovedUsers,
  getRejectedUsers,
  getBlockedUsers,
  findUser,
  findUsersByLogin,
  upsertUser,
  setStatus,
  deleteUser,
  counts,
  getExtraAdminIds,
  getAdminRecords,
  addAdmin,
  removeAdmin,
};
