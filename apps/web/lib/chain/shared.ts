/** Addresses and helpers used by the server keeper, the API and the browser client. */
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import yardFile from "./yard.json";

export const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.magicblock.app/devnet";
export const TEE_RPC = "https://devnet-tee.magicblock.app";
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const VRF_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export const PROGRAM = new PublicKey(yardFile.programId);
export const YARD = new PublicKey(yardFile.yard);
export const VAULT = new PublicKey(yardFile.vault);
export const BID_MINT = new PublicKey(yardFile.bidMint);
export const YARD_ID = BigInt(yardFile.yardId);
export const ITEMS = yardFile.items;
export const USD = 1_000_000;

const enc = (s: string) => Buffer.from(s, "utf8");
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];

export const unitPda = (id: number | bigint) => pda([enc("unit"), YARD.toBuffer(), u64(BigInt(id))]);
export const bidderPda = (unit: PublicKey, who: PublicKey) => pda([enc("bidder"), unit.toBuffer(), who.toBuffer()]);
export const bidPda = (unit: PublicKey, who: PublicKey) => pda([enc("bid"), unit.toBuffer(), who.toBuffer()]);
export const manifestPda = (unit: PublicKey) => pda([enc("manifest"), unit.toBuffer()]);
export const tapPda = (who: PublicKey) => pda([enc("tap"), YARD.toBuffer(), who.toBuffer()]);
export const warehousePda = (mint: PublicKey) => pda([enc("warehouse"), YARD.toBuffer(), mint.toBuffer()]);

export const listingPda = (seller: PublicKey, mint: PublicKey) => pda([enc("listing"), YARD.toBuffer(), seller.toBuffer(), mint.toBuffer()]);
export const stallPda = (listing: PublicKey) => pda([enc("stall"), listing.toBuffer()]);
export const poolPda = (mint: PublicKey) => pda([enc("pool"), YARD.toBuffer(), mint.toBuffer()]);
export const consignPda = (seller: PublicKey, mint: PublicKey) => pda([enc("consign"), YARD.toBuffer(), seller.toBuffer(), mint.toBuffer()]);
/** The yard buys any listing priced at or under this share of the appraisal and returns it to the pool. */
export const HOUSE_BUY_SHARE = 0.5;

/** A unit's mode is public on chain: multiplayer units run a longer clock than solo ones. */
export const SOLO_SECONDS = 75;
export const MULTI_SECONDS = 90;
/** How long a multiplayer unit waits for a second player before a house bidder takes the seat. */
export const MULTI_WAIT_SECONDS = 120;
/** How long the line stays open after the last player a multiplayer unit was waiting for joins. */
export const MULTI_LINE_SECONDS = 25;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * What the table may see of a bidder while bids are sealed. The program keeps it in the slot's
 * `bid` field until the unit closes: raises in the low 16 bits, locked in bit 16, and the second
 * of the last action (counted from the start of the bidding clock) in the high 32 bits.
 */
export function tellOf(bid: any): { raises: number; locked: boolean; lastAt: number } {
  return { raises: bid.maskn(16).toNumber(), locked: bid.testn(16), lastAt: bid.shrn(32).toNumber() };
}
/** A slot as the site shows it while bids are sealed: never an amount. */
export function seatOf(u: any, s: any): { raises: number; locked: boolean; lastAt: number | null } {
  const t = "bidding" in u.status && s.hasBid ? tellOf(s.bid) : null;
  return { raises: t?.raises ?? 0, locked: !!t?.locked, lastAt: t ? (Number(u.closesAt) - Number(u.duration) + t.lastAt) * 1000 : null };
}
/** A decoded unit account as the table the unit page shows. */
export function pulseOf(u: any) {
  return {
    status: Object.keys(u.status)[0] as "created" | "open" | "bidding" | "closed", stocked: u.stocked as boolean, closesAt: Number(u.closesAt) * 1000, bidCount: u.bidCount as number,
    bids: u.slots.map((sl: any) => ({ who: sl.bidder.toBase58() as string, hasBid: sl.hasBid as boolean, ...seatOf(u, sl) })),
    readAt: Date.now(),
  };
}
