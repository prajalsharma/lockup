# Lockup

Sealed-bid storage units on Solana, built for Solana Blitz v10 on MagicBlock.

Each unit holds tokens you can't see. Three clues go on the door, bids are sealed inside
MagicBlock's private rollup, and the highest bid rolls the door up.

- **Play:** https://lockup-seven.vercel.app
- **Program (devnet):** [`2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR`](https://explorer.solana.com/address/2iCGfpC87DaSgdS62Fh2TaaEL7MnJeoA5vDBfdjoAAhR?cluster=devnet)
- **How it works and what is trusted:** [`docs/CONTRACTS.md`](docs/CONTRACTS.md)

Everything on the site is read from or written to Solana devnet. There is no simulated mode: units, deposits,
bids, results and the items in "My haul" are all on-chain accounts and SPL token balances. Bids are in
Circle's devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`); stakes are cents because the yard
runs on a small float, and each new wallet is sent 1 USDC to start.

## MagicBlock features used

| Feature | Where |
|---|---|
| VRF | `request_draw` / `draw_callback`: the randomness every unit is stocked from |
| Private Ephemeral Rollup | sealed bids and the hidden manifest, with per-account read permissions |
| Delegation + commit | the unit moves to the rollup for bidding and back to Solana to settle |

## Run it

```
pnpm install
pnpm dev                 # site on http://localhost:3000
pnpm test:program        # game-rule tests
pnpm round               # one full round on devnet, every step asserted
```

Rounds on the hosted site are moved along by a keeper (`apps/web/lib/chain/keeper.ts`) that runs
whenever someone has the yard open. It needs `KEEPER_SECRET` (a devnet keypair as a JSON array).
Set `NEXT_PUBLIC_PRIVY_APP_ID` to add email and Google sign-in (Privy) to the wallet picker.
`npx tsx scripts/keeper.ts` runs the same loop locally.

## Layout

- `programs/lockup` Anchor program; `src/engine.rs` holds the pure game rules and their tests
- `apps/web` Next.js 15 site: 3D door, live yard, wallet connect (Solana Wallet Adapter), keeper
- `scripts` devnet setup, end-to-end round, local keeper
- `docs/screens` screenshots

The delegation, permission and commit patterns follow MagicBlock's sealed-auction example and an
earlier MagicBlock project of mine. Anton is used under the SIL Open Font License.
