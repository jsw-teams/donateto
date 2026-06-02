# Compliance Playbook

This document is an operational plan, not legal advice. The goal is to avoid
treating suspicious crypto transfers as accepted support and to preserve enough
records to make a responsible decision later.

## References Behind This Plan

- OFAC virtual currency guidance: sanctioned or blocked property must not be
  dealt in casually, and blocked-property/reporting duties can apply.
- FATF virtual asset red-flag guidance: risk indicators include transaction
  patterns, anonymity, source-of-funds concerns, and geographic exposure.
- FinCEN guidance for convertible virtual currency: regulated money services
  businesses have AML program and suspicious activity duties. A personal support
  site should not assume it is an MSB, but should avoid designing flows that look
  like money transmission or laundering facilitation.

## Golden Rule

Do not accept, thank, spend, consolidate, swap, or refund suspicious funds until
review is complete.

On-chain receipt is only a technical event. Acceptance is a separate compliance
and operational decision.

Communication rule: always thank the person for the intention to support the
site, even when the payment cannot be accepted yet. The thank-you message must
not imply that suspicious funds were accepted, spent, consolidated, or cleared.

## Status Model

Use these states:

```text
created
detected
confirmed
pending_review
accepted
rejected
frozen_review
expired
consolidated
```

Only `accepted` can become `consolidated`.

`frozen_review` means:

- no public thank-you
- no automatic reply claiming support was accepted
- no Binance consolidation
- no refund automation
- reviewer note is required

## Detection Categories

### Clean Enough to Accept

Conditions:

- active order exists
- amount and asset match
- sender is visible
- no sanctions or local blocklist hit
- no obvious scam/mixer/high-risk label
- amount is within the expected personal-support range

Action:

- mark `accepted`
- send thank-you if donor provided contact details
- optionally show public thanks if donor opted in
- allow later manual Binance consolidation

### Needs Manual Review

Examples:

- unusually high amount
- split payments across many txs
- order mismatch
- donor asks for refund to another address
- sender address has weak or unclear risk signals
- source address is newly created and immediately forwards funds

Action:

- mark `pending_review` or `frozen_review`
- do not thank publicly
- do not consolidate
- request clarification only if contact exists and doing so is safe

### Suspicious or Blocked

Examples:

- sanctions hit
- address appears on local blocklist
- known scam, ransomware, darknet, mixer, exploit, stolen-funds label
- payment appears intentionally unrelated to an order

Action:

- mark `frozen_review`
- preserve records
- do not consolidate
- do not refund automatically
- do not publicly identify the donor
- thank the donor for the support intention, while politely explaining that the
  funds need review and that they may contact `helper@js.gripe` with context
- consult Binance support, qualified counsel, or the relevant authority before
  any further movement when the amount or risk is material

## Records to Preserve

For every suspicious payment, store:

- order ID
- tx hash
- asset and network
- amount
- sender address
- recipient address
- block number or timestamp
- detection timestamp
- screening result and provider
- local rule that triggered review
- reviewer decision and timestamp
- screenshots or exported evidence when available

Keep records for at least several years if practical. Exact retention should be
reviewed for the operator's jurisdiction.

## What Not To Do

- Do not publish a permanent address as the main support method.
- Do not auto-accept every confirmed transfer.
- Do not auto-refund suspicious funds.
- Do not sweep all wallet balances into Binance.
- Do not delete or reuse a receive address after any payment is detected, even if the amount is wrong.
- Do not mix accepted and frozen funds in the same accounting view.
- Do not advertise the flow as anonymous or privacy-enhancing.
- Do not help donors bypass exchange, sanctions, or source-of-funds checks.

## Refund Handling

Refunds are not the default remedy.

If a refund is requested:

1. Confirm the original order and tx.
2. Confirm the requester controls the original sender address when possible.
3. Refuse requests to refund to a different address unless there is a documented,
   lawful reason.
4. Re-screen the refund destination.
5. Keep a reviewer note.
6. Do not refund sanctioned or clearly illicit funds without appropriate advice.

## Binance Consolidation Rules

Before moving funds to Binance:

- review status must be `accepted`
- risk tag must be `legal`
- local OFAC / sanctions exact-match screening must have no hit
- tx hash and sender address must be recorded
- funds must not be part of a suspicious batch
- withdrawal amount must be no greater than the available withdrawable balance
- wallet service must record the consolidation tx hash afterward through the backend callback

If Binance later asks about the source of funds, provide:

- support order record
- donor-provided note, if any
- original tx hash
- sender address
- screening result
- review decision
- consolidation tx hash

## Site Copy

Use clear copy near the payment action:

```text
Only lawful-source funds are accepted. Payments that appear suspicious,
sanctioned, unrelated to an active support order, or inconsistent with this
support purpose may be held for review and will not be treated as accepted
support. Please do not send funds from mixers, compromised accounts, sanctioned
addresses, or third-party funds you are not authorized to use.
```

## First-Version Operating Policy

- Maximum public self-service support amount: 20 USDT.
- Larger payments require manual confirmation before display or consolidation.
- Unknown transfers are frozen by default.
- Wrong-amount transfers are frozen by default and remain attached to the original receive address.
- Expired unpaid orders are retained for a short observation window before deletion to catch delayed blockchain indexing or late payments.
- Binance withdrawal requests are initiated by an admin, but consolidation success is written by the wallet service callback after TRON verification.
- Hot wallet balance should stay low.
- One person can operate the system, but every freeze/accept decision still
  needs a written note.

## Test Coverage Notice

The current implementation has smoke checks and build checks, but no complete automated test suite yet. Treat the system as experimental until automated coverage exists for chain detection, sanctions matching, expiry retention, admin authorization and withdrawal allocation.
