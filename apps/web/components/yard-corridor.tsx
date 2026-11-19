"use client";
import Link from "next/link";
import { clock, pad2, usd } from "@/lib/format";
import { useNow, useYard, yard } from "@/lib/yard/sim";
import { YOU } from "@/lib/yard/types";

export function Balance() {
  const { player, ready } = useYard();
  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
      <div><p className="label text-ink-3">Test dollars</p><p className="display num mt-1 text-[44px] leading-none">{ready ? usd(player.balance) : "—"}</p></div>
      <div><p className="label text-ink-3">Units opened</p><p className="display num mt-1 text-[44px] leading-none">{player.wins}<span className="text-ink-3"> / {player.rounds}</span></p></div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => yard.topUp()}>Get 500 more</button>
    </div>
  );
}

export function Corridor() {
  const { units, ready } = useYard();
  const now = useNow(500);
  if (!ready) return <p className="label py-24 text-ink-3">Unlocking the practice yard</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 lg:grid-cols-6 lg:gap-x-0">
      {units.map((u, i) => {
        const left = u.closesAt - now;
        const open = u.phase === "opened";
        const won = open && u.result?.winner === YOU;
        return (
          <li key={u.id} className="rise" style={{ ["--i" as string]: i }}>
            <Link href={`/unit/${u.id}`} className="group block" aria-label={`Unit ${pad2(u.id)}, ${open ? "opened" : `closes in ${clock(left)}`}`}>
              {/* Bay: wall, doorway, door */}
              <div className="relative aspect-[3/4] overflow-hidden border-x border-t border-[#30343a] bg-[#1b1c1f] lg:border-l-0 lg:first:border-l">
                <div className="absolute inset-x-[9%] bottom-0 top-[13%] overflow-hidden bg-[#2a241d]">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,180,90,0.35),transparent_75%)]" />
                  {open && (
                    <div className="absolute inset-x-0 bottom-[6%] flex items-end justify-center gap-[5%]">
                      {u.result!.contents.slice(0, 3).map((l) => (
                        <span key={l.item.id} className="block aspect-square w-[24%]" style={{ background: l.item.rarity === "grail" ? "#ffb01f" : l.item.rarity === "rare" ? "#e8dcc0" : "#b39a6b" }} />
                      ))}
                    </div>
                  )}
                  <div
                    className="steel absolute inset-0 transition-transform duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] group-hover:-translate-y-[3%] motion-reduce:duration-150"
                    style={{ ["--door" as string]: u.paint, transform: open ? "translateY(-88%)" : undefined }}
                  >
                    <span className="stencil absolute left-1/2 top-[30%] -translate-x-1/2 text-[clamp(56px,7.4vw,112px)] text-[#efeae0]/85">{pad2(u.id)}</span>
                    <span className="absolute bottom-[5%] left-1/2 h-[5%] w-[9%] -translate-x-1/2 rounded-[2px] bg-[#c9973a]" />
                  </div>
                </div>
                <div className="absolute inset-x-[5%] top-[5%] h-[8%] bg-[#30343a]" />
                {u.myBid !== null && !open && <span className="label absolute left-2 top-2 bg-accent px-1.5 py-0.5 text-on-accent">Your bid is in</span>}
              </div>
              <div className="hazard !h-[5px]" aria-hidden />
              <div className="px-1 pt-3 lg:px-3">
                <p className="num text-[22px] leading-none">{open ? usd(u.result!.winningBid) : u.phase === "opening" ? "00:00" : clock(left)}</p>
                <p className="label mt-1.5 text-ink-3">
                  {open ? (won ? "You opened it" : `Sold · held ${usd(u.result!.value)}`) : u.phase === "opening" ? "Opening bids" : `${u.bidCount} sealed · from ${usd(u.minBid)}`}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
