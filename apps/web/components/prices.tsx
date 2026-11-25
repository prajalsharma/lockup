"use client";
import { useEffect, useState } from "react";
import { poolPda } from "@/lib/chain/shared";
import type { PriceRecord } from "@/lib/chain/types";
import { explorer } from "@/lib/config";
import { usd } from "@/lib/format";
import { PublicKey } from "@solana/web3.js";
import { ItemArt } from "./item-art";

export function usePrices() {
  const [prices, setPrices] = useState<PriceRecord[] | null>(null);
  useEffect(() => {
    const read = () => fetch("/api/prices").then((r) => (r.ok ? r.json() : Promise.reject())).then(setPrices).catch(() => undefined);
    void read();
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, 20000);
    return () => clearInterval(t);
  }, []);
  return prices;
}

/** How a price sits against the appraisal, in words. */
function against(price: number, value: number) {
  const pct = Math.round((price / value - 1) * 100);
  return pct === 0 ? "at appraisal" : pct > 0 ? `${pct}% over` : `${-pct}% under`;
}

/**
 * Real prices against the appraisal on one track. The tick in the middle is the appraisal; the
 * filled mark is the average inside units and the outlined mark the average on the market. The
 * track runs from nothing to twice the appraisal.
 */
function Gauge({ value, unit, market }: { value: number; unit: number | null; market: number | null }) {
  const at = (p: number) => `${Math.min(100, Math.max(0, (p / value) * 50))}%`;
  return (
    <div className="relative mt-3 h-3 w-[140px]" aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      <span className="absolute left-1/2 top-0 h-3 w-px bg-ink-3" />
      {market !== null && <span className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 border border-ink bg-ground" style={{ left: at(market) }} />}
      {unit !== null && <span className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 bg-accent-text" style={{ left: at(unit) }} />}
    </div>
  );
}

/**
 * What each item has really gone for. The appraisal is the yard's own number; the other two
 * columns are what people paid, kept by the program in one account per item.
 */
export function PriceBoard() {
  const prices = usePrices();
  if (!prices) return <p className="label py-8 text-ink-3">Reading devnet</p>;
  const traded = prices.some((p) => p.auctionSold || p.marketSold);
  const sold = prices.reduce((n, p) => n + p.auctionSold + p.marketSold, 0);
  const waiting = prices.reduce((n, p) => n + p.consigned, 0);
  return (
    <>
      <dl className="mb-10 grid grid-cols-3 gap-6 border-y border-line py-5">
        <div><dt className="label text-ink-3">Sales on record</dt><dd className="display num mt-1 text-[40px] leading-none">{sold}</dd></div>
        <div><dt className="label text-ink-3">Players' items waiting</dt><dd className="display num mt-1 text-[40px] leading-none">{waiting}</dd></div>
        <div><dt className="label text-ink-3">Accounts on Solana</dt><dd className="display num mt-1 text-[40px] leading-none">{prices.length}</dd></div>
      </dl>
      <div className="hidden border-b border-line-2 pb-2 md:grid md:grid-cols-[1.5fr_0.7fr_1fr_1fr_0.8fr] md:gap-x-8">
        <span className="label text-ink-3">Item</span>
        <span className="label text-ink-3">Appraised</span>
        <span className="label text-ink-3">Inside units</span>
        <span className="label text-ink-3">On the market</span>
        <span className="label text-ink-3">From players</span>
      </div>
      <ul>
        {prices.map((p) => (
          <li key={p.id} className="grid grid-cols-2 gap-x-8 gap-y-3 border-b border-line py-4 md:grid-cols-[1.5fr_0.7fr_1fr_1fr_0.8fr] md:items-center">
            <div className="col-span-2 flex items-center gap-4 md:col-span-1">
              <ItemArt id={p.id} className={`h-10 w-10 shrink-0 ${p.rarity === 2 ? "text-accent-text" : "text-ink-2"}`} />
              <div>
                <a href={explorer(poolPda(new PublicKey(p.mint)).toBase58())} target="_blank" rel="noreferrer" className={`text-[17px] font-semibold hover:underline ${p.rarity === 2 ? "text-accent-text" : ""}`}>{p.name}</a>
                <p className="label mt-0.5 text-ink-3">{p.rarity === 2 ? "Grail" : p.rarity === 1 ? "Rare" : "Common"}</p>
                {(p.auctionAvg !== null || p.marketAvg !== null) && <Gauge value={p.value} unit={p.auctionAvg} market={p.marketAvg} />}
              </div>
            </div>
            <div>
              <p className="label text-ink-3 md:hidden">Appraised</p>
              <p className="num text-[17px]">{usd(p.value)}</p>
            </div>
            <div>
              <p className="label text-ink-3 md:hidden">Inside units</p>
              {p.auctionAvg === null ? <p className="num text-ink-3">no sales yet</p> : (
                <>
                  <p className="num text-[17px]">{usd(p.auctionAvg)} <span className="text-sm text-ink-2">{against(p.auctionAvg, p.value)}</span></p>
                  <p className="label num mt-0.5 text-ink-3">{p.auctionSold} sold · last {usd(p.auctionLast ?? 0)}</p>
                </>
              )}
            </div>
            <div>
              <p className="label text-ink-3 md:hidden">On the market</p>
              {p.marketAvg === null ? <p className="num text-ink-3">no sales yet</p> : (
                <>
                  <p className="num text-[17px]">{usd(p.marketAvg)} <span className="text-sm text-ink-2">{against(p.marketAvg, p.value)}</span></p>
                  <p className="label num mt-0.5 text-ink-3">{p.marketSold} sold · last {usd(p.marketLast ?? 0)}</p>
                </>
              )}
            </div>
            <div>
              <p className="label text-ink-3 md:hidden">From players</p>
              <p className="num text-[17px]">{p.consigned === 0 ? <span className="text-ink-3">none waiting</span> : `${p.consigned} waiting`}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 max-w-[680px] text-sm text-ink-2">
        The appraisal is the yard's own figure. <span className="text-ink">Inside units</span> is each item's share of the sealed bid that won the unit it came out of, averaged over every sale. <span className="text-ink">On the market</span> is what buyers paid at a fixed price. Both are written by the program into one account per item on Solana; each item name links to it. On the small track under a name, the tick is the appraisal, the filled mark is the average inside units and the outlined mark is the average on the market.
        {!traded && " The record starts with the first sale after the seller pool went live."}
      </p>
    </>
  );
}
