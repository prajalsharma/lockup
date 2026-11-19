import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";

export const RPC = process.env.SOLANA_RPC ?? "https://rpc.magicblock.app/devnet";
export const TEE_RPC = process.env.TEE_RPC ?? "https://devnet-tee.magicblock.app";
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const VRF_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
export const YARD_ID = BigInt(process.env.YARD_ID ?? "2");
export const USD = 1_000_000n;
export const KEY_DIR = resolve(homedir(), ".lockup-keys");
export const YARD_FILE = resolve(process.cwd(), "apps/web/lib/chain/yard.json");

export const enc = (s: string) => Buffer.from(s, "utf8");
export const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const tx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.replace(/^~/, homedir()), "utf8"))));
}
/** A cached throwaway devnet wallet. Kept outside the repo. */
export function cachedKeypair(name: string): Keypair {
  mkdirSync(KEY_DIR, { recursive: true });
  const path = resolve(KEY_DIR, `${name}.json`);
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

export function loadIdl() {
  const idl = JSON.parse(readFileSync(resolve(process.cwd(), "target/idl/lockup.json"), "utf8")) as Idl & { address: string };
  return { idl, programId: new PublicKey(idl.address) };
}

export function programFor(idl: Idl, connection: Connection, kp: Keypair) {
  return new Program(idl, new AnchorProvider(connection, new Wallet(kp), { commitment: "confirmed" }));
}

/** An authenticated connection to the private rollup for one wallet. */
export async function teeConnection(kp: Keypair) {
  const auth = await getAuthToken(TEE_RPC, kp.publicKey, (m: Uint8Array) => Promise.resolve(nacl.sign.detached(m, kp.secretKey)));
  return new Connection(`${TEE_RPC}?token=${auth.token}`, {
    wsEndpoint: `${TEE_RPC.replace(/^http/, "ws")}?token=${auth.token}`,
    commitment: "confirmed",
  });
}

export function pdas(programId: PublicKey) {
  const [yard] = PublicKey.findProgramAddressSync([enc("yard"), u64(YARD_ID)], programId);
  const [vault] = PublicKey.findProgramAddressSync([enc("vault"), yard.toBuffer()], programId);
  return {
    yard, vault,
    warehouse: (mint: PublicKey) => PublicKey.findProgramAddressSync([enc("warehouse"), yard.toBuffer(), mint.toBuffer()], programId)[0],
    unit: (id: bigint) => PublicKey.findProgramAddressSync([enc("unit"), yard.toBuffer(), u64(id)], programId)[0],
    bidder: (unit: PublicKey, who: PublicKey) => PublicKey.findProgramAddressSync([enc("bidder"), unit.toBuffer(), who.toBuffer()], programId)[0],
    bid: (unit: PublicKey, who: PublicKey) => PublicKey.findProgramAddressSync([enc("bid"), unit.toBuffer(), who.toBuffer()], programId)[0],
    manifest: (unit: PublicKey) => PublicKey.findProgramAddressSync([enc("manifest"), unit.toBuffer()], programId)[0],
    tap: (who: PublicKey) => PublicKey.findProgramAddressSync([enc("tap"), yard.toBuffer(), who.toBuffer()], programId)[0],
  };
}

/** The catalog. Order matters: it is the item index used on chain. */
export const CATALOG = [
  { id: "cables", name: "Box of cables", value: 4, rarity: 0, group: 0, heavy: false },
  { id: "crt", name: "CRT television", value: 12, rarity: 0, group: 0, heavy: true },
  { id: "deck", name: "Cassette deck", value: 18, rarity: 0, group: 1, heavy: false },
  { id: "vinyl", name: "Crate of vinyl", value: 26, rarity: 0, group: 1, heavy: true },
  { id: "bike", name: "Road bike", value: 30, rarity: 0, group: 2, heavy: false },
  { id: "boards", name: "Skate decks", value: 22, rarity: 0, group: 2, heavy: false },
  { id: "binder", name: "Card binder", value: 55, rarity: 1, group: 5, heavy: false },
  { id: "jersey", name: "Signed jersey", value: 70, rarity: 1, group: 2, heavy: false },
  { id: "synth", name: "Analog synth", value: 95, rarity: 1, group: 1, heavy: false },
  { id: "cabinet", name: "Arcade cabinet", value: 120, rarity: 1, group: 3, heavy: true },
  { id: "pinball", name: "Pinball table", value: 240, rarity: 2, group: 3, heavy: true },
  { id: "bar", name: "Gold bar", value: 400, rarity: 2, group: 4, heavy: true },
];
export const WEIGHT = [50, 15, 3];
