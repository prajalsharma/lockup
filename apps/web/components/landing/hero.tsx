"use client";
import Link from "next/link";
import { useState } from "react";
import { clueText, useChainYard } from "@/components/chain-rounds";
import { Door } from "@/components/door/door";
import { pad2, usd } from "@/lib/format";
import { Facts } from "./facts";

export function Hero() {
  const [found, setFound] = useState([false, false, false]);
  // The door shows a real unit: the newest one on devnet that has clues posted.
  const { data } = useChainYard(20000);
  const real = data?.units.filter((u) => u.clues.length === 3).sort((a, b) => b.id - a.id)[0] ?? null;
  const clues = real ? real.clues.map(clueText) : [];
  return (
    <section className="relative border-b border-line">
      <div className="grid min-h-[100svh] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
        <div className="flex flex-col justify-end px-5 pb-10 pt-10 md:px-10 lg:pb-14 lg:pt-28 lg:pl-[max(40px,calc((100vw-1320px)/2+40px))]">
          <p className="rise label flex items-center gap-2.5 text-ink-2" style={{ ["--i" as string]: 0 }}>
            <span className="inline-block h-2 w-2 bg-accent" aria-hidden />
            Live on Solana devnet · bids in devnet USDC · no real money
          </p>
          <h1 className="display mt-6 text-[clamp(64px,10.6vw,152px)]">
            <span className="rise block" style={{ ["--i" as string]: 1 }}>Bid blind.</span>
            <span className="rise block" style={{ ["--i" as string]: 2 }}>Open the</span>
            <span className="rise block" style={{ ["--i" as string]: 3 }}><span className="hl">door.</span></span>
          </h1>
          <p className="rise mt-7 max-w-[520px] text-[18px] leading-[1.5] text-ink-2" style={{ ["--i" as string]: 4 }}>
            Every unit holds tokens you can't see. Read three clues, place a bid nobody else can read, and the highest bid rolls the door up.
          </p>
          <div className="rise mt-8 flex flex-wrap gap-3" style={{ ["--i" as string]: 5 }}>
            <Link href="/yard" className="btn btn-primary">Enter the yard <span className="arrow" aria-hidden>→</span></Link>
            <Link href="#how" className="btn btn-ghost">How it works</Link>
          </div>
          <div className="rise mt-12" style={{ ["--i" as string]: 6 }}><Facts /></div>
        </div>
        <div className="relative order-first h-[46svh] border-b border-line lg:order-none lg:h-auto lg:border-b-0 lg:border-l">
          <Door
            className="absolute inset-0 cursor-crosshair"
            key={real?.id ?? 0} unit={real?.id ?? 1} clues={clues} found={found} attract open={false}
            onFound={(i) => setFound((f) => { const n = [...f]; n[i] = true; return n; })}
            label="A locked storage unit lit by a torch. Paper clue tags hang on the door."
          />
          <p className="label absolute bottom-4 left-5 hidden text-[#a9a498] lg:block">
            {real ? <>Real clues from <Link className="ulink" href={`/live/${real.id}`}>unit {pad2(real.id)}</Link>{real.status === "closed" && real.winner ? `, opened for ${usd(real.winningBid)}` : ", bidding now"}</> : "Move the torch over the door"}
          </p>
        </div>
      </div>
    </section>
  );
}
