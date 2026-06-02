# Donateto

`donateto` stores the no-Docker donation gateway plan for JS.Gripe / 技诉.

The target is a personal-developer friendly flow:

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

## Current Decision

- Do not use Docker for the first implementation.
- Do not require Binance Merchant or Binance Pay merchant API.
- Do not publish a permanent Binance deposit address as the primary support path.
- Use short-lived donation orders, explicit status tracking, and review before thanks.
- The payment gateway records withdrawal requests; signing and transfer execution belong to a separate wallet service.

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

This directory is prepared as a public audit snapshot:

- `gateway/`: Node gateway source, example config, local sanctions-list template and smoke scripts.
- `pay/`: Astro frontend source for the dedicated payment/admin/status pages.
- Documentation for API, risk controls, wallet addresses, compliance handling and implementation planning.

Do not publish runtime data, real `config.json`, wallet key files, ledgers, logs, `node_modules` or built frontend assets.

The recommended GitHub target is `jsw-teams/donateto`. A public software license has not been selected yet; until a license is added, the repository is source-available for audit, not formally open-source.

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
