"use client";
/**
 * Practice yard. Runs entirely in the browser so anyone can play without a wallet.
 * The seeded draw stands in for MagicBlock VRF and the hidden rival bids stand in
 * for bids sealed in the private rollup. Nothing here touches a chain.
 */
import { useSyncExternalStore } from "react";
import { CATALOG, GROUP_CLUE } from "./catalog";
import type { Clue, Find, Lot, Player, RivalBid, Unit } from "./types";
import { YOU } from "./types";

const PAINTS = ["#4d5560", "#7a3b2e", "#2f5d62", "#6b5a2a", "#3c4a6b", "#5a3f5c"];
const UNIT_IDS = [3, 7, 12, 18, 24, 31];
const START_BALANCE = 500;
const KEY = "lockup.practice.v1";
const PENDING = "lockup.practice.pending.v1";
/** Bids sealed in a unit that has not opened yet. A reload loses the unit, so these are refunded on boot. */
function pending(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(PENDING) || "{}"); } catch { return {}; }
}
function setPending(id: number, amount: number | null) {
  try {
    const p = pending();
    if (amount === null) delete p[id]; else p[id] = amount;
    localStorage.setItem(PENDING, JSON.stringify(p));
  } catch { /* private mode */ }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function fakeAddress(r: () => number) {
  const c = () => B58[Math.floor(r() * B58.length)];
  return `${c()}${c()}${c()}${c()}…${c()}${c()}${c()}${c()}`;
}

interface Secret {
  contents: Lot[];
  value: number;
  rivals: RivalBid[];
}

function stock(seed: number): { secret: Secret; clues: Clue[]; minBid: number } {
  const r = rng(seed);
  // Weighted draw: commons are frequent, grails are not.
  const weight = (rar: string) => (rar === "common" ? 10 : rar === "rare" ? 3 : 0.6);
  const total = CATALOG.reduce((s, c) => s + weight(c.rarity), 0);
  const draws = 3 + Math.floor(r() * 4);
  const map = new Map<string, Lot>();
  for (let i = 0; i < draws; i++) {
    let x = r() * total;
    let pick = CATALOG[0];
    for (const c of CATALOG) {
      x -= weight(c.rarity);
      if (x <= 0) { pick = c; break; }
    }
    const have = map.get(pick.id);
    if (have) have.qty += 1;
    else map.set(pick.id, { item: pick, qty: 1 });
  }
  const contents = [...map.values()].sort((a, b) => b.item.value - a.item.value);
  const value = contents.reduce((s, l) => s + l.item.value * l.qty, 0);
  const count = contents.reduce((s, l) => s + l.qty, 0);

  // Every true statement about the unit; the draw decides which three go on the door.
  const pool: Clue[] = [{ kind: "count", text: `${count} items inside` }];
  const groups = [...new Set(contents.map((l) => l.item.group))];
  for (const g of groups) pool.push({ kind: "group", text: GROUP_CLUE[g] });
  const floor = Math.max(5, Math.floor((value * (0.35 + r() * 0.25)) / 5) * 5);
  pool.push({ kind: "floor", text: `Worth at least $${floor}` });
  const hasGrail = contents.some((l) => l.item.rarity === "grail");
  pool.push({ kind: "grail", text: hasGrail ? "One item is a grail" : "No grail in this one" });
  const heavy = contents.filter((l) => l.item.heavy).reduce((s, l) => s + l.qty, 0);
  pool.push({ kind: "heavy", text: heavy ? `${heavy} heavy ${heavy === 1 ? "item" : "items"} at the back` : "Nothing heavy inside" });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const clues = pool.slice(0, 3);

  const minBid = Math.max(5, Math.round((value * 0.12) / 5) * 5);
  const n = 2 + Math.floor(r() * 4);
  const rivals: RivalBid[] = [];
  for (let i = 0; i < n; i++) {
    const nerve = 0.3 + r() * 0.62; // how much of the true value this rival will pay
    const noise = 0.85 + r() * 0.4; // rivals only see the clues, so they misjudge
    rivals.push({ who: fakeAddress(r), bid: Math.max(minBid, Math.round(value * nerve * noise)) });
  }
  return { secret: { contents, value, rivals }, clues, minBid };
}

const seedOf = (id: number, round: number) => (id * 7919 + round * 104729 + 20261120) >>> 0;
const roundLength = (id: number, round: number) => 70_000 + ((id * 7 + round * 29) % 9) * 20_000;

function freshUnit(id: number, round: number, now: number, idx: number): Unit {
  const s = stock(seedOf(id, round));
  return {
    id, round, phase: "bidding", paint: PAINTS[idx % PAINTS.length], minBid: s.minBid,
    closesAt: now + roundLength(id, round), clues: s.clues, bidCount: s.secret.rivals.length,
    myBid: null, result: null,
  };
}

interface State {
  units: Unit[];
  player: Player;
  ready: boolean;
}

let state: State = {
  units: [],
  player: { balance: START_BALANCE, rounds: 0, wins: 0, finds: [] },
  ready: false,
};
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
  state = { ...state };
  for (const f of subs) f();
}
function savePlayer() {
  try { localStorage.setItem(KEY, JSON.stringify(state.player)); } catch { /* private mode */ }
}

function boot() {
  if (state.ready || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state.player = { ...state.player, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  const owed = Object.values(pending()).reduce((a, b) => a + (Number(b) || 0), 0);
  if (owed > 0) {
    state.player = { ...state.player, balance: state.player.balance + owed };
    try { localStorage.removeItem(PENDING); } catch { /* ignore */ }
    savePlayer();
  }
  const now = Date.now();
  state.units = UNIT_IDS.map((id, i) => freshUnit(id, 1, now, i));
  state.ready = true;
}

function openUnit(u: Unit): Unit {
  const { secret } = stock(seedOf(u.id, u.round));
  const bids: RivalBid[] = [...secret.rivals];
  if (u.myBid !== null) bids.push({ who: YOU, bid: u.myBid });
  // Highest bid wins. A tie goes to the earlier bid; rivals were there first.
  bids.sort((a, b) => b.bid - a.bid || (a.who === YOU ? 1 : -1));
  const top = bids[0];
  const result = { bids, winner: top.who, winningBid: top.bid, contents: secret.contents, value: secret.value };
  if (u.myBid !== null) {
    setPending(u.id, null);
    const p = state.player;
    if (top.who === YOU) {
      const find: Find = { unit: u.id, round: u.round, paid: top.bid, value: secret.value, contents: secret.contents, at: Date.now() };
      state.player = { ...p, rounds: p.rounds + 1, wins: p.wins + 1, finds: [find, ...p.finds].slice(0, 40) };
    } else {
      // Losing bids come back in full.
      state.player = { ...p, rounds: p.rounds + 1, balance: p.balance + u.myBid };
    }
    savePlayer();
  }
  return { ...u, phase: "opened", result };
}

function tick() {
  const now = Date.now();
  let changed = false;
  state.units = state.units.map((u, i) => {
    if (u.phase === "bidding" && now >= u.closesAt) { changed = true; return { ...u, phase: "opening" as const }; }
    if (u.phase === "opening" && now >= u.closesAt + 2600) { changed = true; return openUnit(u); }
    // An opened unit is restocked after a while, unless the player is still looking at their own result.
    if (u.phase === "opened" && now >= u.closesAt + (u.myBid !== null ? 180_000 : 45_000)) {
      changed = true; return freshUnit(u.id, u.round + 1, now, i);
    }
    return u;
  });
  if (changed) emit();
}

function subscribe(f: () => void) {
  boot();
  subs.add(f);
  if (!timer) timer = setInterval(tick, 250);
  queueMicrotask(emit);
  return () => {
    subs.delete(f);
    if (!subs.size && timer) { clearInterval(timer); timer = null; }
  };
}

const SERVER: State = { units: [], player: { balance: START_BALANCE, rounds: 0, wins: 0, finds: [] }, ready: false };

export function useYard() {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

export const yard = {
  placeBid(id: number, amount: number): string | null {
    const u = state.units.find((x) => x.id === id);
    if (!u || u.phase !== "bidding") return "Bidding has closed on this unit.";
    if (u.myBid !== null) return "Your bid is already sealed.";
    if (amount < u.minBid) return `Lowest bid allowed is $${u.minBid}.`;
    if (amount > state.player.balance) return `Not enough test dollars. Bid is $${amount}, you have $${state.player.balance}.`;
    state.player = { ...state.player, balance: state.player.balance - amount };
    state.units = state.units.map((x) => (x.id === id ? { ...x, myBid: amount, bidCount: x.bidCount + 1 } : x));
    setPending(id, amount);
    savePlayer();
    emit();
    return null;
  },
  /** Practice only: end the round in five seconds instead of waiting for the clock. */
  closeSoon(id: number) {
    const now = Date.now();
    state.units = state.units.map((x) => (x.id === id && x.phase === "bidding" && x.closesAt - now > 5000 ? { ...x, closesAt: now + 5000 } : x));
    emit();
  },
  restock(id: number) {
    const now = Date.now();
    state.units = state.units.map((x, i) => (x.id === id && x.phase === "opened" ? freshUnit(x.id, x.round + 1, now, i) : x));
    emit();
  },
  topUp() {
    state.player = { ...state.player, balance: state.player.balance + 500 };
    savePlayer();
    emit();
  },
  reset() {
    state.player = { balance: START_BALANCE, rounds: 0, wins: 0, finds: [] };
    savePlayer();
    emit();
  },
};

export function useNow(ms = 250) {
  return useSyncExternalStore(
    (f) => { const t = setInterval(f, ms); return () => clearInterval(t); },
    () => Math.floor(Date.now() / ms) * ms,
    () => 0,
  );
}

export const UNIT_NUMBERS = UNIT_IDS;
