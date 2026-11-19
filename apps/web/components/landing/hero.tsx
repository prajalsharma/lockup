"use client";
import Link from "next/link";
import { useState } from "react";
import { Door } from "@/components/door/door";
import { Facts } from "./facts";

const CLUES = ["5 items inside", "A coin slot was spotted", "Worth at least $90"];

export function Hero() {
  const [found, setFound] = useState([false, false, false]);
  return (
    <section className="relative border-b border-line">
      <div className="grid min-h-[100svh] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
        <div className="flex flex-col justify-end px-5 pb-10 pt-10 md:px-10 lg:pb-14 lg:pt-28 lg:pl-[max(40px,calc((100vw-1320px)/2+40px))]">
          <p className="rise label flex items-center gap-2.5 text-ink-2" style={{ ["--i" as string]: 0 }}>
            <span className="inline-block h-2 w-2 bg-accent" aria-hidden />
            Program live on Solana devnet · no real money moves
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
            unit={7} clues={CLUES} found={found} attract open={false}
            onFound={(i) => setFound((f) => { const n = [...f]; n[i] = true; return n; })}
            label="A locked storage unit, number 07, lit by a torch. Three paper clue tags hang on the door."
          />
          <p className="label pointer-events-none absolute bottom-4 left-5 hidden text-[#a9a498] lg:block">Move the torch. Find the clues.</p>
        </div>
      </div>
    </section>
  );
}
