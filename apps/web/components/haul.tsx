"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePlayer } from "@/lib/chain/player";
import type { Haul } from "@/lib/chain/types";
import { explorer } from "@/lib/config";
import { pad2, usd } from "@/lib/format";

export function HaulView() {
  const p = usePlayer();
  const [data, setData] = useState<Haul | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null); setFailed(false);
    if (!p.address) return;
    let live = true;
    const read = () => fetch(`/api/haul?address=${p.address}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { if (live) { setData(j); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    void read();
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, 15000);
    return () => { live = false; clearInterval(t); };
  }, [p.address]);

  if (!p.ready) return <p className="label py-16 text-ink-3">Checking for a wallet</p>;
  if (!p.address) {
    return (
      <div className="py-16">
        <p className="display text-[clamp(40px,5vw,72px)]">Connect to see your haul</p>
        <p className="mt-4 max-w-[480px] text-[17px] text-ink-2">Your rounds and the items you've won are read from Solana for whichever wallet you connect.</p>
        <button type="button" className="btn btn-primary mt-8" onClick={p.openPicker}>Connect wallet <span className="arrow" aria-hidden>→</span></button>
      </div>
    );
  }
  if (!data) return <p className="label py-16 text-ink-3">{failed ? "Devnet is not answering. Try again in a moment." : "Reading devnet"}</p>;

  const wins = data.rounds.filter((r) => r.won);
  const paid = wins.reduce((s, r) => s + r.winningBid, 0);
  const got = wins.reduce((s, r) => s + r.value, 0);
  const net = got - paid;
  const shelf = data.items.reduce((s, i) => s + i.value, 0);

  return (
    <>
      <dl className="grid grid-cols-2 gap-y-8 border-b border-line pb-10 md:grid-cols-4">
        <div><dt className="label text-ink-3">Units opened</dt><dd className="display num mt-1 text-[56px] leading-none">{wins.length}<span className="text-ink-3"> / {data.rounds.length}</span></dd></div>
        <div><dt className="label text-ink-3">Paid for them</dt><dd className="display num mt-1 text-[56px] leading-none">{usd(paid)}</dd></div>
        <div><dt className="label text-ink-3">{net >= 0 ? "Ahead by" : "Down by"}</dt><dd className={`display num mt-1 text-[56px] leading-none ${net >= 0 ? "text-accent-text" : "text-bad"}`}>{usd(Math.abs(net))}</dd></div>
        <div><dt className="label text-ink-3">Devnet USDC</dt><dd className="display num mt-1 text-[56px] leading-none">{usd(data.dollars)}</dd></div>
      </dl>

      <section className="mt-14" aria-labelledby="shelf">
        <div className="flex items-baseline justify-between">
          <h2 id="shelf" className="display text-[clamp(36px,4vw,56px)]">On your shelf</h2>
          <p className="label num text-ink-3">Token balances in your wallet · appraised {usd(shelf)}</p>
        </div>
        {data.items.length === 0 ? (
          <p className="mt-4 text-ink-2">No items yet. Win a unit and its contents are sent to this wallet as tokens.</p>
        ) : (
          <ul className="mt-5 flex flex-wrap gap-2">
            {data.items.map((i) => (
              <li key={i.id}>
                <a href={explorer(i.mint)} target="_blank" rel="noreferrer" className={`block border px-3 py-2 transition-colors duration-200 hover:border-ink ${i.rarity === 2 ? "border-accent-text text-accent-text" : "border-line-2"}`}>
                  <span className="block text-[15px] font-semibold">{i.qty > 1 ? `${i.qty} × ` : ""}{i.name}</span>
                  <span className="label num text-ink-3">{usd(i.value)}{i.rarity > 0 ? ` · ${i.rarity === 2 ? "grail" : "rare"}` : ""}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-16" aria-labelledby="rounds">
        <h2 id="rounds" className="display text-[clamp(36px,4vw,56px)]">Your rounds</h2>
        {data.rounds.length === 0 ? (
          <div className="mt-4">
            <p className="text-ink-2">This wallet hasn't lined up for a unit yet.</p>
            <Link href="/yard" className="btn btn-primary mt-6">Enter the yard <span className="arrow" aria-hidden>→</span></Link>
          </div>
        ) : (
          <ol className="mt-4 border-t border-line">
            {data.rounds.map((r) => {
              const n = r.value - r.winningBid;
              const line = r.status !== "closed" ? "In progress" : r.won ? `You opened it for ${usd(r.winningBid)}` : r.bid === null ? "You didn't bid" : `Outbid: yours ${usd(r.bid)}, winner ${usd(r.winningBid)}`;
              return (
                <li key={r.address} className="grid gap-x-10 gap-y-3 border-b border-line py-6 md:grid-cols-[130px_1fr_200px] md:items-center">
                  <Link href={`/live/${r.unit}`} className="stencil text-[56px] text-ink">{pad2(r.unit)}</Link>
                  <div>
                    <p className="text-[17px]">{line}</p>
                    <p className="mt-1 text-sm text-ink-2">
                      Deposit {usd(r.deposit)} · {r.status !== "closed" ? "held in the vault" : r.settled ? (r.won ? `${usd(r.deposit - r.winningBid)} returned` : "returned in full") : "refund on its way"}
                      {r.won && r.lots.length > 0 && <> · {r.lots.map((l) => `${l.qty > 1 ? `${l.qty} × ` : ""}${l.name}`).join(", ")}</>}
                    </p>
                    <a className="ulink ulink-on label num mt-2 inline-block text-ink-3" href={explorer(r.address)} target="_blank" rel="noreferrer">Unit account on explorer</a>
                  </div>
                  {r.won && <p className={`display num text-[40px] leading-none md:text-right ${n >= 0 ? "text-accent-text" : "text-bad"}`}>{n >= 0 ? "+" : "−"}{usd(Math.abs(n))}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}
