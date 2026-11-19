"use client";
import NumberFlow from "@number-flow/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Door, useReducedMotion } from "@/components/door/door";
import { clock, pad2, usd } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { useNow, useYard, yard } from "@/lib/yard/sim";
import { YOU, type Unit } from "@/lib/yard/types";

function Clues({ unit, found, showAll }: { unit: Unit; found: boolean[]; showAll: () => void }) {
  const n = found.filter(Boolean).length;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="label text-ink-3">Clues on the door</p>
        <p className="label num text-ink-3">{n} / 3 found</p>
      </div>
      <ol className="mt-3 border-t border-line">
        {unit.clues.map((c, i) => (
          <li key={i} className="flex min-h-[52px] items-center gap-4 border-b border-line py-3">
            <span className="label num text-ink-3">0{i + 1}</span>
            {found[i]
              ? <span className="rise text-[17px]">{c.text}</span>
              : <span className="text-ink-3">Hidden. Sweep the torch over the door.</span>}
          </li>
        ))}
      </ol>
      {n < 3 && (
        <button type="button" onClick={showAll} className="ulink ulink-on mt-3 text-sm text-ink-2">Turn the lights on and show all three</button>
      )}
    </div>
  );
}

function BidForm({ unit, balance }: { unit: Unit; balance: number }) {
  const max = Math.max(unit.minBid, Math.min(balance, 600));
  const [amount, setAmount] = useState(unit.minBid);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setAmount(unit.minBid); setError(null); }, [unit.id, unit.round, unit.minBid]);
  const short = balance < unit.minBid;

  const seal = () => {
    const err = yard.placeBid(unit.id, amount);
    setError(err);
    if (!err) sfx.lock();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); seal(); }}>
      <div className="flex items-end justify-between gap-4">
        <label htmlFor={`bid-${unit.id}`} className="label text-ink-3">Your sealed bid</label>
        <span className="label num text-ink-3">Lowest allowed {usd(unit.minBid)}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="display text-[56px] text-ink-3">$</span>
        <input
          id={`bid-${unit.id}`} inputMode="numeric" value={amount}
          onChange={(e) => setAmount(Math.max(0, Math.min(99999, Number(e.target.value.replace(/\D/g, "")) || 0)))}
          className="display num w-full bg-transparent text-[72px] leading-none outline-none"
          aria-describedby={`bid-note-${unit.id}`}
        />
      </div>
      <input type="range" className="bid mt-1" min={unit.minBid} max={max} step={1} value={Math.min(amount, max)} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Bid amount" />
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      {short ? (
        <button type="button" className="btn btn-ghost mt-4 w-full" onClick={() => yard.topUp()}>Get 500 more test dollars</button>
      ) : (
        <button type="submit" className="btn btn-primary mt-4 w-full">Seal my bid <span className="arrow" aria-hidden>→</span></button>
      )}
      <p id={`bid-note-${unit.id}`} className="mt-3 text-sm text-ink-2">
        Others see that you bid. Nobody sees how much. You have <span className="num">{usd(balance)}</span> test dollars.
      </p>
    </form>
  );
}

function Sealed({ unit, left }: { unit: Unit; left: number }) {
  return (
    <div>
      <div className="relative border border-line-2 p-6">
        <p className="label text-ink-3">Your bid, locked in</p>
        <p className="display num mt-2 text-[72px] leading-none">{usd(unit.myBid ?? 0)}</p>
        <span className="stamp display absolute right-5 top-5 border-2 border-accent-text px-3 py-1 text-[22px] text-accent-text">Sealed</span>
      </div>
      <p className="mt-4 text-ink-2">The door opens when the clock hits zero. If you lose, the full bid comes back.</p>
      {left > 6000 && (
        <button type="button" className="btn btn-ghost mt-4 w-full" onClick={() => yard.closeSoon(unit.id)}>Close the round now <span className="label text-ink-3">practice only</span></button>
      )}
    </div>
  );
}

function Result({ unit, shown }: { unit: Unit; shown: boolean }) {
  const r = unit.result!;
  const mine = unit.myBid !== null;
  const won = r.winner === YOU;
  const net = r.value - r.winningBid;
  return (
    <div>
      <p className="label text-ink-3">The bids, opened</p>
      <ol className="mt-3 border-t border-line">
        {r.bids.map((b, i) => (
          <li key={b.who} className="rise flex items-center justify-between border-b border-line py-2.5" style={{ ["--i" as string]: i }}>
            <span className={`num ${b.who === YOU ? "text-accent-text" : "text-ink-2"}`}>{b.who}{i === 0 && <span className="label ml-3 text-ink-3">Highest</span>}</span>
            <span className="num text-[17px]">{usd(b.bid)}</span>
          </li>
        ))}
      </ol>

      {shown && (
        <div className="rise mt-7">
          <p className="display text-[44px] leading-none md:text-[56px]">
            {won ? <>You opened <span className="text-accent-text">unit {pad2(unit.id)}</span></> : mine ? "Outbid" : `Went for ${usd(r.winningBid)}`}
          </p>
          <p className="mt-3 text-ink-2">
            {won ? `You paid ${usd(r.winningBid)} for what was inside.` : mine ? `${usd(unit.myBid!)} is back in your balance. Here is what you missed.` : "Nobody you know. Here is what was inside."}
          </p>
          <ul className="mt-5 border-t border-line">
            {r.contents.map((l) => (
              <li key={l.item.id} className="flex items-center justify-between gap-4 border-b border-line py-2.5">
                <span>{l.qty > 1 && <span className="num text-ink-3">{l.qty} × </span>}{l.item.name}
                  {l.item.rarity !== "common" && <span className={`label ml-3 ${l.item.rarity === "grail" ? "text-accent-text" : "text-ink-3"}`}>{l.item.rarity}</span>}
                </span>
                <span className="num">{usd(l.item.value * l.qty)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between py-3">
              <span className="label text-ink-3">Appraised total</span>
              <span className="num text-[20px]"><NumberFlow value={r.value} format={{ style: "currency", currency: "USD", maximumFractionDigits: 0 }} /></span>
            </li>
          </ul>
          {won && (
            <p className="mt-1 flex items-baseline justify-between border-t border-line-2 pt-4">
              <span className="label text-ink-3">{net >= 0 ? "You came out ahead by" : "You overpaid by"}</span>
              <span className={`display num text-[40px] leading-none ${net >= 0 ? "text-accent-text" : "text-bad"}`}>{usd(Math.abs(net))}</span>
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={() => yard.restock(unit.id)}>Restock this unit</button>
            <Link href={won ? "/haul" : "/yard"} className="btn btn-ghost">{won ? "See my haul" : "Back to the yard"}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function UnitStage({ unitId, heading = "h1" }: { unitId: number; heading?: "h1" | "h2" | "h3" }) {
  const { units, player, ready } = useYard();
  const now = useNow();
  const reduced = useReducedMotion();
  const unit = units.find((u) => u.id === unitId);
  const [found, setFound] = useState([false, false, false]);
  const [shown, setShown] = useState(false);
  const last = useRef<string>("");
  const roundKey = unit ? `${unit.id}:${unit.round}` : "";

  useEffect(() => {
    setFound([false, false, false]);
    setShown(false);
    last.current = "";
  }, [roundKey]);

  const phase = unit?.phase;
  useEffect(() => {
    if (!unit || !phase) return;
    const first = last.current === "";
    const prev = last.current;
    last.current = phase;
    if (phase !== "opened") return;
    if (first || reduced) { setShown(true); setFound([true, true, true]); return; }
    if (prev === "opened") return;
    setFound([true, true, true]);
    sfx.unlock();
    const a = setTimeout(() => sfx.door(2.1), 320);
    const b = setTimeout(() => {
      setShown(true);
      if (unit.myBid !== null) (unit.result?.winner === YOU ? sfx.win : sfx.lose)();
    }, 2700);
    return () => { clearTimeout(a); clearTimeout(b); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, roundKey, reduced]);

  const H = heading;
  if (!ready || !unit) {
    return (
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="brackets aspect-[4/5] bg-[#07080a] lg:aspect-auto lg:min-h-[640px]" />
        <p className="label text-ink-3">Unlocking the practice yard</p>
      </div>
    );
  }

  const left = unit.closesAt - now;
  const onFound = (i: number) => setFound((f) => { if (f[i]) return f; sfx.clue(); const n = [...f]; n[i] = true; return n; });

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
      <div className="brackets">
        <Door
          className="relative aspect-[4/5] w-full cursor-crosshair lg:aspect-auto lg:h-full lg:min-h-[640px]"
          unit={unit.id} paint={unit.paint} clues={unit.clues.map((c) => c.text)}
          found={found} onFound={onFound} open={unit.phase === "opened"}
          contents={unit.result?.contents ?? null}
        />
      </div>

      <div className="flex flex-col">
        <div className="flex items-end justify-between gap-6 border-b border-line pb-5">
          <div>
            <p className="label text-ink-3">Practice yard · round {unit.round}</p>
            <H className="display mt-1 text-[64px] leading-none md:text-[88px]">Unit {pad2(unit.id)}</H>
          </div>
          <div className="text-right">
            <p className="label text-ink-3">{unit.phase === "bidding" ? "Door opens in" : unit.phase === "opening" ? "Opening bids" : "Opened"}</p>
            <p className={`num mt-1 text-[32px] leading-none ${unit.phase === "bidding" && left < 10_000 ? "text-accent-text" : ""}`} aria-live="off">
              {unit.phase === "bidding" ? clock(left) : unit.phase === "opening" ? "00:00" : "—"}
            </p>
            <p className="label num mt-2 text-ink-3">{unit.bidCount} {unit.bidCount === 1 ? "bid" : "bids"} {unit.phase === "opened" ? "opened" : "sealed"}</p>
          </div>
        </div>

        <div className="mt-6 space-y-8">
          {unit.phase !== "opened" && <Clues unit={unit} found={found} showAll={() => setFound([true, true, true])} />}
          {unit.phase === "bidding" && (unit.myBid === null ? <BidForm unit={unit} balance={player.balance} /> : <Sealed unit={unit} left={left} />)}
          {unit.phase === "opening" && (
            <div className="border border-line-2 p-6">
              <p className="display text-[40px] leading-none">Opening the bids</p>
              <p className="mt-2 text-ink-2">Every sealed bid is read at once. The highest one takes the unit.</p>
            </div>
          )}
          {unit.phase === "opened" && <Result unit={unit} shown={shown} />}
        </div>
      </div>
    </div>
  );
}
