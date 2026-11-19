"use client";
import { useEffect, useRef, useState } from "react";
import { pad2 } from "@/lib/format";

const STEPS = [
  { title: "The unit is stocked", body: "A random draw decides what goes inside. Nobody picks the contents, including us. The draw comes from MagicBlock VRF, mixed with a salt we lock in beforehand and publish afterwards." },
  { title: "Three clues go on the door", body: "The same draw picks three true facts about the unit and pins them up. How many items. What kind. A floor on what it's worth. The rest stays hidden." },
  { title: "You bid in the dark", body: "Your bid is written inside a private rollup. Other bidders can see that you bid. They can't see the number, so nobody can beat you by a dollar at the last second." },
  { title: "The clock runs out", body: "All the bids are read at the same moment. The highest one takes the unit. Everyone else gets their full bid back." },
  { title: "The door rolls up", body: "The contents move to the winner's wallet on Solana, and the bids are published so the result can be checked." },
];

const BIDS = [
  { who: "7xKp…3fQa", bid: 64 },
  { who: "You", bid: 88 },
  { who: "Dm2v…9LzE", bid: 51 },
];
const TAGS = ["4 items inside", "A coin slot was spotted", "Worth at least $60"];
const CRATES = [{ n: "Arcade cabinet", v: 120 }, { n: "Crate of vinyl", v: 26 }, { n: "Skate decks", v: 22 }];

export function Story() {
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, travel)));
      setProgress(p);
      setStep(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);

  const doorUp = step === 0 || step === 4;
  const T = "transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:duration-150";

  return (
    <section id="how" ref={ref} className="relative h-[340vh] border-b border-line">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden pt-16">
        <div className="wrap flex min-h-0 flex-1 flex-col gap-6 py-6 lg:grid lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16 lg:py-10">
          {/* Stage */}
          <div className="brackets relative mx-auto aspect-[5/4] w-full max-w-[620px] shrink-0 bg-[#07080a] max-lg:max-h-[42svh]" aria-hidden>
            <div className="absolute inset-x-[14%] bottom-[10%] top-[10%] overflow-hidden border border-[#30343a] bg-[#2a241d]">
              {/* inside */}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-center gap-[4%] px-[6%] pb-[5%]">
                {CRATES.map((c, i) => (
                  <div key={c.n} className={`${T} flex aspect-square w-[27%] flex-col justify-between bg-[#b39a6b] p-[5%] text-[#14110a] ${step === 0 ? "delay-[var(--d)]" : ""}`}
                    style={{ ["--d" as string]: `${i * 120}ms`, transform: step === 0 || step === 4 ? "none" : "translateY(8%)", background: i === 0 && step === 4 ? "#ffb01f" : undefined }}>
                    <span className="font-mono text-[clamp(8px,1.1vw,12px)] font-semibold leading-tight">{step === 4 ? c.n : "?"}</span>
                    <span className="font-mono text-[clamp(8px,1.1vw,12px)]">{step === 4 ? `$${c.v}` : ""}</span>
                  </div>
                ))}
              </div>
              <div className={`${T} absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,180,90,0.28),transparent_70%)]`} style={{ opacity: step === 4 ? 1 : 0.25 }} />
              {/* door */}
              <div className={`${T} steel absolute inset-0`} style={{ ["--door" as string]: "#4d5560", transform: doorUp ? "translateY(-94%)" : "none" }}>
                <span className="stencil absolute left-1/2 top-[34%] -translate-x-1/2 text-[clamp(64px,13vw,150px)] text-[#efeae0]/85">07</span>
                {TAGS.map((t, i) => (
                  <span key={t} className={`${T} absolute bg-[#d9c9a3] px-[3%] py-[1.5%] font-mono text-[clamp(8px,1vw,12px)] font-semibold text-[#14110a]`}
                    style={{ left: `${[8, 52, 20][i]}%`, top: `${[14, 46, 76][i]}%`, opacity: step >= 1 ? 1 : 0, transform: `rotate(${[-3, 2, 1.5][i]}deg) translateY(${step >= 1 ? 0 : 8}px)`, transitionDelay: `${i * 110}ms` }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {/* bids */}
            <div className={`${T} absolute right-[3%] top-[8%] w-[38%] border border-[#efeae0]/20 bg-[#0a0b0e] p-[3%]`} style={{ opacity: step >= 2 ? 1 : 0, transform: step >= 2 ? "none" : "translateX(12px)" }}>
              <p className="font-mono text-[clamp(8px,0.9vw,11px)] uppercase tracking-[0.08em] text-[#6f6b62]">{step >= 3 ? "Bids opened" : "Bids sealed"}</p>
              {BIDS.map((b) => (
                <p key={b.who} className={`mt-[6%] flex justify-between font-mono text-[clamp(9px,1.05vw,13px)] ${step >= 3 && b.bid === 88 ? "text-[#ffb01f]" : "text-[#efeae0]"}`}>
                  <span>{b.who}</span><span>{step >= 3 ? `$${b.bid}` : "••••"}</span>
                </p>
              ))}
            </div>
          </div>

          {/* Text */}
          <div className="flex min-h-0 flex-col">
            <p className="label num text-ink-3"><span className="text-ink">{pad2(step + 1)}</span> / {pad2(STEPS.length)} · how a round works</p>
            <div className="relative mt-4 min-h-[250px] sm:min-h-[300px]">
              {STEPS.map((s, i) => (
                <div key={s.title} className={`${T} absolute inset-0`} style={{ opacity: i === step ? 1 : 0, transform: i === step ? "none" : `translateY(${i < step ? -14 : 14}px)`, pointerEvents: i === step ? "auto" : "none" }} aria-hidden={i !== step}>
                  <h2 className="display text-[clamp(40px,5.6vw,84px)]">{s.title}</h2>
                  <p className="mt-5 max-w-[520px] text-[17px] text-ink-2">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="h-px w-full bg-line" aria-hidden>
          <div className="h-px origin-left bg-accent" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
      {/* Readable copy for assistive tech; the animated stage above is decorative. */}
      <ol className="sr-only">{STEPS.map((s) => <li key={s.title}>{s.title}. {s.body}</li>)}</ol>
    </section>
  );
}
