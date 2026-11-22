"use client";
import Link from "next/link";
import { useChainYard } from "@/components/chain-rounds";
import { clock, pad2, usd } from "@/lib/format";
import { useNow } from "@/lib/hooks";

const PAINTS = ["#4d5560", "#7a3b2e", "#2f5d62", "#6b5a2a", "#3c4a6b", "#5a3f5c"];
export const paintFor = (id: number) => PAINTS[id % PAINTS.length];

export function LiveCorridor() {
  const { data, failed } = useChainYard(4000);
  const now = useNow(500);
  if (!data) return <p className="label py-16 text-ink-3">{failed ? "Devnet is not answering. Try again in a moment." : "Reading devnet"}</p>;
  const units = [...data.units].filter((u) => u.status !== "closed").concat(data.units.filter((u) => u.status === "closed")).slice(0, 6).sort((a, b) => a.id - b.id);
  if (!units.length) return <p className="py-16 text-ink-2">{data.keeper ? "The first units are being set up. Give it a few seconds." : "No live units right now."}</p>;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 lg:grid-cols-6 lg:gap-x-0">
      {units.map((u, i) => {
        const open = u.status === "closed";
        const left = u.closesAt - now;
        const line =
          u.status === "created" ? "Setting up" :
          u.status === "open" ? (u.mode === "multi" ? `${u.bids.filter((x) => !x.house).length} of 2 players in` : `${u.bids.length} in line · from ${usd(u.minBid)}`) :
          u.status === "bidding" ? (u.stocked && left > 0 ? "Sealed bidding" : "Locked") :
          u.winner ? `Sold · held ${usd(u.value)}` : "Closed, no bids";
        const big = u.status === "open" ? "Open" : u.status === "bidding" && u.stocked && left > 0 ? clock(left) : open && u.winner ? usd(u.winningBid) : "—";
        return (
          <li key={u.id} className="rise" style={{ ["--i" as string]: i }}>
            <Link href={`/live/${u.id}`} className="group block" aria-label={`${u.mode === "multi" ? "Multiplayer" : "Solo"} unit ${pad2(u.id)}, ${line}`}>
              <div className="relative aspect-[3/4] overflow-hidden border-x border-t border-[#30343a] bg-[#1b1c1f] lg:border-l-0 lg:first:border-l">
                <div className="absolute inset-x-[9%] bottom-0 top-[13%] overflow-hidden bg-[#2a241d]">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,180,90,0.35),transparent_75%)]" />
                  {open && (
                    <div className="absolute inset-x-0 bottom-[6%] flex items-end justify-center gap-[5%]">
                      {u.lots.slice(0, 3).map((l) => <span key={l.id} className="block aspect-square w-[24%]" style={{ background: l.rarity === 2 ? "#ffb01f" : l.rarity === 1 ? "#e8dcc0" : "#b39a6b" }} />)}
                    </div>
                  )}
                  <div className="steel absolute inset-0 transition-transform duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] group-hover:-translate-y-[3%] motion-reduce:duration-150" style={{ ["--door" as string]: paintFor(u.id), transform: open ? "translateY(-88%)" : undefined }}>
                    <span className="stencil absolute left-1/2 top-[30%] -translate-x-1/2 text-[clamp(56px,7.4vw,112px)] text-[#efeae0]/85">{pad2(u.id)}</span>
                    <span className="absolute bottom-[5%] left-1/2 h-[5%] w-[9%] -translate-x-1/2 rounded-[2px] bg-[#c9973a]" />
                  </div>
                </div>
                <div className="absolute inset-x-[5%] top-[5%] h-[8%] bg-[#30343a]" />
              </div>
              <div className="hazard !h-[5px]" aria-hidden />
              <div className="px-1 pt-3 lg:px-3">
                <p className="num text-[22px] leading-none">{big}</p>
                <p className="label mt-1.5 text-ink-3">{line}</p>
                <p className={`label mt-1 ${u.mode === "multi" ? "text-accent-text" : "text-ink-2"}`}>{u.mode === "multi" ? "Multiplayer" : "Solo"}</p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
