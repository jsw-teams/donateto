# Risk Controls

This is not legal advice. It is an engineering control plan for a personal
developer support flow.

## Core Principle

Receipt on-chain is not the same as accepted support.

The service must separate these states:

- payment seen
- payment confirmed
- payment reviewed
- support accepted
- funds consolidated

Only reviewed and accepted support should trigger thanks or public display.

## Why Not Publish a Permanent Address

A public permanent address can receive funds from anyone at any time. The site
cannot prevent unwanted transfers once the address is known. For that reason,
the first implementation should generate short-lived orders and treat unknown
transfers as unaccepted.

## Screening Inputs

For each detected payment, store:

- order ID
- sender address
- recipient address
- tx hash
- network
- asset
- amount
- detection time
- confirmation/finality state
- screening provider result
- local decision
- reviewer note

## Minimum Automated Checks

- Token contract matches the expected asset.
- Recipient address matches the configured receiving address.
- Amount matches an active order.
- Transaction is final enough for the chosen chain.
- Sender address is not in a local blocklist.
- Sender address passes sanctions screening when API access exists.

## Manual Review Triggers

Mark as `frozen_review` if any of these happen:

- sanctions hit
- known scam or illicit label
- mixer or tumbler exposure
- unusually large amount
- amount does not match any active order
- repeated split payments
- payment from a high-risk jurisdiction indicator
- donor asks for refund to a different address

## Refund Policy

Do not automatically refund suspicious funds. Refunds can become additional
movement of suspicious assets. Keep the payment frozen for manual review.

If a refund is considered, it must be a documented manual decision. The review
should confirm that returning funds is lawful, does not route value to a
sanctioned party, and does not create a new suspicious transaction trail.

## Public Copy

Recommended site copy:

```text
Only lawful-source funds are accepted. Payments that appear suspicious,
sanctioned, or unrelated to an active support order may be held for review and
will not be treated as accepted support.
```

## Binance Consolidation

Binance is the final consolidation account, not the payment processor.

Before sending funds to Binance:

- keep the order and review record
- keep the tx hash and sender address
- only consolidate accepted payments
- avoid sweeping unknown or frozen funds

For the first release, consolidation should be manual.

Never consolidate `frozen_review`, `rejected`, or unknown transfers into Binance.
If funds are later identified as suspicious after consolidation, keep the
records, stop further movement, and seek appropriate guidance before taking any
next action.
