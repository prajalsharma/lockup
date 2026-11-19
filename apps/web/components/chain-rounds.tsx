"use client";
import { useEffect, useState } from "react";
import { explorer } from "@/lib/config";
import { pad2, short, usd } from "@/lib/format";
import type { ChainUnit, ChainYard } from "@/lib/chain/types";

const GROUPS = ["Wires and screens in here", "Something that plays music", "Sports gear inside", "A coin slot was spotted", "Something metal and very dense", "A stack of card sleeves"];
export function clueText(c: { kind: number; arg: number }) {
  switch (c.kind) {
    case 0: return `${c.arg} items inside`;
    case 1: return GROUPS[c.arg] ?? "Something unusual inside";
    case 2: return `Worth at least ${usd(c.arg / 100)}`;
    case 3: return c.arg ? "One item is a grail" : "No grail in this one";
    default: return c.arg ? `${c.arg} heavy ${c.arg === 1 ? "item" : "items"} at the back` : "Nothing heavy inside";
  }
}

export function useChainYard(everyMs = 20000) {
  const [data, setData] = useState<ChainYard | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const r = await fetch("/api/chain");
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (live) { setData(j); setFailed(false); }
      } catch { if (live) setFailed(true); }
    };
    void read();
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [everyMs]);
  return { data, failed };
}

function statusLine(u: ChainUnit) {
  if (u.status === "closed") return u.winner ? `Opened for ${usd(u.winningBid)}` : "Closed with no bids";
  if (u.status === "bidding") return u.onRollup ? "Bidding on the private rollup" : "Bidding";
  if (u.status === "open") return "Line is open";
  return "Waiting for the draw";
}

export function ChainRounds() {
  const { data, failed } = useChainYard();
  if (!data) return <p className="label py-10 text-ink-3">{failed ? "Devnet is not answering. Try again in a moment." : "Reading devnet"}</p>;
  const shown = data.units.filter((u) => u.status === "closed");
  if (shown.length === 0) return <p className="py-10 text-ink-2">No unit has been opened in this yard yet. Play one above and it will show up here.</p>;
  return (
    <ol className="border-t border-line">
      {shown.map((u) => {
        const profit = u.value - u.winningBid;
        return (
          <li key={u.id} className="grid gap-x-10 gap-y-5 border-b border-line py-8 lg:grid-cols-[150px_1fr_1fr]">
            <div>
              <p className="stencil text-[72px] text-ink">{pad2(u.id)}</p>
              <p className="mt-3 text-[15px]">{statusLine(u)}</p>
              <a className="ulink ulink-on label num mt-2 inline-block text-ink-3" href={explorer(u.address)} target="_blank" rel="noreferrer">{short(u.address)} on explorer</a>
            </div>
            <div>
              <p className="label text-ink-3">{u.status === "closed" ? "Bids, opened" : "In line (deposits are public)"}</p>
              <ul className="mt-2 border-t border-line">
                {[...u.bids].sort((a, b) => (b.bid ?? 0) - (a.bid ?? 0)).map((b) => (
                  <li key={b.who} className="flex items-center justify-between border-b border-line py-2">
                    <span><a className={`ulink num ${u.winner === b.who ? "text-accent-text" : "text-ink-2"}`} href={explorer(b.who)} target="_blank" rel="noreferrer">{short(b.who)}</a>{b.house && <span className="label ml-3 text-ink-3">House</span>}</span>
                    <span className="num">{u.status === "closed" ? (b.bid === null ? "no bid" : usd(b.bid)) : `deposit ${usd(b.deposit)}`}</span>
                  </li>
                ))}
              </ul>
              {u.clues.length > 0 && <p className="mt-3 text-sm text-ink-2">Clues: {u.clues.map(clueText).join(" · ")}</p>}
            </div>
            <div>
              {u.status === "closed" ? (
                <>
                  <p className="label text-ink-3">What was inside</p>
                  <ul className="mt-2 border-t border-line">
                    {u.lots.map((l) => (
                      <li key={l.name} className="flex items-center justify-between border-b border-line py-2">
                        <span>{l.qty > 1 && <span className="num text-ink-3">{l.qty} × </span>}{l.name}{l.rarity > 0 && <span className={`label ml-3 ${l.rarity === 2 ? "text-accent-text" : "text-ink-3"}`}>{l.rarity === 2 ? "grail" : "rare"}</span>}</span>
                        <span className="num">{usd(l.value)}</span>
                      </li>
                    ))}
                  </ul>
                  {u.winner && (
                    <p className="mt-3 flex items-baseline justify-between">
                      <span className="label text-ink-3">Held {usd(u.value)} · {u.claimed ? "items sent to the winner" : "items waiting to be claimed"}</span>
                      <span className={`display num text-[32px] leading-none ${profit >= 0 ? "text-accent-text" : "text-bad"}`}>{profit >= 0 ? "+" : "−"}{usd(Math.abs(profit))}</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-ink-2">Contents are hidden until the unit closes.</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
