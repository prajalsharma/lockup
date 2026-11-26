import { NextResponse } from "next/server";
import { loadKeeper, readUnit, seatOf } from "@/lib/chain/keeper";
import type { ChainUnit, Pulse } from "@/lib/chain/types";

export const dynamic = "force-dynamic";

const cache = new Map<number, { at: number; body: Pulse }>();

/**
 * One unit's table, read from the private rollup. The unit page asks for this twice a second
 * while bids are sealed, so a raise or a lock-in shows up for everyone almost as it happens.
 * It carries who acted and when. Amounts are not in the account this reads.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1 || id > 1_000_000) return NextResponse.json({ error: "No such unit" }, { status: 400 });
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 300) return NextResponse.json(hit.body);
  try {
    const u = await readUnit(loadKeeper(), id);
    if (!u) return NextResponse.json({ error: "No such unit" }, { status: 404 });
    const body: Pulse = {
      status: Object.keys(u.status)[0] as ChainUnit["status"], stocked: u.stocked, closesAt: Number(u.closesAt) * 1000, bidCount: u.bidCount,
      bids: u.slots.map((s: any) => ({ who: s.bidder.toBase58(), hasBid: s.hasBid, ...seatOf(u, s) })),
      readAt: Date.now(),
    };
    cache.set(id, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value as number);
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, { status: 502 });
  }
}
