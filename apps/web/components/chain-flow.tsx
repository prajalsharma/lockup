"use client";
import { useEffect, useRef, useState } from "react";
import { useChainYard } from "@/components/chain-rounds";
import type { ChainUnit } from "@/lib/chain/types";

/**
 * A unit's journey drawn as a map: Solana along the bottom, MagicBlock's private rollup above
 * it, MagicBlock VRF feeding in from the side. The same drawing is used two ways: on the
 * landing page it plays through every step, and on a unit's page it is pinned to where that
 * unit really is on chain.
 */
export const FLOW = [
  { where: "Solana", title: "A unit is created", body: "It starts as an account on Solana. Before anything is drawn, we lock in a secret number we can't change later.", you: null },
  { where: "MagicBlock VRF → Solana", title: "MagicBlock VRF rolls the dice", body: "MagicBlock VRF sends 32 random bytes to the unit on Solana. Nobody picked them, and anyone can check where they came from.", you: null },
  { where: "Solana", title: "You line up", body: "You put down a deposit in USDC. It sits in a vault on Solana where everyone can see it, and it is the most you can bid.", you: "Press Get in line." },
  { where: "Solana → private rollup", title: "The door locks", body: "Solana hands the unit to MagicBlock's private rollup. From here on, what gets written about it can't be read from outside.", you: null },
  { where: "Private rollup", title: "The unit is filled", body: "Inside the rollup, the random bytes and our secret number decide what the unit holds. Three true clues go up on the door.", you: "Read the clues." },
  { where: "Private rollup", title: "You seal a bid", body: "Your bid is written inside the rollup in about half a second. Others can see that you bid. Only you can see how much.", you: "Pick a number and press Seal my bid." },
  { where: "Private rollup → Solana", title: "The clock runs out", body: "Every bid is opened at the same moment and the highest one wins. The rollup sends the result back to Solana.", you: null },
  { where: "Solana", title: "Everyone is paid", body: "On Solana, the winner gets the items and their change, and everyone else gets their whole deposit back. Keep the items or sell them.", you: "Keep what you found or sell it." },
] as const;

const WIDE = { W: 1000, H: 430, sol: 330, roll: 168, xs: [90, 230, 370, 510, 603, 696, 790, 925], box: [440, 44, 432, 196], vrf: [230, 92], vw: 172, f: 13, cw: 46, name: "MAGICBLOCK PRIVATE ROLLUP", note: "sealed from outside", sub: "the base chain · public · holds the money and the final result" };
const NARROW = { W: 420, H: 440, sol: 336, roll: 170, xs: [30, 88, 146, 210, 254, 298, 342, 396], box: [182, 44, 206, 198], vrf: [88, 92], vw: 150, f: 15, cw: 42, name: "PRIVATE ROLLUP", note: "", sub: "public · holds the money" };

const HEX = "0123456789abcdef";
const noise = () => Array.from({ length: 4 }, () => HEX[Math.floor(Math.random() * 16)] + HEX[Math.floor(Math.random() * 16)]).join(" ");

export function ChainFlow({ step, draw, unit }: { step: number; draw?: string | null; unit?: number | null }) {
  const [narrow, setNarrow] = useState(false);
  const [bytes, setBytes] = useState("•• •• •• ••");
  useEffect(() => {
    const m = window.matchMedia("(max-width: 720px)");
    const f = () => setNarrow(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  // While the draw is happening the bytes spin; once it has landed they hold still.
  const real = draw ? draw.match(/../g)!.slice(0, 4).join(" ") : null;
  useEffect(() => {
    if (step !== 1) { setBytes(step > 1 ? real ?? "a3 9f 1c 07" : "•• •• •• ••"); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setBytes(real ?? "a3 9f 1c 07"); return; }
    const t = setInterval(() => setBytes(noise()), 90);
    const stop = setTimeout(() => { clearInterval(t); setBytes(real ?? noise()); }, 1500);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [step, real]);

  const L = narrow ? NARROW : WIDE;
  const at = (i: number) => ({ x: L.xs[i], y: i >= 3 && i <= 6 ? L.roll : L.sol });
  const pos = at(step);
  const [bx, by, bw, bh] = L.box;
  const [vx, vy] = L.vrf;
  const route = `M${L.xs[0]},${L.sol} L${L.xs[2]},${L.sol} L${L.xs[3]},${L.roll} L${L.xs[6]},${L.roll} L${L.xs[7]},${L.sol}`;
  // Share of the route already travelled, by segment length, so the trail keeps pace with the unit.
  const seg = (a: number, b: number) => Math.hypot(at(b).x - at(a).x, at(b).y - at(a).y);
  const lens = [0, 1, 2, 3, 4, 5, 6].map((i) => seg(i, i + 1));
  const total = lens.reduce((s, v) => s + v, 0);
  const done = lens.slice(0, step).reduce((s, v) => s + v, 0) / total;
  const inside = step >= 3 && step <= 6;
  const open = step === 7;
  const T = "flow-t";
  const chips = ["$0.40", "$0.95", "$0.43"];
  const cw = L.cw;
  // Keep the row of bids inside the rollup box at the last stop.
  const chipShift = Math.min(0, bx + bw - 8 - (pos.x + cw * 1.5 + 4));

  return (
    <svg viewBox={`0 0 ${L.W} ${L.H}`} className="block h-auto w-full" role="img" aria-label={`Step ${step + 1} of ${FLOW.length}: ${FLOW[step].title}. ${FLOW[step].where}.`} style={{ fontFamily: "var(--font-mono)" }}>
      {/* Private rollup */}
      <rect x={bx} y={by} width={bw} height={bh} rx="8" className={T} fill="var(--ground-2)" stroke="var(--accent-text)" strokeWidth="1.5" strokeDasharray="6 6" opacity={inside ? 1 : 0.55} />
      <g transform={`translate(${bx + 14},${by + bh - 16})`} fill="var(--accent-text)">
        <path d="M2.5 -6v-3a4 4 0 0 1 8 0v3" fill="none" stroke="var(--accent-text)" strokeWidth="1.6" />
        <rect x="0" y="-6" width="13" height="10" rx="1.5" />
        <text x="22" y="3" fontSize={narrow ? L.f - 1 : L.f} letterSpacing="0.06em">{L.name}</text>
      </g>
      {L.note && <text x={bx + bw - 14} y={by + bh - 13} fontSize={L.f - 2} textAnchor="end" fill="var(--ink-3)" opacity={inside ? 1 : 0} className={T}>{L.note}</text>}

      {/* Solana */}
      <line x1="0" y1={L.sol + 34} x2={L.W} y2={L.sol + 34} stroke="var(--line-2)" strokeWidth="1.5" />
      <line x1="0" y1={L.sol + 34} x2={L.W} y2={L.sol + 34} stroke="var(--ink-3)" strokeWidth="5" strokeDasharray="2 38" className="flow-blocks" />
      <text x="14" y={L.sol + 62} fontSize={L.f} letterSpacing="0.08em" fill="var(--ink)">SOLANA</text>
      <text x={narrow ? 98 : 84} y={L.sol + 62} fontSize={L.f - 2} fill="var(--ink-3)">{L.sub}</text>

      {/* MagicBlock VRF */}
      <line x1={vx} y1={vy + 26} x2={vx} y2={L.sol - 56} stroke={step === 1 ? "var(--accent-text)" : "var(--line-2)"} strokeWidth="1.5" strokeDasharray="3 7" className={step === 1 ? "flow-fall" : ""} />
      <rect x={vx - L.vw / 2} y={vy - 30} width={L.vw} height="56" rx="8" className={T} fill="var(--ground)" stroke={step === 1 ? "var(--accent-text)" : "var(--line-2)"} strokeWidth="1.5" />
      <text x={vx} y={vy - 8} fontSize={L.f - 1} letterSpacing="0.08em" textAnchor="middle" fill={step === 1 ? "var(--accent-text)" : "var(--ink-2)"}>MAGICBLOCK VRF</text>
      <text x={vx} y={vy + 14} fontSize={L.f + 1} textAnchor="middle" fill={step >= 1 ? "var(--ink)" : "var(--ink-3)"}>{bytes}</text>

      {/* The route, and how far along it the unit is */}
      <path d={route} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
      <path d={route} fill="none" stroke="var(--accent-text)" strokeWidth="2.5" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - done} className="flow-trail" />
      {L.xs.map((x, i) => (
        <g key={i} transform={`translate(${x},${at(i).y})`}>
          <circle r="5" className={T} fill={i <= step ? "var(--accent-text)" : "var(--ground)"} stroke={i <= step ? "var(--accent-text)" : "var(--line-2)"} strokeWidth="1.5" />
          <text y={i >= 3 && i <= 6 ? 24 : 22} fontSize={L.f - 2} textAnchor="middle" fill={i === step ? "var(--ink)" : "var(--ink-3)"}>{i + 1}</text>
        </g>
      ))}

      {/* What rides along with the unit at each stop */}
      <g className="flow-move" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
        {/* deposits waiting in the vault */}
        <g className={T} opacity={step === 2 ? 1 : 0}>
          {[0, 1, 2].map((i) => <circle key={i} cx={30 + i * 13} cy={-12} r="5.5" fill="var(--accent)" stroke="var(--ground)" strokeWidth="1.5" />)}
          <text x="30" y="-26" fontSize={L.f - 2} fill="var(--ink-2)">deposits</text>
        </g>
        {/* clues */}
        <g className={T} opacity={step === 4 ? 1 : 0} style={{ transform: step === 4 ? "none" : "translateY(6px)" }}>
          {[-1, 0, 1].map((i) => <rect key={i} x={i * 30 - 12} y={-84 + Math.abs(i) * 3} width="24" height="15" fill="#d9c9a3" transform={`rotate(${i * 4} ${i * 30} -76)`} />)}
        </g>
        {/* bids: sealed, then opened */}
        <g className={T} opacity={step === 5 || step === 6 ? 1 : 0} style={{ transform: step >= 5 ? `translateX(${chipShift}px)` : "translateY(-8px)" }}>
          {chips.map((c, i) => {
            const top = step === 6 && i === 1;
            return (
              <g key={c} transform={`translate(${(i - 1) * (cw + 4) - cw / 2},-88)`}>
                <rect width={cw} height="20" rx="3" fill={top ? "var(--accent)" : "var(--ground)"} stroke={top ? "var(--accent)" : "var(--line-2)"} strokeWidth="1.2" />
                <text x={cw / 2} y="14" fontSize={L.f - 2} textAnchor="middle" fill={top ? "var(--on-accent)" : "var(--ink)"}>{step === 6 ? c : "••••"}</text>
              </g>
            );
          })}
        </g>
        {/* payout */}
        <g className={T} opacity={open ? 1 : 0}>
          <text x="-40" y="-30" fontSize={L.f - 2} textAnchor="end" fill="var(--ink-2)">deposits → back</text>
          <text x="-40" y="-12" fontSize={L.f - 2} textAnchor="end" fill="var(--accent-text)">items → winner</text>
        </g>
        {/* the unit itself: a roll-up door */}
        <g transform="translate(-19,-50)">
          <rect width="38" height="46" fill="#2a241d" stroke="var(--line-2)" strokeWidth="1" />
          {[0, 1].map((i) => <rect key={i} x={6 + i * 15} y="29" width="11" height="13" fill={open ? "var(--accent)" : "#b39a6b"} className={T} />)}
          <g className="flow-door" style={{ transform: open ? "scaleY(0.14)" : "none" }}>
            <rect width="38" height="46" fill="#4d5560" />
            {[8, 16, 24, 32, 40].map((y) => <line key={y} x1="0" x2="38" y1={y} y2={y} stroke="#39404a" strokeWidth="1.5" />)}
          </g>
          {unit != null && !open && <text x="19" y="29" fontSize="15" textAnchor="middle" fill="#efeae0" style={{ fontFamily: "var(--font-display)" }}>{String(unit).padStart(2, "0")}</text>}
        </g>
      </g>
    </svg>
  );
}

/** The landing-page version: plays through every step, and lets you step through it yourself. */
export function ChainFlowSection({ draw, unit }: { draw?: string | null; unit?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing || !seen) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % FLOW.length), step === FLOW.length - 1 ? 4200 : 3200);
    return () => clearTimeout(t);
  }, [playing, seen, step]);

  const s = FLOW[step];
  const pick = (i: number) => { setPlaying(false); setStep(i); };

  return (
    <div ref={ref}>
      <div className="brackets bg-ground-2/40 px-2 py-6 md:px-8 md:py-8"><ChainFlow step={step} draw={draw} unit={unit} /></div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
        <div aria-live="polite" className="min-h-[230px]">
          <p className="label num text-ink-3"><span className="text-ink">{String(step + 1).padStart(2, "0")}</span> / {String(FLOW.length).padStart(2, "0")} · happens on <span className="text-accent-text">{s.where}</span></p>
          <h3 key={step} className="display rise mt-3 text-[clamp(36px,4.6vw,68px)]">{s.title}</h3>
          <p className="mt-4 max-w-[540px] text-[17px] text-ink-2">{s.body}</p>
          {s.you && <p className="mt-4 text-[17px]"><span className="label mr-3 text-ink-3">Your move</span>{s.you}</p>}
        </div>
        <div>
          <ol className="border-t border-line">
            {FLOW.map((f, i) => (
              <li key={f.title} className="border-b border-line">
                <button type="button" onClick={() => pick(i)} aria-current={i === step ? "step" : undefined}
                  className={`flex w-full items-baseline gap-4 py-2.5 text-left transition-colors duration-200 ${i === step ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                  <span className={`num text-[13px] ${i === step ? "text-accent-text" : ""}`}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 text-[16px]">{f.title}</span>
                  <span className="label hidden text-ink-3 sm:inline">{f.where}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-ghost btn-sm mt-5" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play it through"}</button>
        </div>
      </div>
    </div>
  );
}

/** Landing page: the map, playing with the random bytes of the newest unit drawn on devnet. */
export function ChainFlowLanding() {
  const { data } = useChainYard(30000);
  const latest = data?.units.filter((u) => u.draw).sort((a, b) => b.id - a.id)[0] ?? null;
  return (
    <>
      <ChainFlowSection draw={latest?.draw} unit={latest?.id} />
      {latest && <p className="label num mt-8 text-ink-3">The bytes in the VRF box are the first four of unit {String(latest.id).padStart(2, "0")}'s real draw on devnet</p>}
    </>
  );
}

/** Which stop a real unit is at, from what the chain says about it. */
export function flowStep(u: ChainUnit, iBid: boolean): number {
  if (u.status === "created") return u.draw ? 1 : 0;
  if (u.status === "open") return 2;
  if (u.status === "bidding") return !u.stocked ? 3 : iBid || u.bidCount === u.bids.length ? 5 : 4;
  return u.claimed || !u.winner ? 7 : 6;
}

/** A unit's page: the map pinned to where that unit is right now. */
export function ChainFlowLive({ unit, iBid }: { unit: ChainUnit; iBid: boolean }) {
  const step = flowStep(unit, iBid);
  const s = FLOW[step];
  return (
    <section aria-labelledby="where-now" className="mt-16 border-t border-line pt-10">
      <div className="grid gap-6 lg:grid-cols-[0.8fr_1fr] lg:items-end">
        <h2 id="where-now" className="display text-[clamp(36px,4vw,56px)]">Where this unit is right now</h2>
        <p className="max-w-[520px] text-[17px] text-ink-2 lg:justify-self-end"><span className="text-ink">{s.title}.</span> {s.body}</p>
      </div>
      <div className="brackets mt-8 bg-ground-2/40 px-2 py-6 md:px-8 md:py-8"><ChainFlow step={step} draw={unit.draw} unit={unit.id} /></div>
      <p className="label num mt-5 text-ink-3">Step {step + 1} of {FLOW.length} · happening on <span className="text-accent-text">{s.where}</span> · read from devnet every few seconds</p>
    </section>
  );
}
