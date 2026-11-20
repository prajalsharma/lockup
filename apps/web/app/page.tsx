import Link from "next/link";
import { Hero } from "@/components/landing/hero";
import { Story } from "@/components/landing/story";
import { ChainFlowLanding } from "@/components/chain-flow";
import { LiveCorridor } from "@/components/live/live-corridor";
import { MAGICBLOCK, PROGRAM_ID, explorer } from "@/lib/config";

const CHECKS = [
  { name: "Lockup program", address: PROGRAM_ID, proves: "Holds the units, the deposits and the warehouse of items. Every round's bids, contents and salt are written to its accounts when the door opens." },
  { name: "MagicBlock VRF", address: MAGICBLOCK.vrf, proves: "Every random draw comes from this program. A unit's stocking transaction calls it, and the proof is checked on chain." },
  { name: "Permission program", address: MAGICBLOCK.permission, proves: "Decides who can read an account inside the private rollup. A bid is created with one reader: the bidder." },
  { name: "Private rollup validator", address: MAGICBLOCK.teeValidator, proves: "The key a unit is handed to while bidding is open. It runs inside Intel TDX hardware." },
  { name: "Delegation program", address: MAGICBLOCK.delegation, proves: "Owns a unit while it is on the rollup and hands it back to Solana when the round closes." },
];

const TODAY = [
  "Solo units have two house bidders so there is always someone to beat. They are run by us and bid from the three public clues only. That rule is in our code, not enforced by the chain. Multiplayer units have none, unless one player waits alone for two minutes.",
  "Each unit's operator knows a secret salt, so the operator can work out the contents early. The operator can't choose them: the random draw arrives after the salt is locked in, and the salt is published when the unit closes.",
  "Rounds move only while someone has the site open. The keeper that locks, opens and settles units is driven by visits to the yard.",
  "Appraisals are our numbers, not market prices. The yard's own buyer pays half the appraisal and is run by us, and the warehouse was stocked by us with far more of each item than will ever be drawn.",
  "Stakes are small on purpose. The yard runs on about 20 devnet USDC, and new wallets are sent 1 USDC to start, up to 8 wallets an hour and 24 a day. More comes from Circle's faucet.",
];
const ON_CHAIN = [
  "It is devnet only. Bids are in Circle's devnet USDC and items are test tokens. None of it has real value.",
  "Your deposit is public, so people can see the most you could have bid. They can't see the bid.",
  "Sealed bids depend on MagicBlock's private rollup. You are trusting Intel's TDX hardware and MagicBlock's validator.",
  "The operator has to close each round. If that never happens, bidders can take their deposits back an hour after joining and the unit stays shut.",
];

export default function Home() {
  return (
    <>
      <Hero />

      {/* Problem */}
      <section className="border-b border-line">
        <div className="wrap grid gap-10 py-24 md:py-36 lg:grid-cols-[0.4fr_1fr]">
          <p className="label reveal text-ink-3">The problem</p>
          <div className="reveal">
            <p className="display text-[clamp(44px,7.4vw,116px)]">
              Anyone can read any account on Solana. So the last bidder <span className="hl">always wins.</span>
            </p>
            <p className="mt-8 max-w-[560px] text-[17px] text-ink-2">
              Put an auction on chain and every bid shows as it lands, so whoever bids last just adds a dollar. Lockup keeps the bids in a private rollup until the clock runs out.{" "}
              <a className="ulink ulink-on text-ink" href="https://solana.com/docs/core/accounts" target="_blank" rel="noreferrer">Solana docs: accounts are public</a>
            </p>
          </div>
        </div>
      </section>

      <Story />

      {/* Where it happens */}
      <section id="map" className="border-b border-line">
        <div className="wrap py-24 md:py-32">
          <div className="mb-12 grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
            <h2 className="display reveal text-[clamp(48px,7vw,112px)]">Where each step happens</h2>
            <p className="reveal max-w-[520px] text-[17px] text-ink-2 lg:justify-self-end">
              Solana is the base: it holds the money and the final result, in public. MagicBlock VRF supplies the random draw. MagicBlock's private rollup is where the contents and the bids stay hidden until the clock runs out.
            </p>
          </div>
          <ChainFlowLanding />
        </div>
      </section>

      {/* Proof */}
      <section id="check" className="border-b border-line">
        <div className="wrap py-24 md:py-32">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
            <h2 className="display reveal text-[clamp(48px,7vw,112px)]">Check it yourself</h2>
            <p className="reveal max-w-[520px] text-[17px] text-ink-2 lg:justify-self-end">
              These are the programs a round touches on Solana devnet. Open any of them in the explorer and read what they did.
            </p>
          </div>
          <ul className="mt-14 border-t border-line">
            {CHECKS.map((c) => (
              <li key={c.name} className="reveal grid gap-x-10 gap-y-2 border-b border-line py-6 md:grid-cols-[0.6fr_1fr_1.2fr] md:items-baseline">
                <p className="text-[19px] font-semibold">{c.name}</p>
                <p className="num break-all text-[13px]">
                  {c.address
                    ? <a className="ulink ulink-on" href={explorer(c.address)} target="_blank" rel="noreferrer">{c.address}</a>
                    : <span className="text-accent-text">Not deployed yet</span>}
                </p>
                <p className="text-ink-2">{c.proves}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Limits */}
      <section id="limits" className="border-b border-line">
        <div className="wrap grid gap-12 py-24 md:py-32 lg:grid-cols-[1fr_1fr]">
          <div className="reveal">
            <h2 className="display text-[clamp(48px,7vw,112px)]">What it can't do</h2>
            <div className="hazard mt-8 w-40" aria-hidden />
          </div>
          <div className="space-y-12">
            <div className="reveal">
              <p className="label text-ink-3">How we run it</p>
              <ul className="mt-4 border-t border-line">
                {TODAY.map((t) => <li key={t} className="border-b border-line py-4 text-[17px]">{t}</li>)}
              </ul>
            </div>
            <div className="reveal">
              <p className="label text-ink-3">On chain</p>
              <ul className="mt-4 border-t border-line">
                {ON_CHAIN.map((t) => <li key={t} className="border-b border-line py-4 text-[17px]">{t}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Try it */}
      <section id="try" className="border-b border-line">
        <div className="wrap py-24 md:py-32">
          <div className="mb-12 grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
            <h2 className="display reveal text-[clamp(48px,7vw,112px)]">Pick a door</h2>
            <p className="reveal max-w-[520px] text-[17px] text-ink-2 lg:justify-self-end">
              These are the units on Solana devnet right now. Connect a wallet and line up. Solo units put you against two house bidders; multiplayer units are players only, with a link to invite someone. Bids are in Circle's devnet USDC, and new wallets are sent 1 USDC to start. A round takes about two minutes.
            </p>
          </div>
          <LiveCorridor />
        </div>
      </section>

      {/* Closing */}
      <section>
        <div className="hazard" aria-hidden />
        <div className="wrap flex flex-col items-start gap-10 py-28 md:py-40 lg:flex-row lg:items-end lg:justify-between">
          <p className="display reveal text-[clamp(64px,11vw,168px)]">Bid blind.<br />Open the <span className="hl">door.</span></p>
          <div className="reveal flex flex-wrap gap-3 lg:pb-5">
            <Link href="/yard" className="btn btn-primary">Enter the yard <span className="arrow" aria-hidden>→</span></Link>
            <Link href="/haul" className="btn btn-ghost">My haul</Link>
          </div>
        </div>
      </section>
    </>
  );
}
