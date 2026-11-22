# Lockup program

Program `2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR` on Solana devnet. Source: `programs/lockup`.
Pins: `anchor-lang 1.0.2`, `ephemeral-rollups-sdk 0.16.2` (features `anchor`, `access-control`, `vrf`).

## A round

1. **Create.** The operator opens a unit and commits to `sha256(salt)`. The line is open at once.
   No randomness exists yet.
2. **Line up.** Wallets escrow a deposit on Solana (`join_unit`). The deposit is public and caps the bid.
3. **Lock and draw.** `start_unit` locks the line and, in the same instruction, asks MagicBlock VRF
   for the unit's randomness. `draw_callback` stores it, once, and starts the bidding clock. Because the
   draw is requested only after the lock, nobody can know a unit's contents while people are still
   deciding whether to join. `request_draw` exists only to retry a lost request.
4. **Delegate.** `delegate_unit` hands the unit to MagicBlock's private (TEE) validator, and only to it.
   It refuses a unit that has no draw.
5. **Stock.** Inside the rollup, `stock_unit(salt)` derives the contents from
   `sha256(randomness, salt, unit)`, writes them to a private manifest and posts three clues.
6. **Bid.** `place_bid` + `seal_bid` create a bid only its bidder can read.
7. **Close.** After the clock, `close_unit` reads every bid, picks the highest (ties go to the earlier
   bid) and writes bids, winner, contents and salt into the unit. `commit_unit` returns it to Solana.
8. **Settle.** The commit is sent with `commit_and_settle`, which schedules one Magic Action per bidder.
   When the unit is back on Solana, MagicBlock's validator runs `settle_on_commit` for each of them through
   the delegation program: the winner gets `deposit − bid`, everyone else their full deposit. Fees come from
   the operator's escrow on Solana. The actions are not atomic with the commit, so `settle_bidder` does the
   same payout by hand if one fails; the keeper waits 25 seconds before stepping in.
   `claim_lot` moves each lot from the warehouse to the winner. The winning bid stays in the vault
   until the last lot is delivered, and only then goes to the operator's treasury. All permissionless.
9. **Stall.** `reclaim_stalled` returns a deposit from a unit that has stalled: while the line is still
   open, an hour after joining (the bidder also leaves the line); once locked, an hour after the clock
   ran out with no result on Solana.

## Resale

Item tokens a winner holds can be sold one piece at a time. All three instructions run on Solana.

- `list_item(price, qty)` moves the items into a stall token account owned by the yard and records the
  price. One listing per seller per item.
- `buy_item(qty, max_price)` pays the seller directly in the bid currency and moves the items to the
  buyer in the same instruction. `max_price` protects the buyer from a relist at a higher price. A
  sold-out listing closes and returns its rent to the seller.
- `cancel_listing` returns unsold items and closes the listing.

The keeper also acts as a buyer: it takes any listing priced at half the appraisal or less and sends
the items back to the warehouse that future units are stocked from. That buyer is a rule in the
keeper, paid from the operator's treasury; the chain does not guarantee it.

## Accounts

| Account | Lives on | Who can read it | Holds |
|---|---|---|---|
| `Yard` | Solana | anyone | authority, bid mint (Circle devnet USDC on the live yard), vault, item catalog (values in cents) |
| warehouse token accounts | Solana | anyone | pooled items for every unit, so balances don't reveal one unit's contents |
| `Unit` | Solana; on the rollup while bidding | anyone | clock, clues, who is in line, then bids, winner, contents, salt |
| `Bidder` | Solana | anyone | one wallet's deposit for one unit |
| `Manifest` | private rollup | operator | the contents, until close |
| `Bid` | private rollup | its bidder only | the amount |
| `Listing` + stall | Solana | anyone | seller, item, price each, quantity; the stall holds the items |

## What is trusted

- The operator knows the salt, so once a unit's draw has landed it can compute the contents before the
  door opens. It cannot choose them, and it cannot know them while the line is open, because the draw is
  requested only when the line locks. The salt is published at close for anyone to recheck.
- Sealed bids rely on the private rollup (Intel TDX) refusing reads from non-members. `pnpm round`
  checks that another bidder and the operator both fail to read a bid.
- House bidders are run by the keeper and are meant to bid from the public clues only. That is a rule
  in `apps/web/lib/chain/keeper.ts`, not something the chain enforces.

## Starter funds are rationed on chain

New wallets are sent 1 devnet USDC and a little SOL by the keeper. To stop a script draining that, each
USDC starter transaction also creates one "hour slot" and one "day slot" account at addresses derived
from the current hour and day (10 an hour, 40 a day). Creating an account that already exists fails the
whole transaction, so the cap holds even when many requests arrive at once on different servers.
Starter SOL is capped by counting a marker address's recent transactions (20 an hour, 80 a day).
Checked on the live site: 86 fresh wallets asked in bursts of 40 and exactly the remaining 5 slots of
that hour were paid (the caps were 8 and 24 at the time).

## Security review

The program was reviewed with an AI security agent before submission. What changed as a result:

- A bidder who took a stalled deposit back stayed in line and could still bid with money they no longer
  had at stake. Reclaiming now removes them from the line, or is only possible after bidding is over.
- The operator was paid the winning bid before the items were delivered. It is now paid in the same
  instruction that delivers the last lot.
- The random draw was requested when a unit was created, so the operator could see contents before anyone
  joined and abandon units it did not like. The draw is now requested when the line locks.
- A stray token sent to a listing's stall could stop the seller cancelling or the last item selling.
- `delegate_unit` accepted any validator; it is pinned to MagicBlock's private validator.
- The unused test faucet instruction was removed.

The review also asked whether bid amounts and the salt, which travel as instruction data, can be read
back from the rollup's transaction history. `pnpm round` now checks this: another bidder, the operator
and a caller with no login each get an empty record for someone else's transaction.

Left as they are, and worth knowing: the operator can change who may read a unit's public state on the
rollup; bidder records and units are never closed, so their rent stays locked; rollup accounts are not
closed before a unit returns, so the rent the unit sponsors for them is not recovered.

## Checked on devnet

`pnpm attack` joins a live solo unit as a player and tries 22 ways to cheat it, on Solana and inside the
private rollup: underfunded and double joins, bidding over the deposit, bidding twice, reading other bids
and the contents, closing or restocking the unit, double payouts, and claiming someone else's items.
Every attempt is refused. The rollup does not return a reason for a refusal, so for those the script checks
only that the transaction failed and that the honest bid afterwards still went through.

`pnpm market` lists, buys, cancels and sells out on devnet, and checks that a buy under the asking
price, a buy of more than is listed, payment to the wrong wallet, a second listing of the same item
and a cancel by someone else are all refused.

`pnpm round` drives a whole round with two wallets and asserts every step, including the privacy
reads and exact settlement amounts. The hosted site has also been played end to end with the in-browser
quick wallet. Wallet extensions connect through Solana Wallet Adapter. That path has been played end to end on the
hosted site with an injected wallet implementing the Wallet Standard interface (connect, signTransaction,
signMessage); a real Phantom, Solflare or Backpack install has not been driven. Email sign-in through
Privy is live; its login window opens, but a full email login has not been driven by a test.
