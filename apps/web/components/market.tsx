"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePlayer } from "@/lib/chain/player";
import { HOUSE_BUY_SHARE } from "@/lib/chain/shared";
import type { MarketListing } from "@/lib/chain/types";
import { explorer } from "@/lib/config";
import { usd } from "@/lib/format";

/** Open listings, re-read every few seconds and right after the player does something. */
export function useMarket() {
  const [listings, setListings] = useState<MarketListing[] | null>(null);
  const [failed, setFailed] = useState(false);
  const read = useCallback(() => fetch("/api/market").then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { setListings(j); setFailed(false); }).catch(() => setFailed(true)), []);
  useEffect(() => {
    void read();
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, 8000);
    return () => clearInterval(t);
  }, [read]);
  return { listings, failed, read };
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function MarketView() {
  const p = usePlayer();
  const { listings, failed, read } = useMarket();
  const after = (ok: boolean) => { if (ok) { setTimeout(read, 1500); p.refresh(); } };

  if (!listings) return <p className="label py-16 text-ink-3">{failed ? "Devnet is not answering. Try again in a moment." : "Reading devnet"}</p>;
  if (listings.length === 0) {
    return (
      <div className="py-10">
        <p className="text-[17px] text-ink-2">Nothing is for sale right now. Win a unit, then list what you found from your haul.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/yard" className="btn btn-primary">Enter the yard <span className="arrow" aria-hidden>→</span></Link>
          <Link href="/haul" className="btn btn-ghost">My haul</Link>
        </div>
      </div>
    );
  }
  return (
    <>
      {p.error && <p role="alert" className="mb-4 text-bad">{p.error}</p>}
      <ol className="border-t border-line">
        {listings.map((l) => {
          const mine = l.seller === p.address;
          const off = Math.round((1 - l.price / l.value) * 100);
          return (
            <li key={l.address} className="grid gap-x-10 gap-y-3 border-b border-line py-6 md:grid-cols-[1fr_180px_200px] md:items-center">
              <div>
                <p className={`text-[22px] font-semibold ${l.rarity === 2 ? "text-accent-text" : ""}`}>{l.name}{l.qty > 1 ? ` × ${l.qty}` : ""}</p>
                <p className="mt-1 text-sm text-ink-2">
                  Appraised {usd(l.value)}{l.rarity > 0 ? ` · ${l.rarity === 2 ? "grail" : "rare"}` : ""} · sold by {mine ? "you" : short(l.seller)} · <a className="ulink ulink-on" href={explorer(l.address)} target="_blank" rel="noreferrer">listing on explorer</a>
                </p>
              </div>
              <div>
                <p className="display num text-[40px] leading-none">{usd(l.price)}</p>
                <p className="label num mt-1 text-ink-3">{off > 0 ? `${off}% under appraisal` : off < 0 ? `${-off}% over appraisal` : "at appraisal"}</p>
              </div>
              {mine ? (
                <button type="button" className="btn btn-ghost" disabled={!!p.busy} onClick={() => void p.unlist(l.mint).then(after)}>{p.busy ?? "Take it back"}</button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={!!p.busy} onClick={() => (p.address ? void p.buy(l).then(after) : p.openPicker())}>{p.busy ?? (p.address ? "Buy one" : "Connect to buy")}</button>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-6 max-w-[620px] text-sm text-ink-2">You pay the seller directly in devnet USDC and the item moves to your wallet in the same transaction. The yard buys anything priced at {Math.round(HOUSE_BUY_SHARE * 100)}% of its appraisal or less and puts it back in the warehouse that future units are filled from.</p>
    </>
  );
}
