import { after, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { loadKeeper, readUnits, seatOf, tick } from "@/lib/chain/keeper";
import { ITEMS, MULTI_SECONDS, PROGRAM, YARD } from "@/lib/chain/shared";
import type { ChainUnit, ChainYard } from "@/lib/chain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let cache: { at: number; body: ChainYard } | null = null;

export async function GET() {
  const k = loadKeeper();
  // Every read also nudges the keeper, so rounds move whenever someone has the yard open.
  if (k) after(() => tick(k).catch(() => undefined));
  if (cache && Date.now() - cache.at < 1500) return NextResponse.json(cache.body);
  try {
    const { yard, units: all } = await readUnits(k);
    // Every unit still in play, plus the newest finished ones.
    const live = all.filter((x) => !("closed" in x.u.status));
    const units = [...live, ...all.filter((x) => "closed" in x.u.status).slice(0, Math.max(6, 14 - live.length))].sort((a, b) => b.id - a.id);
    const house = new Set(k ? k.house.map((h) => h.publicKey.toBase58()) : []);
    const out: ChainUnit[] = units.map(({ id, key, onRollup, u }) => {
      const status = Object.keys(u.status)[0] as ChainUnit["status"];
      const closed = status === "closed";
      const winner = closed && !u.winner.equals(PublicKey.default) ? u.winner.toBase58() : null;
      return {
        id, address: key.toBase58(), status, onRollup, mode: Number(u.duration) >= MULTI_SECONDS ? "multi" : "solo", stocked: u.stocked,
        minBid: Number(u.minBid) / 1e6, duration: Number(u.duration), closesAt: Number(u.closesAt) * 1000, bidCount: u.bidCount,
        bids: u.slots.map((s: any) => ({ who: s.bidder.toBase58(), house: house.has(s.bidder.toBase58()), deposit: Number(s.deposit) / 1e6, hasBid: s.hasBid, bid: closed && s.hasBid ? Number(s.bid) / 1e6 : null, ...seatOf(u, s) })),
        clues: u.stocked ? u.clues.map((c: any) => ({ kind: c.kind, arg: c.arg })) : [],
        winner, winningBid: Number(u.winningBid) / 1e6, value: u.value / 100,
        lots: closed ? u.lots.map((l: any) => ({ name: ITEMS[l.item].name, id: ITEMS[l.item].id, rarity: ITEMS[l.item].rarity, heavy: ITEMS[l.item].heavy, qty: l.qty, value: (ITEMS[l.item].value * l.qty) / 100 })) : [],
        claimed: closed && u.lots.length > 0 && (u.claimedMask & ((1 << u.lots.length) - 1)) === (1 << u.lots.length) - 1,
        draw: u.randomness.every((b: number) => b === 0) ? "" : Buffer.from(u.randomness.slice(0, 8)).toString("hex"),
      };
    });
    const tally = new Map<string, { who: string; opened: number; profit: number; best: number }>();
    for (const { u } of all) {
      if (!("closed" in u.status) || u.winner.equals(PublicKey.default)) continue;
      const who = u.winner.toBase58();
      if (house.has(who)) continue;
      const gain = u.value / 100 - Number(u.winningBid) / 1e6;
      const t = tally.get(who) ?? { who, opened: 0, profit: 0, best: -Infinity };
      t.opened++; t.profit += gain; t.best = Math.max(t.best, gain);
      tally.set(who, t);
    }
    const board = [...tally.values()].sort((a, b) => b.profit - a.profit).slice(0, 8).map((t) => ({ ...t, profit: Math.round(t.profit * 100) / 100, best: Math.round(t.best * 100) / 100 }));
    const body: ChainYard = { programId: PROGRAM.toBase58(), yard: YARD.toBase58(), unitCount: Number(yard.unitCount), settled: all.filter((x) => "closed" in x.u.status).length, keeper: !!k, units: out, board, readAt: Date.now() };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    if (cache) return NextResponse.json(cache.body);
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, { status: 502 });
  }
}
