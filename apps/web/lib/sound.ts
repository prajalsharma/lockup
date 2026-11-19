"use client";
/** Small synthesised sound set. No audio files; everything is built from oscillators and noise. */
let ctx: AudioContext | null = null;
let on = true;
const KEY = "lockup.sound";

export function soundEnabled() {
  if (typeof window === "undefined") return true;
  try { const v = localStorage.getItem(KEY); if (v !== null) on = v === "1"; } catch { /* ignore */ }
  return on;
}
export function setSound(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* ignore */ }
}
function ac() {
  if (!on || typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}
function noise(c: AudioContext, dur: number) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}
function thump(c: AudioContext, t: number, f0: number, f1: number, dur: number, vol: number) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function click(c: AudioContext, t: number, freq: number, vol: number) {
  const n = noise(c, 0.05), f = c.createBiquadFilter(), g = c.createGain();
  f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 3;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  n.connect(f).connect(g).connect(c.destination);
  n.start(t);
}

export const sfx = {
  /** Padlock snapping shut: your bid is sealed. */
  lock() { const c = ac(); if (!c) return; const t = c.currentTime; click(c, t, 2600, 0.5); thump(c, t + 0.03, 190, 70, 0.14, 0.5); click(c, t + 0.09, 1400, 0.25); },
  /** Padlock dropping off before the door moves. */
  unlock() { const c = ac(); if (!c) return; const t = c.currentTime; click(c, t, 3200, 0.4); thump(c, t + 0.16, 120, 45, 0.2, 0.6); },
  /** Roll-up door: band-passed noise with a chain-like flutter. */
  door(dur = 2.2) {
    const c = ac(); if (!c) return; const t = c.currentTime;
    const n = noise(c, dur), f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    f.type = "bandpass"; f.frequency.setValueAtTime(420, t); f.frequency.linearRampToValueAtTime(780, t + dur); f.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.15);
    g.gain.setValueAtTime(0.22, t + dur - 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lfo.frequency.value = 17; lg.gain.value = 0.12; lfo.connect(lg).connect(g.gain);
    n.connect(f).connect(g).connect(c.destination);
    n.start(t); lfo.start(t); lfo.stop(t + dur);
    thump(c, t + dur - 0.05, 90, 40, 0.25, 0.5);
  },
  /** A clue caught in the torch beam. */
  clue() { const c = ac(); if (!c) return; click(c, c.currentTime, 5200, 0.18); },
  tick() { const c = ac(); if (!c) return; click(c, c.currentTime, 1800, 0.12); },
  win() { const c = ac(); if (!c) return; const t = c.currentTime; [523, 784, 1047].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = "triangle"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.11); g.gain.linearRampToValueAtTime(0.16, t + i * 0.11 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.5); o.connect(g).connect(c.destination); o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.55); }); },
  lose() { const c = ac(); if (!c) return; thump(c, c.currentTime, 160, 60, 0.35, 0.35); },
};
