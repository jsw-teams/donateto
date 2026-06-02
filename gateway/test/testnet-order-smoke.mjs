import assert from "node:assert";

const baseUrl = process.env.TESTNET_GATEWAY_URL || "http://127.0.0.1:9011";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${payload.error || response.statusText}`);
  }
  return { response, payload };
}

const health = await request("/healthz");
assert.equal(health.payload.ok, true);

const created = await request("/api/v1/donate", {
  method: "POST",
  body: JSON.stringify({
    amount: process.env.TESTNET_AMOUNT || "5.00",
    asset: "USDT",
    network: "TRC20",
    displayName: "TRON testnet smoke",
    sourceNoticeAccepted: true
  })
});

assert.equal(created.payload.ok, true);
assert.match(created.payload.orderId, /^dt_\d{8}_[a-f0-9]{10}$/);
assert.match(created.payload.payTo, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);

console.log(JSON.stringify({
  ok: true,
  network: "TRON testnet",
  orderId: created.payload.orderId,
  amount: created.payload.amount,
  payTo: created.payload.payTo,
  next: "Send Nile/Shasta faucet USDT to payTo, then run admin TRON sync or wait for polling."
}, null, 2));
