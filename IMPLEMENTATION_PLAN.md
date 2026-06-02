# Implementation Plan

## Phase 0: Host Readiness

Observed host facts:

- Debian cloud kernel on x86_64.
- 4 CPU cores.
- About 8 GiB RAM.
- About 49 GiB available disk on `/opt`.
- Node.js 22.12.0 and npm 10.9.0 are present.
- Go 1.25.6 and Python 3.11.2 are present.
- OpenResty 1.29.2.3 is present.
- Docker is not installed.

Conclusion: suitable for a lightweight Node.js service with SQLite and
OpenResty reverse proxy. Not suitable for an immediate Docker-based SHKeeper or
Bitcart deployment without installing additional infrastructure.

## Phase 1: Minimal Gateway

Create `/opt/donate-gateway` as a standalone Node service.

Core tasks:

- SQLite database for donation orders and payment events.
- `POST /api/v1/donate` to create an order.
- `GET /api/v1/donate/:id` to query order status.
- `POST /api/v1/donate/webhook` reserved for future payment-provider callbacks.
- Admin-only local endpoint or CLI to mark review decisions.
- Structured logs under `/opt/donate-gateway/logs`.

Initial payment mode:

- Show order ID, amount, asset, network, payment address, and expiry.
- Require donor to confirm they are sending from lawful funds.
- Do not show a permanent public donation address.

## Phase 2: Chain Monitoring

Add a polling worker.

For TRON / TRC20:

- Poll confirmed USDT transfers to the configured receiving address.
- Match by exact amount plus active order window.
- Require enough confirmations/finality before marking `detected`.

For EVM chains:

- Poll token transfer logs for the configured contract and recipient.
- Validate token contract, recipient, amount, tx hash, and block finality.

## Phase 3: Risk Review

Add screening before acceptance.

Minimum review inputs:

- Sender address.
- Recipient address.
- Tx hash.
- Asset and network.
- Amount.
- Confirmation state.
- Any sanctions-screening result.
- Any local blacklist or allowlist hit.

Statuses:

```text
created
detected
confirmed
pending_review
accepted
rejected
frozen_review
expired
```

Only `accepted` orders can trigger thank-you messages or public display.

## Phase 4: Site Integration

Add support entry points to:

- `/opt/myweb`: contact/support page and optional footer link.
- `/opt/myblog`: article footer and about page support block.

Frontend calls:

- Create order.
- Display current status.
- Show thank-you state only after `accepted`.

## Phase 5: Consolidation to Binance

First version:

- Manual consolidation only.
- Record Binance destination address and tx hash after transfer.
- Keep review records before moving funds.

Later optional version:

- Semi-automatic consolidation script gated by manual approval.
- Never store private keys in repo.
- Use a hot wallet with low balance, not a primary wallet.

## Phase 6: Maintenance

Add:

- Backup script for SQLite.
- Log rotation.
- Health endpoint.
- OpenResty reverse proxy config.
- systemd unit.
- Smoke tests for create-order and status-query flows.
