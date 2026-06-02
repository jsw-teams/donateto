# Security Notes

This repository is prepared for public audit, but the implementation is still experimental.

Do not commit:

- real `config.json`
- API keys or account-system secrets
- wallet private keys, wallet seed phrases or `wallet-secret.key`
- `orders.json`, `wallets.json` or runtime ledger data
- logs containing email addresses, tx hashes or admin emails
- real Binance deposit addresses unless they are intentionally public

Operational rules:

- A payment with the wrong amount is still a payment event. Keep the order, receive address, sender address and tx hash for review.
- Expired unpaid orders should stay in the observation window before deletion.
- `local-ofac-exact` only performs exact-match screening against the local list. A non-hit does not prove lawful source.
- Do not consolidate to Binance until the order is `accepted`, risk tag is `legal`, and the withdrawal amount is within the withdrawable balance.
- The gateway records withdrawal requests; wallet signing and transfer execution should be handled by a separate wallet service.

Testing status:

- `node --check` and Astro build checks have passed locally.
- Full automated test coverage is not implemented yet.
- Treat production deployment as high risk until tests cover TRON detection, wrong-amount payments, sanctions hits, admin auth, withdrawal allocation and consolidation callbacks.

License:

- A public software license has not been selected yet. Until a license is added, this repository is source-available for audit, not formally open-source.
