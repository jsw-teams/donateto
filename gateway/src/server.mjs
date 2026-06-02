#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { utils as tronUtils } from "tronweb";
import { addAdminSession, addOrder, deleteAdminSession, ensureLedger, expireOpenOrders, findAdminSession, findOrder, listOrders, updateOrder } from "./store.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.env.DONATE_GATEWAY_CONFIG || path.join(rootDir, "config", "config.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const ledgerPath = config.ledger?.path || path.join(rootDir, "data", "orders.json");
const logPath = path.join(rootDir, "logs", "server.log");
const walletPath = config.wallet?.path || path.join(rootDir, "data", "wallets.json");
const walletKeyPath = config.wallet?.encryptionKeyFile || path.join(rootDir, "config", "wallet-secret.key");
const localSanctionsPath = config.screening?.localSanctionsPath
  || config.screening?.localBlocklistPath
  || path.join(rootDir, "config", "sanctions-addresses.txt");

await ensureLedger(ledgerPath);

function nowIso() {
  return new Date().toISOString();
}

async function logEvent(message, data = {}) {
  const line = JSON.stringify({ ts: nowIso(), message, ...data });
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${line}\n`, "utf8");
}

function json(res, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...headers
  });
  res.end(payload);
}

function html(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

function allowedCorsOrigin(req) {
  const origin = req.headers.origin || "";
  const allowed = config.server?.allowedOrigins || [];
  return allowed.includes(origin) ? origin : "";
}

function corsHeaders(req) {
  const origin = allowedCorsOrigin(req);
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Accept, Content-Type",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, {
    location,
    "cache-control": "no-store",
    ...headers
  });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }));
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  return parts.join("; ");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString("utf8"));
}

function publicOrder(order) {
  return {
    orderId: order.orderId,
    status: order.status,
    asset: order.asset,
    network: order.network,
    amount: order.amount,
    payTo: order.payTo,
    expiresAt: order.expiresAt,
    publicMessage: order.publicMessage,
    reviewRequired: order.reviewRequired,
    riskTag: order.riskTag || "unknown"
  };
}

function adminOrder(order) {
  return {
    ...publicOrder(order),
    displayName: order.displayName,
    email: order.email,
    message: order.message,
    txHash: order.txHash || "",
    senderAddress: order.senderAddress || "",
    screening: order.screening || null,
    consolidation: order.consolidation || null,
    withdrawalRequest: order.withdrawalRequest || null,
    withdrawalRequests: orderWithdrawalRequests(order),
    withdrawableAmount: centsText(orderWithdrawableCents(order)),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    reviewerNote: order.reviewerNote || "",
    events: order.events || []
  };
}

function amountNumber(order) {
  const value = Number(order.amount || "0");
  return Number.isFinite(value) ? value : 0;
}

function amountCents(value) {
  const number = Number(value || "0");
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100)) : 0;
}

function centsText(cents) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function orderWithdrawalRequests(order) {
  const requests = Array.isArray(order.withdrawalRequests) ? [...order.withdrawalRequests] : [];
  if (order.withdrawalRequest && !requests.some((item) => item.id === order.withdrawalRequest.id)) {
    requests.push(order.withdrawalRequest);
  }
  return requests;
}

function requestedWithdrawalCents(order) {
  return orderWithdrawalRequests(order)
    .filter((request) => !["cancelled", "failed", "consolidated"].includes(request.status))
    .reduce((sum, request) => sum + amountCents(request.amount || order.amount), 0);
}

function orderWithdrawableCents(order) {
  if (
    order.status !== "accepted"
    || order.riskTag !== "legal"
    || order.consolidation
    || order.addressMode === "test"
  ) {
    return 0;
  }
  return Math.max(0, amountCents(order.amount) - requestedWithdrawalCents(order));
}

function summarizeOrders(orders) {
  const notDeleted = orders.filter((order) => order.status !== "expired");
  const accepted = notDeleted.filter((order) => order.status === "accepted");
  const consolidated = notDeleted.filter((order) => order.status === "consolidated");
  return {
    count: notDeleted.length,
    totalAmount: notDeleted.reduce((sum, order) => sum + amountNumber(order), 0).toFixed(2),
    acceptedAmount: accepted.reduce((sum, order) => sum + amountNumber(order), 0).toFixed(2),
    withdrawableAmount: centsText(notDeleted.reduce((sum, order) => sum + orderWithdrawableCents(order), 0)),
    consolidatedAmount: consolidated.reduce((sum, order) => sum + amountNumber(order), 0).toFixed(2)
  };
}

function parseAmount(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return { text: number.toFixed(2), number };
}

function getAsset(asset, network) {
  return (config.assets || []).find((item) => {
    return item.enabled && item.asset === asset && item.network === network;
  });
}

function activeAddressSet(orders) {
  const activeStatuses = new Set(["created", "detected", "confirmed", "pending_review", "frozen_review"]);
  return new Set(orders
    .filter((order) => activeStatuses.has(order.status))
    .map((order) => order.payTo)
    .filter(Boolean));
}

function expiredOrderRetentionMinutes() {
  return Math.max(0, Number(config.orders?.expiredOrderRetentionMinutes ?? 1440) || 0);
}

function isTestAddress(address) {
  return /^TEST_ONLY_/i.test(String(address || ""));
}

function isValidTronAddress(address) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(address || ""));
}

function normalizeScreeningAddress(address) {
  return String(address || "").trim().toLowerCase();
}

function parseSanctionsLine(line) {
  return String(line || "")
    .replace(/#.*/, "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadLocalSanctionsList() {
  try {
    const raw = await fs.readFile(localSanctionsPath, "utf8");
    const entries = new Map();
    raw.split(/\r?\n/).forEach((line, index) => {
      for (const address of parseSanctionsLine(line)) {
        entries.set(normalizeScreeningAddress(address), {
          address,
          source: "local_sanctions_file",
          line: index + 1
        });
      }
    });
    return entries;
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

async function screenLocalSanctions(addresses = {}) {
  const entries = await loadLocalSanctionsList();
  const checkedAddresses = Object.fromEntries(Object.entries(addresses)
    .map(([role, address]) => [role, String(address || "").trim()])
    .filter(([, address]) => address));
  const matches = [];
  for (const [role, address] of Object.entries(checkedAddresses)) {
    const entry = entries.get(normalizeScreeningAddress(address));
    if (entry) matches.push({ role, address, source: entry.source, line: entry.line });
  }
  return {
    provider: "local-ofac-exact",
    riskTag: matches.length ? "suspicious" : "unknown",
    checkedAt: nowIso(),
    listPath: localSanctionsPath,
    checkedAddresses,
    matches,
    note: matches.length
      ? "Local sanctions exact-match list hit. Funds must be frozen or rejected pending review."
      : "Local sanctions exact-match list checked with no hit. This does not prove lawful source."
  };
}

function combineScreening(chainScreening, sanctionsScreening) {
  const sanctionsHit = sanctionsScreening?.matches?.length > 0;
  return {
    ...chainScreening,
    provider: `${chainScreening?.provider || "unknown"}+local-ofac-exact`,
    riskTag: sanctionsHit ? "suspicious" : chainScreening?.riskTag || "unknown",
    sanctions: sanctionsScreening,
    note: sanctionsHit
      ? "Local sanctions exact-match list hit. The payment is frozen pending investigation."
      : `${chainScreening?.note || ""} Local sanctions exact-match list checked with no hit; source legality still requires review.`.trim()
  };
}

function tokenUnits(amountText, decimals = 6) {
  const [whole, fraction = ""] = String(amountText || "0").split(".");
  const base = 10n ** BigInt(decimals);
  return BigInt(whole || "0") * base + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals) || "0");
}

function amountToleranceUnits(decimals = 6) {
  return tokenUnits(config.orders?.amountTolerance || "0.01", decimals);
}

function tokenAmountText(units, decimals = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = String(units % base).padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

async function ensureWalletKey() {
  await fs.mkdir(path.dirname(walletKeyPath), { recursive: true });
  try {
    const raw = (await fs.readFile(walletKeyPath, "utf8")).trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
  } catch {}
  const key = crypto.randomBytes(32);
  await fs.writeFile(walletKeyPath, key.toString("base64"), { mode: 0o600 });
  return key;
}

function encryptSecret(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

async function readWalletStore() {
  await fs.mkdir(path.dirname(walletPath), { recursive: true });
  try {
    const raw = await fs.readFile(walletPath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return { wallets: Array.isArray(parsed.wallets) ? parsed.wallets : [] };
  } catch {
    return { wallets: [] };
  }
}

async function writeWalletStore(store) {
  await fs.mkdir(path.dirname(walletPath), { recursive: true });
  const tmp = `${walletPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmp, walletPath);
}

async function generateLocalTronWallet() {
  if (config.wallet?.localAddressGeneration !== true) return null;
  const account = tronUtils.accounts.generateAccount();
  const key = await ensureWalletKey();
  const ts = nowIso();
  const wallet = {
    id: `wal_${crypto.randomBytes(10).toString("hex")}`,
    asset: "USDT",
    network: "TRC20",
    address: account.address.base58,
    hexAddress: account.address.hex,
    privateKey: encryptSecret(account.privateKey, key),
    createdAt: ts,
    status: "allocated"
  };
  const store = await readWalletStore();
  store.wallets.unshift(wallet);
  await writeWalletStore(store);
  return { payTo: wallet.address, addressMode: "local_generated", walletId: wallet.id };
}

async function selectPaymentAddress(assetConfig, activeAddresses) {
  const pool = Array.isArray(assetConfig.addressPool)
    ? assetConfig.addressPool.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
  const validPool = pool.filter((address) => isValidTronAddress(address) && !isTestAddress(address));
  const available = validPool.find((address) => !activeAddresses.has(address));
  if (available) {
    return { payTo: available, addressMode: "pool" };
  }
  if (validPool.length > 0) {
    return { error: "no payment address is currently available; please try again later" };
  }
  const generated = await generateLocalTronWallet();
  if (generated) return generated;
  const receiveAddress = String(assetConfig.receiveAddress || "").trim();
  if (isValidTronAddress(receiveAddress) && !isTestAddress(receiveAddress)) {
    return { payTo: receiveAddress, addressMode: "single" };
  }
  return { error: "no valid USDT/TRC20 receive address is configured" };
}

function tronConfig() {
  const tron = config.tron || {};
  return {
    enabled: tron.enabled === true,
    apiBaseUrl: tron.apiBaseUrl || "https://api.trongrid.io",
    apiKey: tron.apiKey || "",
    pollIntervalSeconds: Math.max(30, Number(tron.pollIntervalSeconds || 90)),
    transferLimit: Math.max(1, Math.min(Number(tron.transferLimit || 50), 200))
  };
}

function normalizeTrc20Transfer(item) {
  const tokenInfo = item.token_info || item.tokenInfo || {};
  return {
    txHash: item.transaction_id || item.transactionId || item.hash || "",
    from: item.from || item.owner_address || "",
    to: item.to || item.to_address || "",
    value: String(item.value || "0"),
    tokenAddress: tokenInfo.address || item.contract_address || item.contractAddress || "",
    tokenSymbol: tokenInfo.symbol || item.symbol || "",
    tokenDecimals: Number(tokenInfo.decimals ?? item.decimals ?? 6),
    blockTimestamp: Number(item.block_timestamp || item.timestamp || 0)
  };
}

async function fetchTronTrc20Transfers(address, assetConfig) {
  const tron = tronConfig();
  const url = new URL(`/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`, tron.apiBaseUrl);
  url.searchParams.set("only_confirmed", "true");
  url.searchParams.set("limit", String(tron.transferLimit));
  const headers = {};
  if (tron.apiKey) headers["TRON-PRO-API-KEY"] = tron.apiKey;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`trongrid returned ${response.status}`);
  }
  const payload = await response.json();
  return (payload.data || [])
    .map(normalizeTrc20Transfer)
    .filter((transfer) => {
      const expectedContract = String(assetConfig.tokenContract || "").trim().toLowerCase();
      const expectedSymbol = String(assetConfig.tokenSymbol || "").trim().toUpperCase();
      const tokenMatches = expectedContract
        ? transfer.tokenAddress.toLowerCase() === expectedContract
        : !expectedSymbol || transfer.tokenSymbol.toUpperCase() === expectedSymbol;
      return tokenMatches && transfer.to === address;
    });
}

async function validateConsolidationTransfer(order, body) {
  if (!isValidTronAddress(body.consolidationAddress)) {
    return { error: "valid Binance USDT/TRC20 deposit address is required" };
  }
  const txHash = String(body.consolidationTxHash || "").trim();
  if (!txHash) {
    return { error: "consolidation transaction hash is required" };
  }
  if (!isValidTronAddress(order.payTo) || isTestAddress(order.payTo)) {
    return { error: "order receive address is not a valid production TRON address" };
  }
  const assetConfig = getAsset(order.asset, order.network);
  if (!assetConfig) {
    return { error: "asset or network is not enabled" };
  }
  const transfers = await fetchTronTrc20Transfers(body.consolidationAddress, assetConfig);
  const transfer = transfers.find((item) => item.txHash === txHash);
  if (!transfer) {
    return { error: "consolidation transaction was not found on TRON for this Binance address" };
  }
  if (transfer.from !== order.payTo) {
    return { error: "consolidation transaction source does not match the order receive address" };
  }
  const expected = tokenUnits(order.amount, transfer.tokenDecimals || 6);
  const moved = BigInt(transfer.value || "0");
  const tolerance = amountToleranceUnits(transfer.tokenDecimals || 6);
  if (moved + tolerance < expected) {
    return { error: "consolidation amount is lower than the order amount" };
  }
  return {
    ok: true,
    transfer,
    amount: tokenAmountText(moved, transfer.tokenDecimals || 6),
    amountDifference: tokenAmountText(moved > expected ? moved - expected : expected - moved, transfer.tokenDecimals || 6)
  };
}

function matchOrderTransfer(order, assetConfig, transfer) {
  if (!transfer.txHash || !isValidTronAddress(transfer.from) || transfer.to !== order.payTo) return null;
  if (transfer.blockTimestamp && Date.parse(order.createdAt) > transfer.blockTimestamp) return null;
  const expected = tokenUnits(order.amount, transfer.tokenDecimals || 6);
  const received = BigInt(transfer.value || "0");
  const tolerance = amountToleranceUnits(transfer.tokenDecimals || 6);
  const difference = received > expected ? received - expected : expected - received;
  const amountMatched = difference <= tolerance;
  return {
    amountMatched,
    status: amountMatched ? "pending_review" : "frozen_review",
    riskTag: amountMatched ? "unknown" : "suspicious",
    screening: {
      provider: "trongrid",
      riskTag: amountMatched ? "unknown" : "suspicious",
      amountMatched,
      amountDifference: tokenAmountText(difference, transfer.tokenDecimals || 6),
      amountTolerance: tokenAmountText(tolerance, transfer.tokenDecimals || 6),
      note: amountMatched
        ? "TRON confirmed a USDT/TRC20 transfer within the configured amount tolerance. Source legality still requires manual or AML-provider review."
        : "TRON confirmed a transfer to the order address, but the amount does not match the order."
    },
    transfer
  };
}

async function syncTronPayments() {
  const tron = tronConfig();
  if (!tron.enabled) return { checked: 0, updated: 0 };
  await expireOpenOrders(ledgerPath, expiredOrderRetentionMinutes());
  const orders = await listOrders(ledgerPath, 500);
  let checked = 0;
  let updated = 0;
  for (const order of orders) {
    if (order.status !== "created" || !isValidTronAddress(order.payTo)) continue;
    const assetConfig = getAsset(order.asset, order.network);
    if (!assetConfig) continue;
    checked += 1;
    const transfers = await fetchTronTrc20Transfers(order.payTo, assetConfig);
    const match = transfers
      .map((transfer) => matchOrderTransfer(order, assetConfig, transfer))
      .find(Boolean);
    if (!match) continue;
    const sanctionsScreening = await screenLocalSanctions({
      senderAddress: match.transfer.from,
      receiveAddress: order.payTo
    });
    const sanctionsHit = sanctionsScreening.matches.length > 0;
    const nextStatus = sanctionsHit ? "frozen_review" : match.status;
    const nextRiskTag = sanctionsHit ? "suspicious" : match.riskTag;
    const nextScreening = combineScreening(match.screening, sanctionsScreening);
    const ts = nowIso();
    const next = await updateOrder(ledgerPath, order.orderId, (current) => {
      if (current.status !== "created") return current;
      return {
        ...current,
        status: nextStatus,
        riskTag: nextRiskTag,
        senderAddress: match.transfer.from,
        txHash: match.transfer.txHash,
        updatedAt: ts,
        screening: nextScreening,
        publicMessage: nextStatus === "pending_review"
          ? "Thank you for the intention to support this site. A matching USDT/TRC20 payment was detected and is awaiting review."
          : "Thank you for the intention to support this site. A payment was detected, but it needs investigation before it can be accepted.",
        events: [
          ...(current.events || []),
          {
            ts,
            type: "tron_payment_detected",
            txHash: match.transfer.txHash,
            senderAddress: match.transfer.from,
            amountMatched: match.amountMatched,
            localSanctionsHit: sanctionsHit
          }
        ]
      };
    });
    if (next?.updatedAt === ts) {
      updated += 1;
      await logEvent("tron-payment-detected", {
        orderId: order.orderId,
        txHash: match.transfer.txHash,
        senderAddress: match.transfer.from,
        amountMatched: match.amountMatched,
        localSanctionsHit: sanctionsHit
      });
    }
  }
  return { checked, updated };
}

async function createOrder(body, activeAddresses = new Set()) {
  const asset = body.asset || config.orders?.defaultAsset || "USDT";
  const network = body.network || config.orders?.defaultNetwork || "TRC20";
  const assetConfig = getAsset(asset, network);
  if (!assetConfig) {
    return { error: "asset or network is not enabled" };
  }

  if (config.risk?.sourceNoticeRequired && body.sourceNoticeAccepted !== true) {
    return { error: "source notice must be accepted" };
  }

  const amount = parseAmount(body.amount);
  const minimum = Number(config.orders?.minimumAmount || "1.00");
  const maximum = Number(config.orders?.maximumAmount || "20.00");
  if (!amount || amount.number < minimum || amount.number > maximum) {
    return { error: `amount must be between ${minimum.toFixed(2)} and ${maximum.toFixed(2)}` };
  }

  const selectedAddress = await selectPaymentAddress(assetConfig, activeAddresses);
  if (selectedAddress.error) {
    return { error: selectedAddress.error };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + Number(config.orders?.defaultExpiryMinutes || 30) * 60 * 1000);
  const orderId = `dt_${now.toISOString().slice(0, 10).replaceAll("-", "")}_${crypto.randomBytes(5).toString("hex")}`;

  return {
    order: {
      orderId,
      status: "created",
      riskTag: "unknown",
      asset,
      network,
      amount: amount.text,
      payTo: selectedAddress.payTo,
      addressMode: selectedAddress.addressMode,
      walletId: selectedAddress.walletId || "",
      sourceNoticeAccepted: true,
      displayName: String(body.displayName || "").trim().slice(0, 80),
      email: String(body.email || "").trim().slice(0, 120),
      message: String(body.message || "").trim().slice(0, 500),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      reviewRequired: true,
      publicMessage: "Order created. Thank you for wanting to support this site. Payment must be reviewed before funds are accepted.",
      events: [
        {
          ts: now.toISOString(),
          type: "order_created",
          note: "Donation intent created."
        }
      ]
    }
  };
}

async function handleCreate(req, res) {
  const body = await readJson(req);
  await expireOpenOrders(ledgerPath, expiredOrderRetentionMinutes());
  const activeOrders = await listOrders(ledgerPath, 500);
  const result = await createOrder(body, activeAddressSet(activeOrders));
  if (result.error) {
    json(res, 400, { ok: false, error: result.error }, corsHeaders(req));
    return;
  }
  await addOrder(ledgerPath, result.order);
  await logEvent("order-created", { orderId: result.order.orderId, asset: result.order.asset, network: result.order.network, amount: result.order.amount });
  json(res, 201, { ok: true, ...publicOrder(result.order) }, {
    ...corsHeaders(req),
    "set-cookie": cookie("donate_order_id", result.order.orderId, { path: "/", maxAge: 60 * 60 * 24 * 7 })
  });
}

async function handleGet(req, res, orderId) {
  await expireOpenOrders(ledgerPath, expiredOrderRetentionMinutes());
  if (parseCookies(req).donate_order_id !== orderId) {
    json(res, 403, {
      ok: false,
      error: "this browser session is not allowed to query that order"
    }, corsHeaders(req));
    return;
  }
  const order = await findOrder(ledgerPath, orderId);
  if (!order) {
    json(res, 404, { ok: false, error: "order not found" }, corsHeaders(req));
    return;
  }
  json(res, 200, { ok: true, ...publicOrder(order) }, corsHeaders(req));
}

async function handleSessionLatest(req, res) {
  await expireOpenOrders(ledgerPath, expiredOrderRetentionMinutes());
  await syncTronPayments().catch((error) => logEvent("tron-sync-error", { error: error.message, surface: "session_latest" }));
  const orderId = parseCookies(req).donate_order_id || "";
  if (!/^dt_\d{8}_[a-f0-9]{10}$/.test(orderId)) {
    json(res, 404, {
      ok: false,
      error: "no order is associated with this browser session"
    }, corsHeaders(req));
    return;
  }
  const order = await findOrder(ledgerPath, orderId);
  if (!order) {
    json(res, 404, {
      ok: false,
      error: "order not found for this browser session"
    }, corsHeaders(req));
    return;
  }
  json(res, 200, { ok: true, ...publicOrder(order) }, corsHeaders(req));
}

async function handleSimulate(req, res) {
  if (config.test?.allowSimulate !== true) {
    json(res, 404, { ok: false, error: "not found" }, corsHeaders(req));
    return;
  }
  const body = await readJson(req);
  const allowed = new Set(["detected", "confirmed", "pending_review", "accepted", "frozen_review", "rejected"]);
  if (!body.orderId || !allowed.has(body.status)) {
    json(res, 400, { ok: false, error: "orderId and valid status are required" }, corsHeaders(req));
    return;
  }
  const updated = await updateOrder(ledgerPath, body.orderId, (order) => {
    const ts = nowIso();
    return {
      ...order,
      status: body.status,
      updatedAt: ts,
      txHash: body.txHash || order.txHash || "",
      senderAddress: body.senderAddress || order.senderAddress || "",
      screening: body.screening || order.screening || null,
      publicMessage: body.status === "accepted"
        ? "Thank you. Your support has been accepted."
        : body.status === "frozen_review"
          ? "Thank you for the intention to support this site. The funds need investigation, so they are not accepted yet. You may contact helper@js.gripe if you need to provide context."
          : "Thank you for the intention to support this site. The payment event is recorded and awaiting review.",
      events: [
        ...(order.events || []),
        {
          ts,
          type: "simulated_payment_event",
          status: body.status,
          txHash: body.txHash || "",
          note: body.note || "Test event."
        }
      ]
    };
  });
  if (!updated) {
    json(res, 404, { ok: false, error: "order not found" }, corsHeaders(req));
    return;
  }
  await logEvent("order-simulated", { orderId: updated.orderId, status: updated.status });
  json(res, 200, { ok: true, ...publicOrder(updated) }, corsHeaders(req));
}

function accountConfig() {
  const account = config.account || {};
  return {
    clientId: account.clientId || "",
    loginUrl: account.loginUrl || "https://account.js.gripe/login",
    meUrl: account.meUrl || "https://gateway.js.gripe/api/v1/myaccount/me",
    redirectUri: account.redirectUri || "https://pay.js.gripe/auth/account/callback",
    scopes: Array.isArray(account.scopes) && account.scopes.length ? account.scopes : ["accounts:read"]
  };
}

async function fetchAccountMe(token) {
  const account = accountConfig();
  const response = await fetch(account.meUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  return await response.json();
}

async function requireAdmin(req) {
  const sessionId = parseCookies(req).donate_admin_session;
  if (!sessionId) return null;
  return await findAdminSession(ledgerPath, sessionId);
}

function popupHtml(success, redirectTo, message) {
  const safeRedirect = JSON.stringify(redirectTo || "/admin/");
  const safeMessage = JSON.stringify(message || "");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录完成</title></head><body><p>${message || ""}</p><script>
    const payload = { type: "donate-auth", ok: ${success ? "true" : "false"}, message: ${safeMessage} };
    if (window.opener) {
      window.opener.postMessage(payload, location.origin);
      window.close();
    } else {
      location.href = ${safeRedirect};
    }
  </script></body></html>`;
}

async function handleAuthStart(req, res, url) {
  const account = accountConfig();
  if (!account.clientId || account.clientId.includes("REPLACE")) {
    json(res, 501, {
      ok: false,
      error: "account-system client_id is not configured",
      next: "Create a donate-gateway client in account-system and set config.account.clientId."
    });
    return;
  }
  const state = crypto.randomBytes(18).toString("base64url");
  const login = new URL(account.loginUrl);
  login.searchParams.set("client_id", account.clientId);
  login.searchParams.set("redirect_uri", account.redirectUri);
  login.searchParams.set("scope", account.scopes.join(" "));
  login.searchParams.set("state", state);
  login.searchParams.set("prompt", "consent");
  const setCookie = cookie("donate_oauth_state", state, { path: "/auth/account", maxAge: 600 });
  redirect(res, login.toString(), { "set-cookie": setCookie });
}

async function handleAuthCallback(req, res, url) {
  const expectedState = parseCookies(req).donate_oauth_state;
  const actualState = url.searchParams.get("state") || "";
  const clearState = cookie("donate_oauth_state", "", { path: "/auth/account", maxAge: -1 });
  if (!expectedState || expectedState !== actualState) {
    html(res, 400, popupHtml(false, "/admin/", "登录状态校验失败。"), { "set-cookie": clearState });
    return;
  }
  const accountSession = url.searchParams.get("account_session") || "";
  if (!accountSession) {
    html(res, 400, popupHtml(false, "/admin/", "账户中心没有返回有效会话。"), { "set-cookie": clearState });
    return;
  }
  const me = await fetchAccountMe(accountSession);
  const user = me?.user;
  if (!user || user.role !== "system_admin") {
    html(res, 403, popupHtml(false, "/admin/", "只有系统管理员可以查看支持订单。"), { "set-cookie": clearState });
    return;
  }
  const session = {
    id: `das_${crypto.randomBytes(24).toString("base64url")}`,
    userId: user.id,
    email: user.email,
    displayName: user.displayName || user.display_name || user.email,
    role: user.role,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8).toISOString()
  };
  await addAdminSession(ledgerPath, session);
  const setSession = cookie("donate_admin_session", session.id, { path: "/", maxAge: 60 * 60 * 8 });
  html(res, 200, popupHtml(true, "/admin/", "登录完成。"), { "set-cookie": [clearState, setSession] });
}

async function handleAdminMe(req, res) {
  const session = await requireAdmin(req);
  if (!session) {
    json(res, 401, { ok: false, error: "admin login required" }, corsHeaders(req));
    return;
  }
  json(res, 200, { ok: true, admin: session }, corsHeaders(req));
}

async function handleAdminOrders(req, res, url) {
  const session = await requireAdmin(req);
  if (!session) {
    json(res, 401, { ok: false, error: "admin login required" }, corsHeaders(req));
    return;
  }
  await expireOpenOrders(ledgerPath, expiredOrderRetentionMinutes());
  await syncTronPayments().catch((error) => logEvent("tron-sync-error", { error: error.message, surface: "admin_orders" }));
  const allOrders = await listOrders(ledgerPath, 500);
  const orders = (await listOrders(ledgerPath, url.searchParams.get("limit") || 5)).map(adminOrder);
  json(res, 200, { ok: true, summary: summarizeOrders(allOrders), orders }, corsHeaders(req));
}

async function handleAdminTronSync(req, res) {
  const session = await requireAdmin(req);
  if (!session) {
    json(res, 401, { ok: false, error: "admin login required" }, corsHeaders(req));
    return;
  }
  const result = await syncTronPayments();
  json(res, 200, { ok: true, ...result }, corsHeaders(req));
}

function applyAdminOrderUpdate(order, body, session, consolidationCheck = null) {
  const allowed = new Set(["pending_review", "accepted", "frozen_review", "rejected"]);
  const status = String(body.status || "");
  if (!allowed.has(status)) {
    return { error: "invalid status" };
  }
  const allowedTags = new Set(["unknown", "legal", "suspicious", "illegal"]);
  const riskTag = allowedTags.has(body.riskTag) ? body.riskTag : order.riskTag || "unknown";
  if (status === "accepted" && riskTag !== "legal") {
    return { error: "accepted orders must be marked legal first" };
  }
  const ts = nowIso();
  return {
    order: {
      ...order,
      status,
      riskTag,
      consolidation: order.consolidation || null,
      updatedAt: ts,
      reviewerNote: String(body.note || order.reviewerNote || "").slice(0, 1000),
      publicMessage: status === "accepted"
        ? "Thank you. Your support has been accepted."
        : status === "frozen_review"
          ? "Thank you for the intention to support this site. The funds need investigation, so they are not accepted yet. You may contact helper@js.gripe if you need to provide context."
          : status === "rejected"
            ? "Thank you for the intention to support this site. This payment cannot be accepted; please contact helper@js.gripe if you need assistance."
            : order.publicMessage,
      events: [
        ...(order.events || []),
        {
          ts,
          type: "admin_status_update",
          status,
          riskTag,
          actor: session.email,
          note: String(body.note || "").slice(0, 1000)
        }
      ]
    }
  };
}

async function handleAdminUpdateOrder(req, res, orderId) {
  const session = await requireAdmin(req);
  if (!session) {
    json(res, 401, { ok: false, error: "admin login required" }, corsHeaders(req));
    return;
  }
  const body = await readJson(req);
  const existing = await findOrder(ledgerPath, orderId);
  if (!existing) {
    json(res, 404, { ok: false, error: "order not found" }, corsHeaders(req));
    return;
  }
  let validationError = "";
  const updated = await updateOrder(ledgerPath, orderId, (order) => {
    const result = applyAdminOrderUpdate(order, body, session);
    if (result.error) {
      validationError = result.error;
      return order;
    }
    return result.order;
  });
  if (validationError) {
    json(res, 400, { ok: false, error: validationError }, corsHeaders(req));
    return;
  }
  if (!updated) {
    json(res, 404, { ok: false, error: "order not found" }, corsHeaders(req));
    return;
  }
  await logEvent("admin-order-updated", { orderId, status: updated.status, actor: session.email });
  json(res, 200, { ok: true, order: adminOrder(updated) }, corsHeaders(req));
}

async function handleAdminBatchUpdate(req, res) {
  const session = await requireAdmin(req);
  if (!session) {
    json(res, 401, { ok: false, error: "admin login required" }, corsHeaders(req));
    return;
  }
  const body = await readJson(req);
  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id) => /^dt_\d{8}_[a-f0-9]{10}$/.test(String(id)))
    : [];
  if (orderIds.length === 0) {
    json(res, 400, { ok: false, error: "no valid order ids selected" }, corsHeaders(req));
    return;
  }
  const results = [];
  for (const orderId of orderIds) {
    const existing = await findOrder(ledgerPath, orderId);
    if (!existing) {
      results.push({ orderId, ok: false, error: "order not found" });
      continue;
    }
    let validationError = "";
    const updated = await updateOrder(ledgerPath, orderId, (order) => {
      const result = applyAdminOrderUpdate(order, body, session);
      if (result.error) {
        validationError = result.error;
        return order;
      }
      return result.order;
    });
    if (!updated) {
      results.push({ orderId, ok: false, error: "order not found" });
    } else if (validationError) {
      results.push({ orderId, ok: false, error: validationError });
    } else {
      results.push({ orderId, ok: true });
      await logEvent("admin-order-updated", { orderId, status: updated.status, actor: session.email, batch: true });
    }
  }
  json(res, 200, { ok: true, results }, corsHeaders(req));
}

async function handleAdminWithdrawalRequest(req, res) {
  const session = await requireAdmin(req);
  if (!session) {
    json(res, 401, { ok: false, error: "admin login required" }, corsHeaders(req));
    return;
  }
  const body = await readJson(req);
  const amount = parseAmount(body.amount);
  if (!amount || amount.number <= 0) {
    json(res, 400, { ok: false, error: "withdrawal amount is required" }, corsHeaders(req));
    return;
  }
  const requestedCents = amountCents(amount.text);
  const destinationAddress = String(body.destinationAddress || "").trim();
  if (!isValidTronAddress(destinationAddress)) {
    json(res, 400, { ok: false, error: "valid Binance USDT/TRC20 deposit address is required" }, corsHeaders(req));
    return;
  }
  const destinationScreening = await screenLocalSanctions({ destinationAddress });
  if (destinationScreening.matches.length > 0) {
    await logEvent("withdrawal-destination-sanctions-hit", { actor: session.email, destinationAddress, matches: destinationScreening.matches });
    json(res, 400, {
      ok: false,
      error: "destination address matched the local sanctions exact-match list",
      screening: destinationScreening
    }, corsHeaders(req));
    return;
  }
  const allOrders = await listOrders(ledgerPath, 500);
  const eligible = allOrders
    .map((order) => ({ order, availableCents: orderWithdrawableCents(order) }))
    .filter((item) => item.availableCents > 0);
  const withdrawableCents = eligible.reduce((sum, item) => sum + item.availableCents, 0);
  if (requestedCents > withdrawableCents) {
    json(res, 400, {
      ok: false,
      error: "withdrawal amount exceeds withdrawable balance",
      withdrawableAmount: centsText(withdrawableCents)
    }, corsHeaders(req));
    return;
  }

  let remainingCents = requestedCents;
  const allocations = [];
  for (const item of eligible) {
    if (remainingCents <= 0) break;
    const allocationCents = Math.min(item.availableCents, remainingCents);
    allocations.push({ orderId: item.order.orderId, amountCents: allocationCents });
    remainingCents -= allocationCents;
  }

  const requestId = `wdr_${crypto.randomBytes(10).toString("hex")}`;
  const results = [];
  for (const allocation of allocations) {
    const allocationAmount = centsText(allocation.amountCents);
    let validationError = "";
    const updated = await updateOrder(ledgerPath, allocation.orderId, (order) => {
      if (orderWithdrawableCents(order) < allocation.amountCents) {
        validationError = "order no longer has enough withdrawable balance";
        return order;
      }
      const ts = nowIso();
      const withdrawalRequest = {
        id: requestId,
        destination: "binance",
        address: destinationAddress,
        amount: allocationAmount,
        status: "requested",
        destinationScreening,
        requestedAt: ts,
        actor: session.email
      };
      return {
        ...order,
        withdrawalRequest,
        withdrawalRequests: [...orderWithdrawalRequests(order), withdrawalRequest],
        updatedAt: ts,
        events: [
          ...(order.events || []),
          {
            ts,
            type: "withdrawal_requested",
            requestId,
            destination: "binance",
            amount: allocationAmount,
            actor: session.email
          }
        ]
      };
    });
    if (!updated) {
      results.push({ orderId: allocation.orderId, ok: false, error: "order not found" });
    } else if (validationError) {
      results.push({ orderId: allocation.orderId, ok: false, error: validationError });
    } else if (updated.withdrawalRequest?.id === requestId) {
      results.push({ orderId: allocation.orderId, ok: true, amount: allocationAmount });
      await logEvent("withdrawal-requested", { orderId: allocation.orderId, requestId, amount: allocationAmount, actor: session.email });
    } else {
      results.push({ orderId: allocation.orderId, ok: false, error: "withdrawal request was not recorded" });
    }
  }
  json(res, 200, { ok: true, requestId, requestedAmount: amount.text, results }, corsHeaders(req));
}

async function handleAdminLogout(req, res) {
  const sessionId = parseCookies(req).donate_admin_session;
  if (sessionId) await deleteAdminSession(ledgerPath, sessionId);
  json(res, 200, { ok: true }, {
    ...corsHeaders(req),
    "set-cookie": cookie("donate_admin_session", "", { path: "/", maxAge: -1 })
  });
}

async function handleWebhook(req, res) {
  const body = await readJson(req);
  if (body.orderId && /^dt_\d{8}_[a-f0-9]{10}$/.test(body.orderId)) {
    const existing = await findOrder(ledgerPath, body.orderId);
    if (!existing) {
      json(res, 404, { ok: false, error: "order not found" }, corsHeaders(req));
      return;
    }
    const consolidationCheck = body.status === "consolidated"
      ? await validateConsolidationTransfer(existing, body)
      : null;
    if (consolidationCheck?.error) {
      json(res, 400, { ok: false, error: consolidationCheck.error }, corsHeaders(req));
      return;
    }
    const sourceAddress = String(body.senderAddress || body.from || existing.senderAddress || "").slice(0, 128);
    const consolidationAddress = String(body.consolidationAddress || "").trim();
    const localScreening = await screenLocalSanctions({
      senderAddress: sourceAddress,
      receiveAddress: existing.payTo,
      destinationAddress: consolidationAddress
    });
    if (body.status === "consolidated" && localScreening.matches.length > 0) {
      json(res, 400, {
        ok: false,
        error: "local sanctions exact-match hit; consolidation cannot be recorded",
        screening: localScreening
      }, corsHeaders(req));
      return;
    }
    const updated = await updateOrder(ledgerPath, body.orderId, (order) => {
      const ts = nowIso();
      const requestedStatus = body.status || "detected";
      const sanctionsHit = localScreening.matches.length > 0;
      const nextStatus = sanctionsHit ? "frozen_review" : requestedStatus;
      const consolidation = nextStatus === "consolidated"
        ? {
            destination: "binance",
            address: String(body.consolidationAddress || "").trim(),
            txHash: String(body.consolidationTxHash || "").trim().slice(0, 128),
            amount: consolidationCheck.amount,
            amountDifference: consolidationCheck.amountDifference,
            markedAt: ts,
            actor: body.provider || "wallet-service"
          }
        : order.consolidation || null;
      return {
        ...order,
        status: nextStatus,
        txHash: String(body.txHash || order.txHash || "").slice(0, 128),
        senderAddress: sourceAddress || String(order.senderAddress || "").slice(0, 128),
        consolidation,
        updatedAt: ts,
        riskTag: sanctionsHit ? "suspicious" : order.riskTag || "unknown",
        screening: combineScreening(body.screening || order.screening || {
          provider: body.provider || "unknown",
          riskTag: "unknown",
          note: "Source address recorded from payment event. Manual review or AML provider screening is still required."
        }, localScreening),
        publicMessage: nextStatus === "frozen_review"
          ? "Thank you for the intention to support this site. The funds need investigation, so they are not accepted yet."
          : "Thank you for the intention to support this site. The payment event is recorded and awaiting review.",
        events: [
          ...(order.events || []),
          {
            ts,
            type: "payment_event",
            provider: body.provider || "unknown",
            txHash: String(body.txHash || "").slice(0, 128),
            senderAddress: sourceAddress,
            consolidationTxHash: nextStatus === "consolidated" ? consolidation.txHash : "",
            localSanctionsHit: sanctionsHit
          }
        ]
      };
    });
    if (!updated) {
      json(res, 404, { ok: false, error: "order not found" }, corsHeaders(req));
      return;
    }
  }
  await logEvent("webhook-received", {
    provider: body.provider || "unknown",
    orderId: body.orderId || "",
    senderAddress: body.senderAddress || body.from || "",
    eventId: body.eventId || "",
    txHash: body.txHash || ""
  });
  json(res, 202, {
    ok: true,
    accepted: true,
    note: "Webhook recorded. Real provider signature validation is required before production use."
  }, corsHeaders(req));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const headers = corsHeaders(req);

    if (req.method === "OPTIONS") {
      res.writeHead(headers["access-control-allow-origin"] ? 204 : 403, headers);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/account/start") {
      await handleAuthStart(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/account/callback") {
      await handleAuthCallback(req, res, url);
      return;
    }

    if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/api/v1/donate/healthz")) {
      json(res, 200, { ok: true, service: "donate-gateway" }, headers);
      return;
    }

    if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/api/v1/donate")) {
      await handleCreate(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/donate/session/latest") {
      await handleSessionLatest(req, res);
      return;
    }

    const getMatch = url.pathname.match(/^\/(?:api\/v1\/donate\/)?(dt_\d{8}_[a-f0-9]{10})$/);
    if (req.method === "GET" && getMatch) {
      await handleGet(req, res, getMatch[1]);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/donate/webhook") {
      await handleWebhook(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/donate/test/simulate") {
      await handleSimulate(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/donate/admin/me") {
      await handleAdminMe(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/donate/admin/logout") {
      await handleAdminLogout(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/donate/admin/orders") {
      await handleAdminOrders(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/donate/admin/orders/batch") {
      await handleAdminBatchUpdate(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/donate/admin/withdrawals/request") {
      await handleAdminWithdrawalRequest(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/donate/admin/tron/sync") {
      await handleAdminTronSync(req, res);
      return;
    }

    const adminOrderMatch = url.pathname.match(/^\/api\/v1\/donate\/admin\/orders\/(dt_\d{8}_[a-f0-9]{10})$/);
    if (req.method === "PATCH" && adminOrderMatch) {
      await handleAdminUpdateOrder(req, res, adminOrderMatch[1]);
      return;
    }

    json(res, 404, { ok: false, error: "not found" }, headers);
  } catch (error) {
    await logEvent("error", { error: error.message });
    json(res, 500, { ok: false, error: error.message });
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`donate-gateway listening on http://${config.server.host}:${config.server.port}`);
});

if (tronConfig().enabled) {
  setInterval(() => {
    syncTronPayments().catch((error) => logEvent("tron-sync-error", { error: error.message }));
  }, tronConfig().pollIntervalSeconds * 1000).unref();
}
