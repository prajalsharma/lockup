"use client";
import { useChainYard } from "@/components/chain-rounds";
import { usePlayer } from "@/lib/chain/player";
import { explorer } from "@/lib/config";
import { short, usd } from "@/lib/format";

/** Who has come out furthest ahead, worked out from the opened units on chain. */
export function Board() {
  const { data } = useChainYard(15000);
  const p = usePlayer();
  if (!data) return <p className="label py-8 text-ink-3">Reading devnet</p>;
  if (!data.board.length) return <p className="py-8 text-ink-2">Nobody has opened a unit yet. The first name on this board could be yours.</p>;
  return (
    <ol className="border-t border-line">
      {data.board.map((b, i) => {
        const me = b.who === p.address;
        return (
          <li key={b.who} className="grid grid-cols-[52px_1fr_auto] items-center gap-x-4 border-b border-line py-4 md:grid-cols-[72px_1fr_160px_160px]">
            <span className={`stencil text-[40px] leading-none ${i === 0 ? "text-accent-text" : "text-ink-3"}`}>{i + 1}</span>
            <span>
              <a className={`num text-[17px] hover:underline ${me ? "text-accent-text" : ""}`} href={explorer(b.who)} target="_blank" rel="noreferrer">{me ? "You" : short(b.who)}</a>
              <span className="label mt-1 block text-ink-3 md:hidden">{b.opened} opened</span>
            </span>
            <span className="label hidden text-ink-3 md:block">{b.opened} {b.opened === 1 ? "unit" : "units"} opened</span>
            <span className={`display num text-right text-[32px] leading-none ${b.profit >= 0 ? "text-ink" : "text-bad"}`}>{b.profit >= 0 ? "+" : "−"}{usd(Math.abs(b.profit))}</span>
          </li>
        );
      })}
    </ol>
  );
}
