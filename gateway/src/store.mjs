import fs from "node:fs/promises";
import path from "node:path";

export async function ensureLedger(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, JSON.stringify({ orders: [], adminSessions: [] }, null, 2), "utf8");
  }
}

export async function readLedger(file) {
  await ensureLedger(file);
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw || "{}");
  return {
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    adminSessions: Array.isArray(parsed.adminSessions) ? parsed.adminSessions : []
  };
}

export async function writeLedger(file, ledger) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function addOrder(file, order) {
  const ledger = await readLedger(file);
  ledger.orders.unshift(order);
  await writeLedger(file, ledger);
  return order;
}

export async function findOrder(file, orderId) {
  const ledger = await readLedger(file);
  return ledger.orders.find((order) => order.orderId === orderId) || null;
}

export async function updateOrder(file, orderId, updater) {
  const ledger = await readLedger(file);
  const index = ledger.orders.findIndex((order) => order.orderId === orderId);
  if (index === -1) return null;
  const next = updater(ledger.orders[index]);
  ledger.orders[index] = next;
  await writeLedger(file, ledger);
  return next;
}

export async function expireOpenOrders(file, retentionMinutes = 1440) {
  const ledger = await readLedger(file);
  const now = Date.now();
  const retentionMs = Math.max(0, Number(retentionMinutes) || 0) * 60 * 1000;
  const before = ledger.orders.length;
  ledger.orders = ledger.orders.filter((order) => {
    if (order.status === "expired") return false;
    if (order.status !== "created" || !order.expiresAt) return true;
    const expiresAt = Date.parse(order.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt > now) return true;
    return now < expiresAt + retentionMs;
  });
  const changed = ledger.orders.length !== before;
  if (changed) await writeLedger(file, ledger);
  return { deleted: before - ledger.orders.length };
}

export async function listOrders(file, limit = 100) {
  const ledger = await readLedger(file);
  return ledger.orders.slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
}


export async function addAdminSession(file, session) {
  const ledger = await readLedger(file);
  const now = Date.now();
  ledger.adminSessions = ledger.adminSessions
    .filter((item) => Date.parse(item.expiresAt) > now)
    .filter((item) => item.id !== session.id);
  ledger.adminSessions.unshift(session);
  await writeLedger(file, ledger);
  return session;
}

export async function findAdminSession(file, sessionId) {
  const ledger = await readLedger(file);
  const now = Date.now();
  const session = ledger.adminSessions.find((item) => item.id === sessionId && Date.parse(item.expiresAt) > now);
  return session || null;
}

export async function deleteAdminSession(file, sessionId) {
  const ledger = await readLedger(file);
  ledger.adminSessions = ledger.adminSessions.filter((item) => item.id !== sessionId);
  await writeLedger(file, ledger);
}
