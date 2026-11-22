/**
 * The twelve things a unit can hold, drawn as stencil pictograms, and the paper tag they hang on.
 * One drawing per catalog id, so an item looks the same on a door, on the shelf and on the market.
 */
import type { ReactNode } from "react";

const ART: Record<string, ReactNode> = {
  cables: (<><rect x="10" y="30" width="44" height="22" /><path d="M10 38h44" /><path d="M18 30c0-11 9-11 9 0s9 11 9 0 9-11 9 0" /><path d="M45 19v-6m-3 0h6" /></>),
  crt: (<><rect x="9" y="12" width="46" height="34" rx="4" /><rect x="15" y="18" width="25" height="22" rx="3" /><circle cx="47" cy="22" r="2.5" /><circle cx="47" cy="31" r="2.5" /><path d="M44 40h7M18 46l-3 7M46 46l3 7" /></>),
  deck: (<><rect x="7" y="16" width="50" height="32" rx="2" /><rect x="14" y="22" width="36" height="14" rx="2" /><circle cx="24" cy="29" r="3.5" /><circle cx="40" cy="29" r="3.5" /><path d="M14 42h6M24 42h6M34 42h6M44 42h6" /></>),
  vinyl: (<><circle cx="32" cy="32" r="22" /><circle cx="32" cy="32" r="7" /><circle cx="32" cy="32" r="1.4" /><path d="M17 26a17 17 0 0 1 9-9M47 38a17 17 0 0 1-9 9" /></>),
  bike: (<><circle cx="15" cy="42" r="10" /><circle cx="49" cy="42" r="10" /><path d="M15 42l12-19h14l8 19M27 23l9 19H15M41 23l-2-7h7M22 21h9" /></>),
  boards: (<><path d="M9 24q0-6 6-6h34q6 0 6 6t-6 6H15q-6 0-6-6z" /><circle cx="19" cy="35" r="3" /><circle cx="45" cy="35" r="3" /><path d="M13 44q0-5 5-5h28q5 0 5 5t-5 5H18q-5 0-5-5z" /><circle cx="21" cy="53" r="2.5" /><circle cx="43" cy="53" r="2.5" /></>),
  binder: (<><rect x="13" y="9" width="38" height="46" rx="2" /><path d="M21 9v46" /><circle cx="21" cy="19" r="2" /><circle cx="21" cy="32" r="2" /><circle cx="21" cy="45" r="2" /><rect x="28" y="17" width="16" height="22" rx="1.5" /><path d="M32 23l4 5 4-5M32 34h8" /></>),
  jersey: (<><path d="M22 9L9 18l6 11 5-3v29h24V26l5 3 6-11-13-9q-10 8-20 0z" /><path d="M28 30h8l-5 16" /></>),
  synth: (<><rect x="5" y="18" width="54" height="30" rx="2" /><path d="M5 33h54M13 33v15M21 33v15M29 33v15M37 33v15M45 33v15M53 33v15" /><circle cx="14" cy="25.5" r="2.5" /><circle cx="24" cy="25.5" r="2.5" /><circle cx="34" cy="25.5" r="2.5" /><path d="M43 25.5h11" /></>),
  cabinet: (<><path d="M18 7h28v13l5 8v29H13V28l5-8z" /><rect x="22" y="11" width="20" height="9" /><path d="M13 28h38M26 37v-5" /><circle cx="26" cy="31" r="2" /><circle cx="37" cy="34" r="2" /><circle cx="44" cy="34" r="2" /><rect x="28" y="44" width="8" height="7" /></>),
  pinball: (<><path d="M15 55l7-46h20l7 46z" /><circle cx="28" cy="20" r="3" /><circle cx="38" cy="25" r="3" /><circle cx="30" cy="32" r="3" /><path d="M23 44l8 5M41 44l-8 5M15 55v5M49 55v5" /></>),
  bar: (<><path d="M11 46l9-22h24l9 22z" /><path d="M20 24l5-7h14l5 7" /><path d="M24 39h16M27 32h10" /></>),
};

export function ItemArt({ id, className = "" }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ART[id] ?? <rect x="12" y="12" width="40" height="40" />}
    </svg>
  );
}

const TIER = ["Common", "Rare", "Grail"];

/**
 * A warehouse tag: punched hole, pictogram, name, price. Rare tags carry a hazard strip and a
 * grail tag is printed on the accent colour. `found={false}` draws the blank a collection shows
 * for something you haven't turned up yet.
 */
export function ItemTag({ id, name, rarity, line, qty = 1, found = true, className = "" }: { id: string; name: string; rarity: number; line?: string; qty?: number; found?: boolean; className?: string }) {
  const grail = rarity === 2;
  if (!found) {
    return (
      <div className={`relative flex aspect-[3/4] flex-col border border-dashed border-line-2 p-3 text-ink-3 ${className}`}>
        <span className="absolute left-1/2 top-2 h-2 w-2 -translate-x-1/2 rounded-full border border-line-2" aria-hidden />
        <ItemArt id={id} className="mx-auto mt-4 w-[62%] flex-1 opacity-25" />
        <p className="label mt-2">{TIER[rarity]}</p>
        <p className="mt-0.5 text-[14px] leading-tight">Not found yet</p>
      </div>
    );
  }
  return (
    <div className={`relative flex aspect-[3/4] flex-col p-3 text-[#14110a] ${grail ? "bg-[#ffb01f]" : "bg-[#d9c9a3]"} ${className}`}>
      <span className="absolute left-1/2 top-2 h-2 w-2 -translate-x-1/2 rounded-full bg-ground" aria-hidden />
      {rarity === 1 && <span className="hazard absolute inset-x-0 bottom-0 !h-[5px]" aria-hidden />}
      {qty > 1 && <span className="num absolute right-2 top-2 bg-[#14110a] px-1.5 text-[12px] leading-[18px] text-[#efeae0]">×{qty}</span>}
      <ItemArt id={id} className="mx-auto mt-4 w-[62%] flex-1" />
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] opacity-70">{TIER[rarity]}</p>
      <p className="mt-0.5 text-[14px] font-semibold leading-tight">{name}</p>
      {line && <p className="num mt-0.5 text-[12px] opacity-80">{line}</p>}
    </div>
  );
}
