# Lockup program

Program `2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR` on Solana devnet. Source: `programs/lockup`.
Pins: `anchor-lang 1.0.2`, `ephemeral-rollups-sdk 0.16.2` (features `anchor`, `access-control`, `vrf`).

## A round

1. **Create.** The operator opens a unit and commits to `sha256(salt)`.
2. **Draw.** MagicBlock VRF writes 32 random bytes into the unit (`request_draw` → `draw_callback`).
3. **Line up.** Wallets escrow a deposit on Solana (`join_unit`). The deposit is public and caps the bid.
4. **Lock.** `start_unit` starts the clock; `delegate_unit` hands the unit to the private rollup's validator.
5. **Stock.** Inside the rollup, `stock_unit(salt)` derives the contents from
   `sha256(randomness, salt, unit)`, writes them to a private manifest and posts three clues.
6. **Bid.** `place_bid` + `seal_bid` create a bid only its bidder can read.
7. **Close.** After the clock, `close_unit` reads every bid, picks the highest (ties go to the earlier
   bid) and writes bids, winner, contents and salt into the unit. `commit_unit` returns it to Solana.
8. **Settle.** `settle_bidder` pays the winner `deposit − bid`, sends the winning bid to the operator's
   treasury, and pays everyone else their full deposit.
   `claim_lot` moves each lot from the warehouse to the winner. Both are permissionless.
9. **Stall.** `reclaim_stalled` returns a deposit an hour after joining if the unit has no result on Solana.

## Accounts

| Account | Lives on | Who can read it | Holds |
|---|---|---|---|
| `Yard` | Solana | anyone | authority, bid mint (Circle devnet USDC on the live yard), vault, item catalog (values in cents) |
| warehouse token accounts | Solana | anyone | pooled items for every unit, so balances don't reveal one unit's contents |
| `Unit` | Solana; on the rollup while bidding | anyone | clock, clues, who is in line, then bids, winner, contents, salt |
| `Bidder` | Solana | anyone | one wallet's deposit for one unit |
| `Manifest` | private rollup | operator | the contents, until close |
| `Bid` | private rollup | its bidder only | the amount |

## What is trusted

- The operator knows the salt, so it can compute a unit's contents early. It cannot choose them: the
  commitment is made before the VRF draw. The salt is published at close for anyone to recheck.
- Sealed bids rely on the private rollup (Intel TDX) refusing reads from non-members. `pnpm round`
  checks that another bidder and the operator both fail to read a bid.
- House bidders are run by the keeper and are meant to bid from the public clues only. That is a rule
  in `apps/web/lib/chain/keeper.ts`, not something the chain enforces.

## Checked on devnet

`pnpm round` drives a whole round with two wallets and asserts every step, including the privacy
reads and exact settlement amounts. The hosted site has also been played end to end with the in-browser
quick wallet. Wallet extensions connect through Solana Wallet Adapter. That path has been played end to end on the
hosted site with an injected wallet implementing the Wallet Standard interface (connect, signTransaction,
signMessage); a real Phantom, Solflare or Backpack install has not been driven. Email sign-in through
Privy is live; its login window opens, but a full email login has not been driven by a test.
