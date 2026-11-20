import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { drip, loadKeeper } from "@/lib/chain/keeper";

export const dynamic = "force-dynamic";

// First line of defence: one visitor can't ask for many wallets in a row. This is per server
// instance, so it is only a speed bump; the real ceiling is the on-chain ration in `drip`.
const PER_VISITOR = 3;
const WINDOW_MS = 60 * 60_000;
const seen = new Map<string, number[]>();

/** Starter funds for a new wallet: devnet SOL for fees and 1 USDC, once. */
export async function POST(req: Request) {
  const k = loadKeeper();
  if (!k) return NextResponse.json({ result: "off" }, { status: 503 });
  try {
    const { address } = await req.json();
    const to = new PublicKey(String(address));
    const who = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const now = Date.now();
    const mine = (seen.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
    if (mine.length >= PER_VISITOR) return NextResponse.json({ result: "ok", sol: "limit", usdc: "limit" }, { status: 429 });
    const out = await drip(k, to);
    if (out.sol === "sent" || out.usdc === "sent") { mine.push(now); seen.set(who, mine); }
    if (seen.size > 5000) seen.clear();
    return NextResponse.json({ result: "ok", ...out });
  } catch (e) {
    return NextResponse.json({ result: "error", message: e instanceof Error ? e.message.slice(0, 160) : "failed" }, { status: 400 });
  }
}
