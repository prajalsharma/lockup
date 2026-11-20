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
