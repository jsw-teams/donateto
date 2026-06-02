# Donateto

支持网关 / Donation gateway with account login and USDT/TRC20 review for public support

Languages: **English** | [简体中文](README.zh-CN.md)

`donateto` is the public audit snapshot for the JS.Gripe / 技诉 donation gateway.
It contains the lightweight backend gateway, the dedicated Astro payment/admin
frontend, and the operating documents used to keep USDT/TRC20 support reviewable.

## Project Status

| Area | Status |
| --- | --- |
| Repository | Public audit snapshot for `jsw-teams/donateto` |
| Runtime | No-Docker Node gateway behind OpenResty |
| Frontend | Astro pages for `pay.js.gripe` |
| Asset | USDT / TRC20 first |
| Screening | Local OFAC/sanctions exact-match baseline, optional manual Scorechain AI review |
| Withdrawal | Gateway records withdrawal requests; external wallet service executes transfers |
| Tests | Smoke/build checks only; full automated coverage is still missing |
| License | Not selected yet; source-available for audit until a license is added |

## Target Flow

```text
myweb / myblog
  -> gateway.js.gripe/api/v1/donate
  -> donate-gateway on localhost
  -> JSON order ledger
  -> chain polling / optional provider webhook
  -> sanctions and risk screening
  -> accepted donations are thanked
  -> withdrawal request to an external wallet service
  -> verified consolidation callback
```

## Directory Layout

```text
.
├── gateway/                  # Node donation gateway source
│   ├── src/                  # HTTP API, TRON polling, review and withdrawal logic
│   ├── config/               # Example config and local sanctions-list template
│   └── test/                 # Smoke scripts; not a complete test suite
├── pay/                      # Astro frontend for payment, status and admin pages
├── README.zh-CN.md           # Chinese overview
├── SECURITY.md               # Publication and operational security notes
├── API.md                    # API surface
├── WALLET_ADDRESS_PLAN.zh-CN.md
├── COMPLIANCE_PLAYBOOK.md
└── RISK_CONTROLS.md
```

## Current Decisions

- Do not use Docker for the first implementation.
- Do not require Binance Merchant or Binance Pay merchant API.
- Do not publish a permanent Binance deposit address as the primary support path.
- Use short-lived donation orders, explicit status tracking, and review before thanks.
- The payment gateway records withdrawal requests; signing and transfer execution belong to a separate wallet service.

## Open-Source Project Evaluation

Existing projects can solve part of the payment-processing problem:

- [Bitcart](https://github.com/bitcart/bitcart): MIT, self-hosted payment processor supporting TRX/USDT and many other assets.
- [SHKeeper](https://github.com/vsys-host/shkeeper.io): self-hosted cryptocurrency payment processor with Tron/TRC20 support and plugin/API surfaces.
- [CryptoLink](https://cryptolink.cc/docs/): MIT, self-hosted non-custodial gateway with TRON/USDT, HMAC webhooks and collector-style address handling.

This repository does not replace those projects. It keeps a small auditable
middle layer for JS.Gripe-specific concerns: account-system admin authorization,
local sanctions exact-match records, wrong-amount retention, withdrawal requests
to a personal Binance destination, and existing OpenResty/Astro integration.

## Why This Shape

The host already has Node.js, Go, Python, SQLite-capable tooling, OpenResty, and
an existing gateway pattern through `gateway.js.gripe`. Docker is not currently
installed, so a lightweight local Node service is a better first step than
SHKeeper or Bitcart.

Personal Binance accounts can receive funds, but they do not provide the same
merchant webhook surface as Binance Pay Merchant. The gateway therefore treats
Binance as the final consolidation destination, not as the payment processor.

## Recommended First Network

Start with one stablecoin rail only:

- Preferred: USDT on TRON / TRC20 if donor convenience matters most.
- Alternative: USDC or USDT on Polygon/Base if lower consolidation friction and
  EVM tooling are more important.

Do not enable many chains on day one. Each chain adds monitoring, address
generation, confirmation, and risk-review work.

## Non-Negotiable Controls

- Every payment must be tied to an order ID.
- Unknown direct transfers are not treated as accepted support.
- Suspicious funds are marked `frozen_review` and are not thanked publicly.
- No automatic refund of suspicious funds.
- Wrong-amount payments are retained as review events; do not delete or reuse the receive address after any payment is detected.
- Expired unpaid orders remain in an observation window before deletion to catch delayed chain indexing or late payments.
- API keys and wallet secrets must live outside git-tracked files.

## Public Audit Snapshot

This repository is prepared as a public audit snapshot:

- `gateway/`: Node gateway source, example config, local sanctions-list template and smoke scripts.
- `pay/`: Astro frontend source for the dedicated payment/admin/status pages.
- Documentation for API, risk controls, wallet addresses, compliance handling and implementation planning.

Do not publish runtime data, real `config.json`, wallet key files, ledgers, logs, `node_modules` or built frontend assets.

The GitHub target is `jsw-teams/donateto`. A public software license has not been
selected yet; until a license is added, the repository is source-available for
audit, not formally open-source.

## Testing Status

The implementation does not yet have full automated test coverage. Local checks have included `node --check`, Astro `npm run build`, and smoke/manual UI checks. Production use still needs tests for TRON detection, wrong-amount handling, local sanctions matching, admin auth, withdrawal allocation, consolidation callback verification and mobile/accessibility behavior.

## Files

- `README.zh-CN.md`: Chinese version of this overview.
- `SECURITY.md`: publication and operational security notes.
- `IMPLEMENTATION_PLAN.md`: phased implementation plan.
- `API.md`: proposed API surface.
- `RISK_CONTROLS.md`: AML/sanctions/risk workflow.
- `COMPLIANCE_PLAYBOOK.md`: suspicious-funds handling playbook.
- `CONFIG.example.json`: example non-secret config shape.
