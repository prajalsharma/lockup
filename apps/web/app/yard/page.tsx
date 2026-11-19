import type { Metadata } from "next";
import { ChainRounds } from "@/components/chain-rounds";
import { LiveCorridor } from "@/components/live/live-corridor";
import { Balance, Corridor } from "@/components/yard-corridor";
import { PROGRAM_ID, explorer } from "@/lib/config";

export const metadata: Metadata = { title: "The yard", description: "Six locked units. Pick a door, read the clues, seal a bid." };

export default function YardPage() {
  return (
    <div className="wrap pb-28 pt-28 md:pt-36">
      <div className="border-b border-line pb-10">
        <p className="label flex items-center gap-2.5 text-ink-2"><span className="inline-block h-2 w-2 bg-accent" aria-hidden />Live on Solana devnet · test tokens only</p>
        <h1 className="display mt-4 text-[clamp(64px,9vw,136px)]">The yard</h1>
        <p className="mt-4 max-w-[560px] text-[17px] text-ink-2">These doors are real accounts on Solana. Line up with a deposit, read the clues once the door locks, and seal a bid on MagicBlock's private rollup. Two house bidders play every unit; they see the same three clues you do.</p>
      </div>
      <div className="mt-12"><LiveCorridor /></div>

      <section className="mt-28" aria-labelledby="practice">
        <div className="flex flex-col gap-8 border-b border-line pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="practice" className="display text-[clamp(48px,6.4vw,96px)]">Practice yard</h2>
            <p className="mt-4 max-w-[520px] text-[17px] text-ink-2">Same game, no chain. It runs in your browser against computer rivals, so rounds are instant.</p>
          </div>
          <Balance />
        </div>
        <div className="mt-12"><Corridor /></div>
      </section>

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
