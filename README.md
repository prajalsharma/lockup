# Lockup

Sealed-bid storage units on Solana, built for Solana Blitz v10 on MagicBlock.

Bid on a sealed storage unit with only three clues about what's inside. The highest bid opens it, and
the winner keeps the haul or sells it piece by piece.

Bids and contents stay sealed inside MagicBlock's Private Ephemeral Rollup until every bid is in or the clock runs out,
and MagicBlock VRF decides what each unit holds. After the result commits, MagicBlock pays every bidder on
Solana by Magic Action, about 6 seconds after the commit is sent. A sealed bid, a raise or a lock-in confirms on the rollup in about half a second
(medians of 200 to 700 ms across live rounds, timed in the browser from sending to confirmed; that is two network
trips to devnet, and the unit page shows both the figure for your own moves and what one trip costs). Another
player's move is pushed to your screen over the rollup's websocket: about 0.8 seconds from their click in a
two-browser test.

- **Play:** https://lockup-seven.vercel.app
- **Program (devnet):** [`2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR`](https://explorer.solana.com/address/2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR?cluster=devnet)
- **How it works and what is trusted:** [`docs/CONTRACTS.md`](docs/CONTRACTS.md)

Everything on the site is read from or written to Solana devnet. There is no simulated mode: units, deposits,
bids, results and the items in "My haul" are all on-chain accounts and SPL token balances. Bids are in
Circle's devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`); stakes are cents because the yard
runs on a small float, and each new wallet is sent 1 USDC to start.

## Two ways to play

- **Solo.** Two house bidders are in line on every solo unit, so one person can play a full round.
  The door locks 15 seconds after the first player joins. Other players can join the same unit.
- **Multiplayer.** Players only. The unit waits for a second player, with an invite link to share, and
  locks 25 seconds after the last one joins. If a player waits alone for two minutes, one house bidder
  takes the seat so the round still runs.

The mode is public on chain: multiplayer units are created with a 90-second clock, solo units with 75.
The landing page has an animated map of where each step happens (Solana, MagicBlock VRF, the private
rollup), and every unit's page shows the same map pinned to where that unit is right now.

## Anyone can fill a unit

Units are no longer stocked by the operator alone, and the operator no longer keeps every winning bid.

- **Consign.** A player hands items they hold to the yard (`consign`). They join the warehouse that
  units are drawn from, so MagicBlock VRF still decides which unit each one comes out of.
- **Paid by the program.** When a lot is delivered to a winner, `claim_lot` pays that lot's share of
  the winning bid out of the vault. If a player has that item waiting, the share goes to them. The
  program refuses a claim that skips a waiting consignment, so players' items sell before the yard's own.
- **A price record per item.** One `Pool` account per item holds what it has sold for inside units
  and on the resale market: count, total paid and last price. The Market page reads it.

A sealed bid is how things with no obvious price get one: estate lots, storage units, one-off
collectibles. Lockup is that auction with the vault, resale market and price record behind it. The
twelve items are game tokens standing in for real goods; nothing here is backed by a physical object.

## What makes it a game

- **Twelve finds, three tiers.** Every item has its own drawn tag. Common, rare and grail are drawn with
  different odds, and the collection on My haul fills in as you find them.
- **Yard rank and badges.** Rookie to Yard boss by units opened, with badges such as Steal and By a nose.
  All of it is worked out from a wallet's rounds on chain; nothing is stored for it.
- **A verdict when the door opens.** Steal, Good buy or Burned, from what you paid against what it held.
- **Best pickers.** A leaderboard on the yard page, ranked by how far ahead each wallet is.
- **Look through the keyhole.** During bidding, anyone can ask the private rollup and Solana for another
  bidder's sealed bid and see what comes back.
- **A live table.** A sealed bid can be raised as often as you like until you lock in. Everyone sees who
  raised and when, within half a second, and never how much, so a one-cent raise is a bluff that looks like a
  big one. House bidders answer your moves by a fixed, published rule until they hit their limit, so one that locks in
  early has nothing left. The door opens the moment everyone has locked in.
- **A clue only you can read.** Each player is dealt a fourth true clue inside the private rollup, sealed to their
  wallet. The player next to you gets a different one, and the operator cannot read either.
- **It moves like a game.** You slide a bolt to seal a bid, the sealed bids decode when the door opens,
  your balance rolls as the payout lands, and a slip prints what you put in, paid and got back.

## MagicBlock features used

| Feature | Where |
|---|---|
| VRF | `start_unit` / `draw_callback`: the randomness every unit is stocked from, requested only once the line has locked |
| Private Ephemeral Rollup | sealed bids and the hidden manifest, with per-account read permissions |
| Delegation + commit | the unit moves to the rollup for bidding and back to Solana to settle |
| Magic Actions | `commit_and_settle` schedules one action per bidder with the commit, so MagicBlock pays every refund and the winner's change the moment the unit is back on Solana (`settle_on_commit`) |

After a unit opens, the winner can keep the item tokens or sell them one at a time on the market
(`list_item`, `buy_item`, `cancel_listing`). The yard buys anything priced at half its appraisal or
less and returns it to the warehouse that future units are stocked from.

## Proof of integration

Everything below is on Solana devnet and was produced by this program. The links are from one round
(unit 9 of the live yard) run with `pnpm round`, plus a later four-player round on the live site. Unit 9
predates two changes: the draw is now requested when the line locks, not at creation, and payouts now
arrive by Magic Action.

| Step | What to look for | Link |
|---|---|---|
| VRF request | `request_draw` calls MagicBlock VRF | [tx](https://explorer.solana.com/tx/5bB55wTTJmVCjT8niPuWNnQFDjFt8ByHdfgrBT1eHebe79d3FJDZMTChJAPVHBDWSPSgDg76LaLdm3TxSUCsKGXK?cluster=devnet) |
| VRF callback | the VRF program calls `draw_callback` with the randomness | [tx](https://explorer.solana.com/tx/5ezfrhqwggEpwfULYp3vNLdACRvTC9WEAWNq2En16bVa74NLh3wqgtmNkwx1LBzeu6q7FcmR7b7eL74HaZpQxydL?cluster=devnet) |
| Delegation | `delegate_unit` hands the unit to the private rollup's validator | [tx](https://explorer.solana.com/tx/5c6cDw7JMtJqKj8knNnLqraoYFDktmn3Ru4AZ8R1on6bKYvnGjdN3eyZLVT9aU5MxV8vJwfxPVE8AoE2C9iF7u4M?cluster=devnet) |
| Commit and undelegation | the delegation program returns the closed unit to Solana | [tx](https://explorer.solana.com/tx/9TH4WLsj3f9QLPfQirv88E2kR4GfBUoPJc8F4CYoXaRo2JvWZSrZjcKUUU139iaBaftWsGAvmKT3sL1yq65zDEW?cluster=devnet) |
| The unit | winner, every bid, contents and the published salt | [account](https://explorer.solana.com/address/BKvomWUJgitq3TpYs6CSSs8Qx6GtKNwQ5QDjrY7R8w5e?cluster=devnet) |
| Magic Action payouts | four bidders refunded in one transaction signed by MagicBlock's validator, through the delegation program, with no transaction from the operator | [tx](https://explorer.solana.com/tx/48kNBneVVXZWjBX5ZaJbrdG9ApupUkUNCVA1j9Md41h2tmv4wB9DZXq1HE1wCX3PThVp9Y4HoefidACfQhYYFmbf?cluster=devnet) |
| Resale | `list_item`, then `buy_item` paying the seller | [list](https://explorer.solana.com/tx/65SnKcb5Xxd9fgky4WTdNBriQ9EUoH7iBYc7WBHMEQtJm5aZjQzb8yZXfPZJ75QKEF4mBGHkinF4Jk31FgiC6tv3?cluster=devnet), [buy](https://explorer.solana.com/tx/59Lbysu2ZX6D4cMwU3cR28eu8UYAEz6F9NyzG1qK4R3nWjKWu7GcjgwEhgKJvrwYYKE6BHuusUYag4fLsYEtdSu8?cluster=devnet) |

Addresses for the submission form:

- Program: `2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR`
- Live yard: `FwEiHZfkn53xPn47M2fZbhY8sVJ3J6qmEp8p9f6HxSt4`
- Vault (holds deposits): `5GcpyKvNdBmtpMaCDzbgKqf84E6zD4QNcQNTEV7XyYRs`

As of 22 Nov 2026 the live yard has more than 30 units, and every one that has been played was
delegated to the private rollup, bid on, and committed back to Solana. Bids and the manifest
exist only on the rollup while a round runs, so they do not appear on a Solana explorer; `pnpm round`
checks that another bidder and the operator both fail to read a bid there.

## Run it

```
pnpm install
pnpm dev                 # site on http://localhost:3000
pnpm test:program        # game-rule tests
pnpm round               # one full round on devnet, every step asserted
pnpm market              # list, buy and cancel on devnet, with the refusals checked
pnpm consign             # the seller pool: consign, take back, and the refusals
pnpm attack              # join a live unit and try to cheat it; every attempt must be refused
```

Rounds on the hosted site are moved along by a keeper (`apps/web/lib/chain/keeper.ts`) that runs
whenever someone has the yard open. It needs `KEEPER_SECRET` (a devnet keypair as a JSON array).
Set `NEXT_PUBLIC_PRIVY_APP_ID` to add email and Google sign-in (Privy) to the wallet picker.
`npx tsx scripts/keeper.ts` runs the same loop locally.

## Layout

- `programs/lockup` Anchor program; `src/engine.rs` holds the pure game rules and their tests
- `apps/web` Next.js 15 site: 3D door, live yard, wallet connect (Solana Wallet Adapter), keeper
- `scripts` devnet setup, end-to-end round, resale and seller-pool tests, local keeper
- `docs/screens` screenshots

The delegation, permission and commit patterns follow MagicBlock's sealed-auction example and an
earlier MagicBlock project of mine. Anton is used under the SIL Open Font License. The rolling digits, decoding text,
slide-to-seal bolt and win burst are adapted from [EasyUI](https://github.com/Surajmaurya1/easyui) (MIT, © 2026 Suraj Maurya).
