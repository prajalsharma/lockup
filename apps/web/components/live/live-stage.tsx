"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChainFlowLive } from "@/components/chain-flow";
import { clueText, useChainYard } from "@/components/chain-rounds";
import { Door, useReducedMotion } from "@/components/door/door";
import { usePlayer } from "@/lib/chain/player";
import { MULTI_LINE_SECONDS } from "@/lib/chain/shared";
import type { ChainUnit } from "@/lib/chain/types";
import { explorer } from "@/lib/config";
import { clock, pad2, short, usd } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { useNow } from "@/lib/hooks";
import { paintFor } from "./live-corridor";
import { WalletBar } from "./wallet-bar";

function Line({ unit, me }: { unit: ChainUnit; me: string | null }) {
  return (
    <div>
      <p className="label text-ink-3">In line · deposits are public</p>
      <ul className="mt-2 border-t border-line">
        {unit.bids.map((b) => (
          <li key={b.who} className="flex items-center justify-between border-b border-line py-2.5">
            <span className={`num ${b.who === me ? "text-accent-text" : "text-ink-2"}`}>
              {b.who === me ? "You" : short(b.who)}
              {b.house && <span className="label ml-3 text-ink-3">House</span>}
            </span>
            <span className="num text-ink-2">{b.hasBid ? "bid sealed" : `up to ${usd(b.deposit)}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line-2 p-6">
      <p className="display text-[36px] leading-none md:text-[40px]">{title}</p>
      <div className="mt-3 text-ink-2">{children}</div>
    </div>
  );
}

export function LiveStage({ unitId }: { unitId: number }) {
  const { data, failed } = useChainYard(3000);
  const p = usePlayer();
  const now = useNow();
  const reduced = useReducedMotion();
  const unit = data?.units.find((u) => u.id === unitId);
  const [found, setFound] = useState([false, false, false]);
  const [deposit, setDeposit] = useState(1);
  const [amount, setAmount] = useState(0.4);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const prev = useRef<string>("");

  const status = unit?.status;
  useEffect(() => {
    if (!status) return;
    const first = prev.current === "";
    const was = prev.current;
    prev.current = status;
    if (status !== "closed") return;
    setFound([true, true, true]);
    if (first || reduced) { setShown(true); return; }
    if (was === "closed") return;
    sfx.unlock();
    const a = setTimeout(() => sfx.door(2.1), 320);
    const b = setTimeout(() => setShown(true), 2700);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [status, reduced]);

  if (!data) return <p className="label py-24 text-ink-3">{failed ? "Devnet is not answering. Try again in a moment." : "Reading devnet"}</p>;
  if (!unit) {
    return (
      <div className="py-16">
        <p className="display text-[clamp(40px,5vw,72px)]">That unit has moved on</p>
        <p className="mt-4 text-ink-2">It is no longer among the newest units in the yard.</p>
        <Link href="/yard" className="btn btn-primary mt-8">Back to the yard</Link>
      </div>
    );
  }

  const me = p.address;
  const mine = unit.bids.find((b) => b.who === me) ?? null;
  const myBid = p.myBids[unit.id] ?? null;
  const left = unit.closesAt - now;
  const biddingOpen = unit.status === "bidding" && unit.stocked && left > 0;
  const closed = unit.status === "closed";
  const multi = unit.mode === "multi";
  const players = unit.bids.filter((b) => !b.house).length;
  const won = closed && unit.winner === me;
  const clues = unit.clues.map(clueText);
  const lots = closed ? unit.lots : null;
  const onFound = (i: number) => setFound((f) => { if (f[i]) return f; sfx.clue(); const n = [...f]; n[i] = true; return n; });
  const maxBid = mine ? mine.deposit : 0;
  const bidAmt = maxBid > 0 ? Math.min(maxBid, amount) : amount;
  // You can deposit up to what the wallet holds, capped at $5 so one unit can't swallow a balance.
  // A wallet with no USDC yet is sent 1 USDC when it lines up, so plan around that.
  const spendable = p.dollars && p.dollars > 0 ? p.dollars : 1;
  const depositCap = Math.max(unit.minBid, Math.min(5, Math.floor(spendable * 20) / 20));

  let phaseLabel = "Line is open";
  let big = "—";
  if (unit.status === "created") phaseLabel = "Setting up";
  if (unit.status === "bidding") {
    phaseLabel = !unit.stocked ? (unit.onRollup ? "Filling the unit" : "Rolling the dice") : left > 0 ? "Door opens in" : "Opening bids";
    big = unit.stocked ? clock(left) : "—";
  }
  if (closed) phaseLabel = "Opened";

  return (
    <>
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
      <div className="brackets">
        <Door
          className="relative aspect-[4/5] w-full cursor-crosshair lg:aspect-auto lg:h-full lg:min-h-[640px]"
          unit={unit.id} paint={paintFor(unit.id)} clues={clues} found={found} onFound={onFound}
          open={closed} contents={lots}
        />
      </div>

      <div className="flex flex-col">
        <div className="flex items-end justify-between gap-6 border-b border-line pb-5">
          <div>
            <p className="label text-ink-3">Live on Solana devnet · <a className="ulink" href={explorer(unit.address)} target="_blank" rel="noreferrer">{short(unit.address)}</a></p>
            <h1 className="display mt-1 text-[64px] leading-none md:text-[88px]">Unit {pad2(unit.id)}</h1>
          </div>
          <div className="text-right">
            <p className="label text-ink-3">{phaseLabel}</p>
            <p className={`num mt-1 text-[32px] leading-none ${biddingOpen && left < 10_000 ? "text-accent-text" : ""}`}>{big}</p>
            <p className="label num mt-2 text-ink-3">{unit.bidCount} of {unit.bids.length} bids {closed ? "opened" : "sealed"}</p>
          </div>
        </div>

        <div className="mt-6 space-y-8">
          {!closed && <WalletBar />}

          {(unit.status === "created" || unit.status === "open") && (
            <p className="text-[17px] text-ink-2">
              <span className="text-ink">{multi ? "Multiplayer unit." : "Solo unit."}</span>{" "}
              {multi ? `Players only, no house bidders. ${players === 0 ? "Nobody is in line yet." : players === 1 ? "One player is in line." : `${players} players are in line.`}` : "You bid against two house bidders that see the same three clues you do. Other players can join too."}
            </p>
          )}

          {unit.status === "created" && <Step title="Getting ready">This unit is being set up. It takes a few seconds.</Step>}

          {unit.status === "open" && me && !mine && (
            <form noValidate onSubmit={(e) => { e.preventDefault(); void p.join(unit.id, Math.min(depositCap, deposit)).then((ok) => ok && sfx.lock()); }}>
              <div className="flex items-end justify-between gap-4">
                <label htmlFor="deposit" className="label text-ink-3">Your deposit</label>
                <span className="label num text-ink-3">Lowest bid {usd(unit.minBid)}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="display text-[56px] text-ink-3">$</span>
                <input id="deposit" type="number" inputMode="decimal" step="0.05" min={unit.minBid} max={depositCap} value={deposit} onChange={(e) => setDeposit(Math.min(depositCap, Math.max(0, Number(e.target.value) || 0)))} className="display num w-full bg-transparent text-[72px] leading-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
              <input type="range" className="bid mt-1" min={unit.minBid} max={depositCap} step={0.05} value={Math.min(depositCap, Math.max(unit.minBid, deposit))} onChange={(e) => setDeposit(Number(e.target.value))} aria-label="Deposit amount" />
              <button type="submit" className="btn btn-primary mt-4 w-full" disabled={!!p.busy || deposit < unit.minBid}>{p.busy ?? "Get in line"} {!p.busy && <span className="arrow" aria-hidden>→</span>}</button>
              <p className="mt-3 text-sm text-ink-2">The deposit is the most you can bid, and everyone can see it. Your bid stays hidden. Whatever you don't spend comes back. New wallets are sent 1 USDC to start.</p>
            </form>
          )}

          {unit.status === "open" && mine && !multi && (
            <Step title="You're in line">The door locks about 15 seconds after the first player joins. Only then is the unit's random draw made. Then the clues go up and bidding starts.</Step>
          )}
          {unit.status === "open" && mine && multi && (
            <Step title={players < 2 ? "Waiting for another player" : "You're in line"}>
              {players < 2
                ? "Send the link to someone and they can bid against you. If nobody joins within two minutes, a house bidder takes the seat so the round still runs."
                : `${players} players are in. The door locks about ${MULTI_LINE_SECONDS} seconds after the last one joins, so there is still time for more.`}
              <button type="button" className="btn btn-ghost btn-sm mt-4 block" onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}>{copied ? "Link copied" : "Copy invite link"}</button>
            </Step>
          )}

          {unit.status === "bidding" && !unit.stocked && <Step title={unit.onRollup ? "Filling the unit" : "Rolling the dice"}>{unit.onRollup ? "The unit is inside the private rollup and its contents are being worked out. Clues are next." : "The line is locked. MagicBlock VRF is drawing this unit's random number now, after everyone has committed, then the unit moves to the private rollup."}</Step>}

          {unit.status === "bidding" && unit.stocked && (
            <div>
              <div className="flex items-baseline justify-between">
                <p className="label text-ink-3">Clues on the door</p>
                <p className="label num text-ink-3">{found.filter(Boolean).length} / 3 found</p>
              </div>
              <ol className="mt-3 border-t border-line">
                {clues.map((c, i) => (
                  <li key={i} className="flex min-h-[52px] items-center gap-4 border-b border-line py-3">
                    <span className="label num text-ink-3">0{i + 1}</span>
                    {found[i] ? <span className="rise text-[17px]">{c}</span> : <span className="text-ink-3">Hidden. Sweep the torch over the door.</span>}
                  </li>
                ))}
              </ol>
              {found.some((f) => !f) && <button type="button" onClick={() => setFound([true, true, true])} className="ulink ulink-on mt-3 text-sm text-ink-2">Turn the lights on and show all three</button>}
            </div>
          )}

          {biddingOpen && mine && !mine.hasBid && (
            <form noValidate onSubmit={(e) => { e.preventDefault(); void p.bid(unit.id, bidAmt).then((ok) => ok && sfx.lock()); }}>
              <div className="flex items-end justify-between gap-4">
                <label htmlFor="bid" className="label text-ink-3">Your sealed bid</label>
                <span className="label num text-ink-3">{usd(unit.minBid)} to {usd(maxBid)}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="display text-[56px] text-ink-3">$</span>
                <input id="bid" type="number" inputMode="decimal" step="0.05" min={unit.minBid} max={maxBid} value={bidAmt} onChange={(e) => setAmount(Math.min(maxBid, Math.max(0, Number(e.target.value) || 0)))} className="display num w-full bg-transparent text-[72px] leading-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
              </div>
              <input type="range" className="bid mt-1" min={unit.minBid} max={maxBid} step={0.05} value={Math.min(maxBid, Math.max(unit.minBid, amount))} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Bid amount" />
              <button type="submit" className="btn btn-primary mt-4 w-full" disabled={!!p.busy || bidAmt < unit.minBid}>{p.busy ?? "Seal my bid"} {!p.busy && <span className="arrow" aria-hidden>→</span>}</button>
              <p className="mt-3 text-sm text-ink-2">Your bid goes to MagicBlock's private rollup. Nobody else can read it until the door opens.{!p.isQuick && " Your wallet will ask you to sign a message to open the rollup, then to approve the bid."}</p>
            </form>
          )}

          {unit.status === "bidding" && mine?.hasBid && (
            <div className="relative border border-line-2 p-6">
              <p className="label text-ink-3">Your bid, locked in</p>
              <p className="display num mt-2 text-[72px] leading-none">{myBid !== null ? usd(myBid) : "Sealed"}</p>
              <span className="stamp display absolute right-5 top-5 border-2 border-accent-text px-3 py-1 text-[22px] text-accent-text">Sealed</span>
              <p className="mt-3 text-ink-2">{left > 0 ? "The door opens when the clock hits zero." : "Reading every bid at once and sending the result to Solana."}</p>
            </div>
          )}

          {unit.status === "bidding" && unit.stocked && left <= 0 && !mine?.hasBid && <Step title="Opening the bids">Every sealed bid is read at once. The result is on its way to Solana.</Step>}
          {unit.status === "bidding" && !mine && left > 0 && <p className="text-ink-2">This door is already locked, so you can only watch. <Link className="ulink ulink-on text-ink" href="/yard">Pick an open door to play.</Link></p>}
          {unit.status === "bidding" && mine && !mine.hasBid && left <= 0 && unit.stocked && <p className="text-ink-2">You didn't bid in time. Your whole deposit comes back when the unit settles.</p>}

          {p.error && me && <p role="alert" className="text-sm text-bad">{p.error}</p>}

          {!closed && <Line unit={unit} me={me} />}

          {closed && (
            <div>
              <p className="label text-ink-3">The bids, opened</p>
              <ol className="mt-3 border-t border-line">
                {[...unit.bids].sort((a, b) => (b.bid ?? -1) - (a.bid ?? -1)).map((b, i) => (
                  <li key={b.who} className="rise flex items-center justify-between border-b border-line py-2.5" style={{ ["--i" as string]: i }}>
                    <span className={`num ${b.who === me ? "text-accent-text" : "text-ink-2"}`}>
                      {b.who === me ? "You" : short(b.who)}
                      {b.house && <span className="label ml-3 text-ink-3">House</span>}
                      {unit.winner === b.who && <span className="label ml-3 text-ink-3">Highest</span>}
                    </span>
                    <span className="num text-[17px]">{b.bid === null ? "no bid" : usd(b.bid)}</span>
                  </li>
                ))}
              </ol>
              {shown && (
                <div className="rise mt-7">
                  <p className="display text-[44px] leading-none md:text-[56px]">
                    {won ? <>You opened <span className="hl">unit {pad2(unit.id)}</span></> : mine ? (mine.bid === null ? "You sat this one out" : "Outbid") : unit.winner ? `Went for ${usd(unit.winningBid)}` : "Nobody bid"}
                  </p>
                  <p className="mt-3 text-ink-2">
                    {won
                      ? `You paid ${usd(unit.winningBid)}. ${unit.claimed ? "The items are in your wallet and the rest of your deposit is back." : "The items are on their way to your wallet."}`
                      : mine ? "Your whole deposit is on its way back." : "Here is what was inside."}
                  </p>
                  <ul className="mt-5 border-t border-line">
                    {unit.lots.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-4 border-b border-line py-2.5">
                        <span>
                          {l.qty > 1 && <span className="num text-ink-3">{l.qty} × </span>}{l.name}
                          {l.rarity > 0 && <span className={`label ml-3 ${l.rarity === 2 ? "text-accent-text" : "text-ink-3"}`}>{l.rarity === 2 ? "grail" : "rare"}</span>}
                        </span>
                        <span className="num">{usd(l.value)}</span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between py-3"><span className="label text-ink-3">Appraised total</span><span className="num text-[20px]">{usd(unit.value)}</span></li>
                  </ul>
                  {won && (
                    <p className="mt-1 flex items-baseline justify-between border-t border-line-2 pt-4">
                      <span className="label text-ink-3">{unit.value >= unit.winningBid ? "You came out ahead by" : "You overpaid by"}</span>
                      <span className={`display num text-[40px] leading-none ${unit.value >= unit.winningBid ? "text-accent-text" : "text-bad"}`}>{usd(Math.abs(unit.value - unit.winningBid))}</span>
                    </p>
                  )}
                  {won && unit.claimed && <Link href="/haul" className="btn btn-ghost mt-5">Keep or sell what you found <span className="arrow" aria-hidden>→</span></Link>}
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href="/yard" className="btn btn-primary">Pick another door</Link>
                    <a className="btn btn-ghost" href={explorer(unit.address)} target="_blank" rel="noreferrer">See it on the explorer</a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    <ChainFlowLive unit={unit} iBid={!!mine?.hasBid} />
    </>
  );
}
