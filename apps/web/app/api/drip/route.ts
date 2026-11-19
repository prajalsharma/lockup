import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { drip, loadKeeper } from "@/lib/chain/keeper";

export const dynamic = "force-dynamic";

/** Starter funds for a new wallet: devnet SOL for fees and 1 USDC, once. */
export async function POST(req: Request) {
  const k = loadKeeper();
  if (!k) return NextResponse.json({ result: "off" }, { status: 503 });
  try {
    const { address } = await req.json();
    return NextResponse.json({ result: "ok", ...(await drip(k, new PublicKey(String(address)))) });
  } catch (e) {
    return NextResponse.json({ result: "error", message: e instanceof Error ? e.message.slice(0, 160) : "failed" }, { status: 400 });
  }
}
