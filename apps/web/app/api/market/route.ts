import { after, NextResponse } from "next/server";
import { loadKeeper, readListings, tick } from "@/lib/chain/keeper";
import { ITEMS } from "@/lib/chain/shared";
import type { MarketListing } from "@/lib/chain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let cache: { at: number; body: MarketListing[] } | null = null;

/** Every open resale listing in the yard, read from Solana. */
export async function GET() {
  // Reading the market also nudges the keeper, so the yard's buyer acts while someone is looking.
  const k = loadKeeper();
  if (k) after(() => tick(k).catch(() => undefined));
  if (cache && Date.now() - cache.at < 2000) return NextResponse.json(cache.body);
  try {
    const body: MarketListing[] = (await readListings()).map((l) => ({
      address: l.key.toBase58(), seller: l.seller.toBase58(), mint: l.mint.toBase58(),
      id: ITEMS[l.item].id, name: ITEMS[l.item].name, rarity: ITEMS[l.item].rarity,
      value: ITEMS[l.item].value / 100, price: l.price / 1e6, qty: l.qty,
    }));
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    if (cache) return NextResponse.json(cache.body);
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, { status: 502 });
  }
}
