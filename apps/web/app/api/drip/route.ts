import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { drip, loadKeeper } from "@/lib/chain/keeper";

export const dynamic = "force-dynamic";

/** A little devnet SOL for fees, for wallets that have none. */
export async function POST(req: Request) {
  const k = loadKeeper();
  if (!k) return NextResponse.json({ result: "off" }, { status: 503 });
  try {
    const { address } = await req.json();
    return NextResponse.json({ result: await drip(k, new PublicKey(String(address))) });
  } catch (e) {
    return NextResponse.json({ result: "error", message: e instanceof Error ? e.message.slice(0, 160) : "failed" }, { status: 400 });
  }
}
