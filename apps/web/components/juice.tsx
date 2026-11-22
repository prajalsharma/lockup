"use client";
/**
 * The small moving parts that make money and secrets feel physical: digits that roll, bids that
 * decode, a bolt you slide to seal, a burst when you win, and a slip that prints your payout.
 *
 * RollingUsd, Decode, SlideToSeal and Burst are adapted from EasyUI (Animated Number Morph, Text
 * Scramble Decoder, Drag to Confirm, Gravity Particle Burst), redrawn for the yard.
 * EasyUI: https://github.com/Surajmaurya1/easyui. MIT License, Copyright (c) 2026 Suraj Maurya.
 */
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";

/* ---------- rolling digits ---------- */

function Digit({ n }: { n: number }) {
  const spring = useSpring(n, { stiffness: 150, damping: 21, mass: 0.7 });
  const y = useTransform(spring, (v) => `-${v * 10}%`);
  useEffect(() => { spring.set(n); }, [spring, n]);
  return (
    <span aria-hidden className="relative inline-block h-[1.1em] w-[1ch] select-none overflow-hidden align-bottom">
      <motion.span style={{ y }} className="absolute inset-x-0 top-0 flex flex-col">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <span key={d} className="flex h-[1.1em] items-center justify-center">{d}</span>)}
      </motion.span>
    </span>
  );
}

/** A dollar amount whose digits roll to each new value. `from` makes it count up when it appears. */
export function RollingUsd({ value, from, className = "" }: { value: number; from?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [v, setV] = useState(from ?? value);
  useEffect(() => { setV(value); }, [value]);
  const text = usd(reduced ? value : v);
  if (reduced) return <span className={className}>{text}</span>;
  // Keyed from the right, so a digit keeps its column when the amount gains a place.
  const chars = text.split("");
  return (
    <span className={`inline-flex items-end leading-[1.1] ${className}`} aria-label={usd(value)} role="text">
      {chars.map((c, i) => {
        const key = chars.length - i;
        return /\d/.test(c) ? <Digit key={key} n={Number(c)} /> : <span key={key} aria-hidden className="inline-block h-[1.1em] leading-[1.1]">{c}</span>;
      })}
    </span>
  );
}

/* ---------- sealed text decoding ---------- */

const GLYPHS = "0123456789";

/** Text that starts as churning digits and settles left to right, like a sealed bid being read. */
export function Decode({ text, delay = 0, duration = 900, className = "" }: { text: string; delay?: number; duration?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (reduced) { setShown(text); return; }
    let frame = 0;
    const start = performance.now() + delay;
    const settle = text.split("").map((_, i) => 0.25 + (i / Math.max(text.length - 1, 1)) * 0.7);
    const tick = (now: number) => {
      const t = Math.min(Math.max(now - start, 0) / duration, 1);
      setShown(text.split("").map((c, i) => (!/\d/.test(c) || t >= settle[i] ? c : GLYPHS[(Math.floor(now / 42) + i * 7) % 10])).join(""));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, delay, duration, reduced]);
  return <span className={className} aria-label={text} role="text"><span aria-hidden>{shown}</span></span>;
}

/* ---------- slide the bolt to seal ---------- */

const THUMB = 52;

function Padlock({ shut }: { shut: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" aria-hidden>
      <rect x="5" y="11" width="14" height="9" fill="currentColor" stroke="none" />
      <path d={shut ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.6-1.8"} />
    </svg>
  );
}

/**
 * A bolt you drag across to commit to something you can't take back. `onSeal` resolves true when
 * the action went through; anything else slides the bolt home again. Enter, Space or the right
 * arrow do the same from the keyboard.
 */
export function SlideToSeal({ label, busy, disabled, onSeal }: { label: string; busy?: string | null; disabled?: boolean; onSeal: () => Promise<boolean> }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(200);
  const [sealed, setSealed] = useState(false);
  const x = useMotionValue(0);
  const fill = useTransform(x, (v) => `${v + THUMB / 2}px`);
  const fade = useTransform(x, [0, max * 0.5], [1, 0]);

  useEffect(() => {
    const measure = () => { if (track.current) setMax(Math.max(40, track.current.offsetWidth - THUMB - 2)); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const go = useCallback((to: number) => { void animate(x, to, reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }); }, [x, reduced]);

  const seal = useCallback(() => {
    if (disabled || sealed) return;
    setSealed(true);
    go(max);
    try { navigator.vibrate?.(20); } catch { /* not allowed on this device */ }
    void onSeal().then((ok) => { if (!ok) { setSealed(false); go(0); } }, () => { setSealed(false); go(0); });
  }, [disabled, sealed, go, max, onSeal]);

  const off = !!disabled && !sealed;
  return (
    <div ref={track} className={`relative mt-4 flex h-[54px] select-none items-center overflow-hidden border border-line-2 bg-ground-2 ${off ? "opacity-45" : ""}`}>
      <motion.div style={{ width: sealed ? "100%" : fill }} className="hazard pointer-events-none absolute inset-y-0 left-0 !h-auto opacity-90" aria-hidden />
      <motion.span style={{ opacity: sealed ? 0 : fade }} className="label pointer-events-none absolute inset-0 flex items-center justify-center pl-[52px] text-ink-2">
        {busy ?? label} <span className="ml-2" aria-hidden>→→</span>
      </motion.span>
      {sealed && <span className="label pointer-events-none absolute inset-0 flex items-center justify-center bg-ground-2/85 pr-[52px] text-ink">{busy ?? "Sealing"}</span>}
      <motion.div
        role="slider" tabIndex={off ? -1 : 0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={sealed ? 100 : 0} aria-disabled={off}
        drag={off || sealed ? false : "x"} dragConstraints={{ left: 0, right: max }} dragElastic={0.04} dragMomentum={false}
        style={{ x, width: THUMB }}
        onDragEnd={() => (x.get() >= max * 0.85 ? seal() : go(0))}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); seal(); } }}
        className={`relative z-10 flex h-[52px] touch-none items-center justify-center bg-accent text-[#14110a] outline-none focus-visible:ring-2 focus-visible:ring-ink ${off ? "cursor-not-allowed" : sealed ? "" : "cursor-grab active:cursor-grabbing"}`}
      >
        <Padlock shut={sealed} />
      </motion.div>
    </div>
  );
}

/* ---------- a burst of tags when you win ---------- */

const CONFETTI = ["#ffb01f", "#d9c9a3", "#efeae0", "#14110a"];

/** Fires once from wherever it is placed, over the whole window, then removes itself. */
export function Burst({ count = 46 }: { count?: number }) {
  const reduced = useReducedMotion();
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduced || !anchor.current) return;
    const at = anchor.current.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    const scale = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * scale;
    canvas.height = window.innerHeight * scale;
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:60";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let bits = Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI + (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const force = (3 + Math.random() * 6) * scale;
      return { x: at.left * scale, y: at.top * scale, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force - 3 * scale, age: 0, life: 50 + Math.random() * 40, w: (4 + Math.random() * 5) * scale, spin: Math.random() * 6, turn: (Math.random() - 0.5) * 0.4, color: CONFETTI[i % CONFETTI.length] };
    });
    let frame = 0;
    const draw = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bits = bits.filter((b) => b.age < b.life);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.vx *= 0.98; b.vy = b.vy * 0.98 + 0.22 * scale; b.age += 1; b.spin += b.turn;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - b.age / b.life) * 2);
        ctx.translate(b.x, b.y); ctx.rotate(b.spin);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.w * 0.7, b.w, b.w * 1.4);
        ctx.restore();
      }
      if (bits.length) frame = requestAnimationFrame(draw);
      else canvas.remove();
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); canvas.remove(); };
  }, [reduced, count]);
  return <span ref={anchor} className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden />;
}

/* ---------- the payout slip ---------- */

/** A paper slip that prints line by line: what you put in, what you paid, what came back. */
export function Slip({ title, rows, total, foot }: { title: string; rows: [string, number][]; total: [string, number]; foot: string }) {
  return (
    <div className="slip relative mt-6 max-w-[340px] border border-b-0 border-[#14110a]/15 bg-[#e9dfc6] px-5 pb-6 pt-4 font-mono text-[13px] text-[#14110a]">
      <p className="text-[11px] uppercase tracking-[0.08em] opacity-70">{title}</p>
      <dl className="mt-3 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4"><dt>{k}</dt><dd className="tabular-nums">{usd(v)}</dd></div>
        ))}
        <div className="flex justify-between gap-4 border-t border-dashed border-[#14110a]/50 pt-2 text-[15px] font-semibold"><dt>{total[0]}</dt><dd className="tabular-nums">{usd(total[1])}</dd></div>
      </dl>
      <p className="mt-3 text-[11px] leading-snug opacity-70">{foot}</p>
    </div>
  );
}
