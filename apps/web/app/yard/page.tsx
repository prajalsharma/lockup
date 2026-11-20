import type { Metadata } from "next";
import { ChainRounds } from "@/components/chain-rounds";
import { LiveCorridor } from "@/components/live/live-corridor";
import { PROGRAM_ID, explorer } from "@/lib/config";

export const metadata: Metadata = { title: "The yard", description: "Live storage units on Solana devnet. Pick a door, line up, read the clues, seal a bid." };

export default function YardPage() {
  return (
    <div className="wrap pb-28 pt-28 md:pt-36">
      <div className="border-b border-line pb-10">
        <p className="label flex items-center gap-2.5 text-ink-2"><span className="inline-block h-2 w-2 bg-accent" aria-hidden />Live on Solana devnet · bids in devnet USDC</p>
        <h1 className="display mt-4 text-[clamp(64px,9vw,136px)]">The yard</h1>
        <p className="mt-4 max-w-[560px] text-[17px] text-ink-2">These doors are real accounts on Solana. Line up with a deposit, read the clues once the door locks, and seal a bid on MagicBlock's private rollup. Solo units put you against two house bidders that see the same clues you do. Multiplayer units are players only: open one, copy the invite link and bid against someone you know.</p>
      </div>
      <ol className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4" aria-label="How to play">
        {[
          ["Connect a wallet", "A new wallet is sent 1 devnet USDC and a little SOL for fees."],
          ["Pick a door and line up", "Put down a deposit. It is the most you can bid, and everyone can see it."],
          ["Read the clues, seal one bid", "When the door locks, three clues go up. Your bid stays hidden from everyone."],
          ["The highest bid opens it", "Losers get everything back. The winner keeps the items or sells them."],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-4">
            <span className="stencil text-[44px] leading-[0.9] text-ink-3" aria-hidden>{i + 1}</span>
            <span><span className="block text-[17px] font-semibold">{t}</span><span className="mt-1 block text-[15px] text-ink-2">{d}</span></span>
          </li>
        ))}
      </ol>
      <div className="mt-12"><LiveCorridor /></div>

      <section className="mt-28" aria-labelledby="onchain">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
          <h2 id="onchain" className="display text-[clamp(48px,6.4vw,96px)]">Opened units</h2>
          <p className="max-w-[520px] text-[17px] text-ink-2 lg:justify-self-end">
            Every unit that has been opened, read from Solana devnet. Each was stocked by a VRF draw, bid on inside the private rollup and settled by the{" "}
            <a className="ulink ulink-on text-ink" href={explorer(PROGRAM_ID)} target="_blank" rel="noreferrer">Lockup program</a>.
          </p>
        </div>
        <div className="mt-10"><ChainRounds /></div>
      </section>
    </div>
  );
}
