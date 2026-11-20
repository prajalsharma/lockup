# Lockup

Sealed-bid storage units on Solana, built for Solana Blitz v10 on MagicBlock.

Bid on a sealed storage unit with only three clues about what's inside. The highest bid opens it, and
the winner keeps the haul or sells it piece by piece.

Bids and contents stay sealed inside MagicBlock's Private Ephemeral Rollup until the clock runs out,
and MagicBlock VRF decides what each unit holds. A sealed bid confirms on the rollup in about 0.6
seconds (eight bids, 555 to 637 ms, timed from a laptop with the network round trip included).

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

## MagicBlock features used

| Feature | Where |
|---|---|
| VRF | `request_draw` / `draw_callback`: the randomness every unit is stocked from |
| Private Ephemeral Rollup | sealed bids and the hidden manifest, with per-account read permissions |
| Delegation + commit | the unit moves to the rollup for bidding and back to Solana to settle |

After a unit opens, the winner can keep the item tokens or sell them one at a time on the market
(`list_item`, `buy_item`, `cancel_listing`). The yard buys anything priced at half its appraisal or
less and returns it to the warehouse that future units are stocked from.

## Proof of integration

Everything below is on Solana devnet and was produced by this program. The links are from one round
(unit 9 of the live yard) run with `pnpm round`.

| Step | What to look for | Link |
|---|---|---|
| VRF request | `request_draw` calls MagicBlock VRF | [tx](https://explorer.solana.com/tx/5bB55wTTJmVCjT8niPuWNnQFDjFt8ByHdfgrBT1eHebe79d3FJDZMTChJAPVHBDWSPSgDg76LaLdm3TxSUCsKGXK?cluster=devnet) |
| VRF callback | the VRF program calls `draw_callback` with the randomness | [tx](https://explorer.solana.com/tx/5ezfrhqwggEpwfULYp3vNLdACRvTC9WEAWNq2En16bVa74NLh3wqgtmNkwx1LBzeu6q7FcmR7b7eL74HaZpQxydL?cluster=devnet) |
| Delegation | `delegate_unit` hands the unit to the private rollup's validator | [tx](https://explorer.solana.com/tx/5c6cDw7JMtJqKj8knNnLqraoYFDktmn3Ru4AZ8R1on6bKYvnGjdN3eyZLVT9aU5MxV8vJwfxPVE8AoE2C9iF7u4M?cluster=devnet) |
| Commit and undelegation | the delegation program returns the closed unit to Solana | [tx](https://explorer.solana.com/tx/9TH4WLsj3f9QLPfQirv88E2kR4GfBUoPJc8F4CYoXaRo2JvWZSrZjcKUUU139iaBaftWsGAvmKT3sL1yq65zDEW?cluster=devnet) |
| The unit | winner, every bid, contents and the published salt | [account](https://explorer.solana.com/address/BKvomWUJgitq3TpYs6CSSs8Qx6GtKNwQ5QDjrY7R8w5e?cluster=devnet) |
| Resale | `list_item`, then `buy_item` paying the seller | [list](https://explorer.solana.com/tx/65SnKcb5Xxd9fgky4WTdNBriQ9EUoH7iBYc7WBHMEQtJm5aZjQzb8yZXfPZJ75QKEF4mBGHkinF4Jk31FgiC6tv3?cluster=devnet), [buy](https://explorer.solana.com/tx/59Lbysu2ZX6D4cMwU3cR28eu8UYAEz6F9NyzG1qK4R3nWjKWu7GcjgwEhgKJvrwYYKE6BHuusUYag4fLsYEtdSu8?cluster=devnet) |

Addresses for the submission form:

- Program: `2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR`
- Live yard: `FwEiHZfkn53xPn47M2fZbhY8sVJ3J6qmEp8p9f6HxSt4`
- Vault (holds deposits): `5GcpyKvNdBmtpMaCDzbgKqf84E6zD4QNcQNTEV7XyYRs`

As of 20 Nov 2026 the live yard has 12 units, each with its own VRF request, and 9 of them have
been delegated to the private rollup, bid on, and committed back to Solana. Bids and the manifest
exist only on the rollup while a round runs, so they do not appear on a Solana explorer; `pnpm round`
checks that another bidder and the operator both fail to read a bid there.

## Run it

```
pnpm install
pnpm dev                 # site on http://localhost:3000
pnpm test:program        # game-rule tests
pnpm round               # one full round on devnet, every step asserted
pnpm market              # list, buy and cancel on devnet, with the refusals checked
```

Rounds on the hosted site are moved along by a keeper (`apps/web/lib/chain/keeper.ts`) that runs
whenever someone has the yard open. It needs `KEEPER_SECRET` (a devnet keypair as a JSON array).
Set `NEXT_PUBLIC_PRIVY_APP_ID` to add email and Google sign-in (Privy) to the wallet picker.
`npx tsx scripts/keeper.ts` runs the same loop locally.

## Layout

- `programs/lockup` Anchor program; `src/engine.rs` holds the pure game rules and their tests
- `apps/web` Next.js 15 site: 3D door, live yard, wallet connect (Solana Wallet Adapter), keeper
- `scripts` devnet setup, end-to-end round, resale test, local keeper
- `docs/screens` screenshots

The delegation, permission and commit patterns follow MagicBlock's sealed-auction example and an
earlier MagicBlock project of mine. Anton is used under the SIL Open Font License.
