"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePlayer } from "@/lib/chain/player";
import type { Haul } from "@/lib/chain/types";
import { explorer } from "@/lib/config";
import { pad2, usd } from "@/lib/format";
import { RollingUsd } from "@/components/juice";
import { HOUSE_BUY_SHARE, ITEMS } from "@/lib/chain/shared";
import { badges, standing } from "@/lib/rank";
import { ItemArt, ItemTag } from "./item-art";
import { useMarket } from "./market";
import { usePrices } from "./prices";
import { Journey } from "./journey";

export function HaulView() {
  const p = usePlayer();
  const [data, setData] = useState<Haul | null>(null);
  const [failed, setFailed] = useState(false);
  const [selling, setSelling] = useState<string | null>(null);
  const [price, setPrice] = useState(0);
  const [tick, setTick] = useState(0);
  const market = useMarket();
  const prices = usePrices();

  useEffect(() => {
    setData(null); setFailed(false);
    if (!p.address) return;
    let live = true;
    const read = () => fetch(`/api/haul?address=${p.address}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { if (live) { setData(j); setFailed(false); } }).catch(() => { if (live) setFailed(true); });
    void read();
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, 15000);
    return () => { live = false; clearInterval(t); };
  }, [p.address, tick]);

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
  const st = standing(data.rounds);
  const earned = badges(data.rounds);
  // Found = ever pulled out of a unit you opened, or sitting in the wallet now (bought on the market).
  const found = new Set<string>([...wins.flatMap((r) => r.lots.map((l) => l.id)), ...data.items.map((i) => i.id)]);
  const holding = new Map(data.items.map((i) => [i.id, i.qty]));
  const mine = (market.listings ?? []).filter((l) => l.seller === p.address);
  const inYard = data.consigned.filter((c) => c.qty > 0 || c.sold > 0);
  const done = (ok: boolean) => { if (ok) { setSelling(null); setTimeout(() => { setTick((t) => t + 1); void market.read(); }, 1500); } };

  return (
    <>
      <dl className="grid grid-cols-2 gap-y-8 border-b border-line pb-10 md:grid-cols-4">
        <div><dt className="label text-ink-3">Units opened</dt><dd className="display num mt-1 text-[56px] leading-none">{wins.length}<span className="text-ink-3"> / {data.rounds.length}</span></dd></div>
        <div><dt className="label text-ink-3">Paid for them</dt><dd className="mt-1"><RollingUsd from={0} value={paid} className="display num text-[56px]" /></dd></div>
        <div><dt className="label text-ink-3">{net >= 0 ? "Ahead by" : "Down by"}</dt><dd className="mt-1"><RollingUsd from={0} value={Math.abs(net)} className={`display num text-[56px] ${net >= 0 ? "text-accent-text" : "text-bad"}`} /></dd></div>
        <div><dt className="label text-ink-3">Devnet USDC</dt><dd className="mt-1"><RollingUsd from={0} value={data.dollars} className="display num text-[56px]" /></dd></div>
      </dl>

      <section className="grid gap-10 border-b border-line py-10 lg:grid-cols-[0.8fr_1fr]" aria-labelledby="rank">
        <div>
          <p className="label text-ink-3">Yard rank</p>
          <h2 id="rank" className="display mt-1 text-[clamp(48px,6vw,88px)] text-accent-text">{st.rank}</h2>
          <div className="mt-4 h-[6px] w-full max-w-[420px] bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.progress * 100)} aria-label="Progress to the next rank">
            <div className="h-full origin-left bg-accent transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ transform: `scaleX(${st.progress})` }} />
          </div>
          <p className="mt-3 text-ink-2">{st.next ? `Open ${st.toNext} more ${st.toNext === 1 ? "unit" : "units"} to make ${st.next}.` : "Top of the yard."} Rank comes from the units this wallet has opened on chain.</p>
        </div>
        <ul className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3" aria-label="Badges">
          {earned.map((b) => (
            <li key={b.id} className={b.earned ? "" : "text-ink-3"}>
              <p className={`display text-[26px] leading-none ${b.earned ? "text-ink" : ""}`}>{b.name}</p>
              <p className="mt-1.5 text-[14px] text-ink-2">{b.earned ? "Earned." : b.how}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14" aria-labelledby="collection">
        <div className="flex items-baseline justify-between">
          <h2 id="collection" className="display text-[clamp(36px,4vw,56px)]">Collection</h2>
          <p className="label num text-ink-3">{found.size} of {ITEMS.length} found</p>
        </div>
        <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {ITEMS.map((it, i) => (
            <li key={it.id} className="rise" style={{ ["--i" as string]: i * 0.4 }}>
              <ItemTag id={it.id} name={it.name} rarity={it.rarity} qty={holding.get(it.id) ?? 1} found={found.has(it.id)} line={`${usd(it.value / 100)}${found.has(it.id) && !holding.has(it.id) ? " · sold" : ""}`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14" aria-labelledby="shelf">
        <div className="flex items-baseline justify-between">
          <h2 id="shelf" className="display text-[clamp(36px,4vw,56px)]">Keep or sell</h2>
          <p className="label num text-ink-3">Token balances in your wallet · appraised {usd(shelf)}</p>
        </div>
        {data.items.length === 0 ? (
          <p className="mt-4 text-ink-2">No items yet. Win a unit and its contents are sent to this wallet as tokens.</p>
        ) : (
          <ul className="mt-5 border-t border-line">
            {data.items.map((i) => {
              const each = i.value / i.qty;
              const quick = Math.max(0.01, Math.floor(each * HOUSE_BUY_SHARE * 100) / 100);
              const listed = mine.some((l) => l.mint === i.mint);
              const rec = prices?.find((r) => r.id === i.id);
              return (
                <li key={i.id} className="grid gap-x-8 gap-y-3 border-b border-line py-4 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="flex items-center gap-4">
                    <ItemArt id={i.id} className={`h-11 w-11 shrink-0 ${i.rarity === 2 ? "text-accent-text" : "text-ink-2"}`} />
                    <div>
                      <a href={explorer(i.mint)} target="_blank" rel="noreferrer" className={`text-[17px] font-semibold hover:underline ${i.rarity === 2 ? "text-accent-text" : ""}`}>{i.qty > 1 ? `${i.qty} × ` : ""}{i.name}</a>
                      <p className="label num mt-1 text-ink-3">{usd(each)} each{i.rarity > 0 ? ` · ${i.rarity === 2 ? "grail" : "rare"}` : ""}</p>
                    </div>
                  </div>
                  {listed ? (
                    <p className="text-sm text-ink-2">One listing per item. Take the open one back to list again.</p>
                  ) : selling === i.mint ? (
                    <form noValidate className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (price > 0) void p.sell(i.mint, price, 1).then(done); }}>
                      <label htmlFor={`price-${i.id}`} className="label text-ink-3">Price</label>
                      <span className="num text-ink-2">$</span>
                      <input id={`price-${i.id}`} type="number" inputMode="decimal" step="0.01" min="0.01" value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} className="num w-24 border-b border-line-2 bg-transparent py-1 text-[17px] outline-none focus:border-ink" />
                      <button type="submit" className="btn btn-primary btn-sm" disabled={!!p.busy || price <= 0}>{p.busy ?? "List one"}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelling(null)}>Cancel</button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!!p.busy} onClick={() => { setPrice(Number((rec?.marketLast ?? each).toFixed(2))); setSelling(i.mint); }}>Set a price</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!!p.busy} onClick={() => void p.sell(i.mint, quick, 1).then(done)}>Sell one to the yard for {usd(quick)}</button>
                      <button type="button" className="btn btn-primary btn-sm" disabled={!!p.busy} onClick={() => void p.consign(i.mint, 1).then(done)}>Put one in a unit</button>
                    </div>
                  )}
                  {/* What each route has actually paid, so the choice is made on numbers. */}
                  {!listed && selling !== i.mint && (
                    <p className="label num text-ink-3 md:col-span-2 md:pl-[60px]">
                      {rec?.marketLast != null ? `Market: last sold ${usd(rec.marketLast)}` : "Market: no sales yet"}
                      {" · "}Yard: {usd(quick)} now{" · "}
                      {rec?.auctionAvg != null ? <span className="text-ink">In a unit: {usd(rec.auctionAvg)} on average over {rec.auctionSold} sold</span> : "In a unit: a share of the winning bid"}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {p.error && <p role="alert" className="mt-4 text-bad">{p.error}</p>}
        {data.items.length > 0 && <p className="mt-4 max-w-[680px] text-sm text-ink-2">Three ways to sell. <span className="text-ink">Set a price</span> and it goes on the <Link href="/market" className="ulink ulink-on">market</Link>. <span className="text-ink">Sell to the yard</span> for half its appraisal, usually within a minute. Or <span className="text-ink">put it in a unit</span>: it joins the stock that units are filled from, and when it comes out of one you are paid its share of the winning bid.</p>}
      </section>

      {inYard.length > 0 && (
        <section className="mt-14" aria-labelledby="consigned">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="consigned" className="display text-[clamp(36px,4vw,56px)]">In the yard</h2>
            <p className="label num text-ink-3">Earned so far <span className="text-ink">{usd(inYard.reduce((s, c) => s + c.earned, 0))}</span></p>
          </div>
          <ul className="mt-4 border-t border-line">
            {inYard.map((c) => (
              <li key={c.mint} className="grid gap-x-8 gap-y-3 border-b border-line py-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="flex items-center gap-4">
                  <ItemArt id={c.id} className={`h-11 w-11 shrink-0 ${c.rarity === 2 ? "text-accent-text" : "text-ink-2"}`} />
                  <div>
                    <p className={`text-[17px] font-semibold ${c.rarity === 2 ? "text-accent-text" : ""}`}>{c.name}</p>
                    <p className="label num mt-1 text-ink-3">{c.qty} waiting · {c.sold} sold{c.sold > 0 ? ` for ${usd(c.earned)}` : ""} · appraised {usd(c.value)}</p>
                  </div>
                </div>
                {c.qty > 0 && <button type="button" className="btn btn-ghost btn-sm" disabled={!!p.busy} onClick={() => void p.takeBack(c.mint, 1).then(done)}>{p.busy ?? "Take one back"}</button>}
              </li>
            ))}
          </ul>
          <Journey at={inYard.some((c) => c.sold > 0) ? 4 : 1} className="mt-8" />
          <p className="mt-6 max-w-[680px] text-sm text-ink-2">Neither you nor the yard knows which unit an item will land in. Players' items are sold before the yard's own stock, and you can take back anything that hasn't sold.</p>
        </section>
      )}

      {mine.length > 0 && (
        <section className="mt-14" aria-labelledby="forsale">
          <h2 id="forsale" className="display text-[clamp(36px,4vw,56px)]">For sale</h2>
          <ul className="mt-4 border-t border-line">
            {mine.map((l) => (
              <li key={l.address} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
                <p className="text-[17px]">{l.qty > 1 ? `${l.qty} × ` : ""}{l.name} <span className="num text-ink-2">at {usd(l.price)}</span></p>
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!p.busy} onClick={() => void p.unlist(l.mint).then(done)}>{p.busy ?? "Take it back"}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
