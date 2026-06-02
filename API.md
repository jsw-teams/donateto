# API Draft

Base URL:

```text
https://gateway.js.gripe/api/v1/donate
```

## Create Donation Order

```http
POST /api/v1/donate
Content-Type: application/json
```

Request:

```json
{
  "amount": "5.00",
  "asset": "USDT",
  "network": "TRC20",
  "displayName": "optional",
  "email": "optional",
  "message": "optional",
  "sourceNoticeAccepted": true
}
```

Response:

```json
{
  "ok": true,
  "orderId": "dt_20260602_abcdef",
  "status": "created",
  "asset": "USDT",
  "network": "TRC20",
  "amount": "5.00",
  "payTo": "T...",
  "expiresAt": "2026-06-02T12:00:00.000Z"
}
```

Notes:

- `sourceNoticeAccepted` must be true.
- `payTo` is generated or assigned server-side; frontend must not submit a receive address.
- Amount matching accepts the configured small tolerance for USDT/TRC20 gas and wallet rounding behavior.
- Expired `created` orders are retained for `expiredOrderRetentionMinutes` before deletion so late chain indexing or delayed payments can still be detected.
- If a payment is detected with the wrong amount, the order becomes `frozen_review`; its receive address, sender address and tx hash must be retained.

## Query Donation Order

```http
GET /api/v1/donate/:orderId
```

Response:

```json
{
  "ok": true,
  "orderId": "dt_20260602_abcdef",
  "status": "pending_review",
  "publicMessage": "Payment detected and awaiting review."
}
```

Public statuses should avoid exposing sensitive screening details.

## Payment Webhook

Reserved for future provider integrations:

```http
POST /api/v1/donate/webhook
```

Requirements:

- HMAC signature verification.
- Idempotency by provider event ID and tx hash.
- Raw payload logging with size limits.
- No immediate acceptance before local validation and risk checks.

## Admin Review

Admin endpoints require the `donate_admin_session` cookie. Unauthenticated requests return `401`, and the frontend then redirects to account-system login.

```http
GET /api/v1/donate/admin/orders?limit=5
PATCH /api/v1/donate/admin/orders/:orderId
POST /api/v1/donate/admin/orders/batch
```

`PATCH` and batch update only handle review status, risk tag and reviewer notes. The admin console does not manually mark orders as consolidated.

## Admin Withdrawal Request

```http
POST /api/v1/donate/admin/withdrawals/request
Content-Type: application/json
```

Request:

```json
{
  "amount": "12.00",
  "destinationAddress": "T..."
}
```

Rules:

- `amount` must be greater than zero and no larger than `summary.withdrawableAmount`.
- `destinationAddress` must be a valid TRON address, normally the current Binance USDT/TRC20 deposit address.
- Backend automatically allocates the request across `accepted + legal` orders with remaining withdrawable balance.
- The endpoint records `withdrawalRequests` only. It does not sign a transaction and does not mark consolidation complete.
- Wallet service must later execute the transfer and call the webhook with the consolidation transaction.

## Test Coverage Notice

The current implementation is not fully covered by automated tests. Before production use, add automated tests for order creation, expiry retention, wrong-amount payment detection, local sanctions matching, admin auth, withdrawal allocation and consolidation webhook verification.
