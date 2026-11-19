import { after, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { loadKeeper, readUnits, tick } from "@/lib/chain/keeper";
import { ITEMS, PROGRAM, YARD } from "@/lib/chain/shared";
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
    const { yard, units } = await readUnits(k, 12);
    const house = new Set(k ? k.house.map((h) => h.publicKey.toBase58()) : []);
    const out: ChainUnit[] = units.map(({ id, key, onRollup, u }) => {
      const status = Object.keys(u.status)[0] as ChainUnit["status"];
      const closed = status === "closed";
      const winner = closed && !u.winner.equals(PublicKey.default) ? u.winner.toBase58() : null;
      return {
        id, address: key.toBase58(), status, onRollup, stocked: u.stocked,
        minBid: Number(u.minBid) / 1e6, duration: Number(u.duration), closesAt: Number(u.closesAt) * 1000, bidCount: u.bidCount,
        bids: u.slots.map((s: any) => ({ who: s.bidder.toBase58(), house: house.has(s.bidder.toBase58()), deposit: Number(s.deposit) / 1e6, hasBid: s.hasBid, bid: closed && s.hasBid ? Number(s.bid) / 1e6 : null })),
        clues: u.stocked ? u.clues.map((c: any) => ({ kind: c.kind, arg: c.arg })) : [],
        winner, winningBid: Number(u.winningBid) / 1e6, value: u.value,
        lots: closed ? u.lots.map((l: any) => ({ name: ITEMS[l.item].name, id: ITEMS[l.item].id, rarity: ITEMS[l.item].rarity, heavy: ITEMS[l.item].heavy, qty: l.qty, value: ITEMS[l.item].value * l.qty })) : [],
        claimed: closed && u.lots.length > 0 && u.claimedMask === (1 << u.lots.length) - 1,
      };
    });
    const body: ChainYard = { programId: PROGRAM.toBase58(), yard: YARD.toBase58(), unitCount: Number(yard.unitCount), settled: out.filter((u) => u.status === "closed").length, keeper: !!k, units: out, readAt: Date.now() };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    if (cache) return NextResponse.json(cache.body);
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, { status: 502 });
  }
}
