import { NextResponse } from "next/server";
import { readPools } from "@/lib/chain/keeper";
import { ITEMS, USD } from "@/lib/chain/shared";
import type { PriceRecord } from "@/lib/chain/types";

export const dynamic = "force-dynamic";

let cache: { at: number; body: PriceRecord[] } | null = null;

/** Each item's price record and consigned stock, read from its shelf account on Solana. */
export async function GET() {
  if (cache && Date.now() - cache.at < 5000) return NextResponse.json(cache.body);
  try {
    const pools = await readPools();
    const body: PriceRecord[] = pools.map((p) => {
      const it = ITEMS[p.item];
      return {
        id: it.id, name: it.name, rarity: it.rarity, mint: it.mint, value: it.value / 100,
        consigned: p.consigned,
        auctionSold: p.auctionSold,
        auctionAvg: p.auctionSold ? p.auctionPaid / p.auctionSold / USD : null,
        auctionLast: p.auctionSold ? p.auctionLast / USD : null,
        marketSold: p.marketSold,
        marketAvg: p.marketSold ? p.marketPaid / p.marketSold / USD : null,
        marketLast: p.marketSold ? p.marketLast / USD : null,
      };
    });
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    if (cache) return NextResponse.json(cache.body);
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, { status: 502 });
  }
}
