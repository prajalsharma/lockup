/**
 * The yard keeper. One call to `tick()` looks at every recent unit and pushes each one a
 * step forward: draw, house bidders, start + delegate, stock, house bids, close, commit,
 * settle, claim, and keeping a few units open. It holds no state between calls: everything
 * is read from the chain, and the salt for a unit is derived from the keeper secret, so any
 * instance can pick up where another left off. Repeated or overlapping calls are harmless;
 * a step that was already done simply fails its on-chain check.
 *
 * House bidders see only the public clues when they bid. The keeper knows the salt, so that
 * rule is enforced here in code, not by the chain. The site says so.
 */
import { createHash, createHmac } from "node:crypto";
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID, getAuthToken, permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import idl from "./idl.json";
import {
  BID_MINT, DELEGATION_PROGRAM, ITEMS, PROGRAM, RPC, TEE_RPC, TEE_VALIDATOR, USD, VAULT, VRF_QUEUE, YARD,
  HOUSE_BUY_SHARE, MULTI_LINE_SECONDS, MULTI_SECONDS, MULTI_WAIT_SECONDS, SOLO_SECONDS, bidPda, bidderPda, manifestPda, stallPda, unitPda, warehousePda,
} from "./shared";

const TARGET_SOLO = 2; // solo units kept waiting: you against two house bidders
const TARGET_MULTI = 1; // multiplayer units kept waiting: players only
/** How far back the keeper and the site look. A unit left waiting keeps its place however many newer ones are made. */
export const WINDOW = 60;
/** Units that are completely finished: settled and claimed. Nothing more can happen to them, so they are skipped. */
const finished = new Set<number>();
const LINE_SECONDS = 15; // wait after the first player joins before the door locks
// Stakes are in Circle devnet USDC and deliberately small: the whole yard runs on a float of about 20 USDC.
const MIN_BID = 0.1 * USD;
const HOUSE_DEPOSIT = 1.2 * USD;
const HOUSE_REFILL = 2.4 * USD;
const STARTER_USDC = 1 * USD;
const DRIP_LAMPORTS = 0.02 * LAMPORTS_PER_SOL;
const perm = { permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID };

export interface Keeper {
  keeper: Keypair;
  house: Keypair[];
  secret: Buffer;
}

export function loadKeeper(raw = process.env.KEEPER_SECRET): Keeper | null {
  if (!raw) return null;
  const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const secret = Buffer.from(keeper.secretKey);
  const house = [1, 2].map((n) => Keypair.fromSeed(createHmac("sha256", secret).update(`house-${n}`).digest()));
  return { keeper, house, secret };
}

export const saltFor = (k: Keeper, unit: PublicKey) => createHmac("sha256", k.secret).update("salt").update(unit.toBuffer()).digest();

const connection = new Connection(RPC, "confirmed");
/** Keypair wallet. Anchor's own `Wallet` is Node-only and missing from the bundled build. */
function walletOf(kp: Keypair) {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]); else tx.partialSign(kp);
    return tx;
  };
  return { publicKey: kp.publicKey, payer: kp, signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => sign(tx), signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs.map(sign) };
}
const prog = (conn: Connection, kp: Keypair) => new Program(idl as Idl, new AnchorProvider(conn, walletOf(kp) as any, { commitment: "confirmed" }));

const tokens = new Map<string, { conn: Connection; at: number }>();
/** Authenticated private-rollup connection for a wallet, cached for ten minutes. */
export async function tee(kp: Keypair): Promise<Connection> {
  const key = kp.publicKey.toBase58();
  const hit = tokens.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.conn;
  const auth = await getAuthToken(TEE_RPC, kp.publicKey, (m: Uint8Array) => Promise.resolve(nacl.sign.detached(m, kp.secretKey)));
  const conn = new Connection(`${TEE_RPC}?token=${auth.token}`, { commitment: "confirmed" });
  tokens.set(key, { conn, at: Date.now() });
  return conn;
}

export interface UnitView {
  id: number;
  key: PublicKey;
  onRollup: boolean;
  /** Freshest state: from the rollup while delegated, from Solana otherwise. */
  u: any;
}

/** Read the newest units, following delegated ones onto the rollup. */
export async function readUnits(k: Keeper | null, limit = WINDOW): Promise<{ yard: any; units: UnitView[] }> {
  const p = prog(connection, k?.keeper ?? Keypair.generate());
  const yard = await (p.account as any).yard.fetch(YARD);
  const count = Number(yard.unitCount);
  const ids = Array.from({ length: Math.min(count, limit) }, (_, i) => count - i);
  const keys = ids.map((id) => unitPda(id));
  const infos = keys.length ? await connection.getMultipleAccountsInfo(keys) : [];
  const units: UnitView[] = [];
  let teeProg: Program | null = null;
  for (const [i, info] of infos.entries()) {
    if (!info) continue;
    const onRollup = info.owner.equals(DELEGATION_PROGRAM);
    let u: any;
    try {
      if (onRollup && k) {
        teeProg ??= prog(await tee(k.keeper), k.keeper);
        u = await (teeProg.account as any).unit.fetch(keys[i]);
      } else {
        u = p.coder.accounts.decode("unit", info.data);
      }
    } catch {
      try { u = p.coder.accounts.decode("unit", info.data); } catch { continue; }
    }
    units.push({ id: ids[i], key: keys[i], onRollup, u });
  }
  return { yard, units };
}

const status = (u: any) => Object.keys(u.status)[0] as "created" | "open" | "bidding" | "closed";
const isMulti = (u: any) => Number(u.duration) >= MULTI_SECONDS;
const isHouse = (k: Keeper, who: PublicKey) => k.house.some((h) => h.publicKey.equals(who));

/** What a house bidder offers, using nothing but the three public clues. */
function houseBid(unit: PublicKey, n: number, clues: { kind: number; arg: number }[]): number {
  // Item values and clue amounts are in cents.
  let est = 55;
  for (const c of clues) {
    if (c.kind === 0) est = Math.max(est, c.arg * 22);
    if (c.kind === 2) est = Math.max(est, c.arg * 1.9);
    if (c.kind === 3 && c.arg) est += 140;
    if (c.kind === 4) est += c.arg * 14;
  }
  const r = createHash("sha256").update(unit.toBuffer()).update(`nerve-${n}`).digest().readUInt16LE(0) / 65535;
  const cents = Math.round(est * (0.4 + r * 0.4));
  return Math.min(HOUSE_DEPOSIT, Math.max(MIN_BID, cents * (USD / 100)));
}

export interface TickReport { did: string[]; errors: string[]; ms: number }
let running = false;
let lastEnd = 0;

export async function tick(k: Keeper, budgetMs = 40_000): Promise<TickReport> {
  const started = Date.now();
  const report: TickReport = { did: [], errors: [], ms: 0 };
  if (running || started - lastEnd < 1500) return report;
  running = true;
  const left = () => budgetMs - (Date.now() - started);
  const step = async (name: string, f: () => Promise<unknown>) => {
    if (left() < 6000) return false;
    try { await f(); report.did.push(name); return true; } catch (e) {
      report.errors.push(`${name}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 160)}`);
      return false;
    }
  };
  try {
    const p = prog(connection, k.keeper);
    const treasury = getAssociatedTokenAddressSync(BID_MINT, k.keeper.publicKey);
    const { yard, units } = await readUnits(k);
    const now = Math.floor(Date.now() / 1000);
    const waiting = { solo: 0, multi: 0 };

    // Oldest unfinished first, so a round in progress is never starved by newer units.
    const queue = units.filter((x) => !finished.has(x.id)).sort((a, b) => Number(status(a.u) === "closed") - Number(status(b.u) === "closed") || a.id - b.id);
    for (const { id, key, onRollup, u } of queue) {
      const st = status(u);

      if (st === "created") {
        waiting[isMulti(u) ? "multi" : "solo"]++;
        // The draw is requested with creation; ask again only if it has clearly gone missing.
        continue;
      }

      if (st === "open") {
        const multi = isMulti(u);
        const humans = u.slots.filter((s: any) => !isHouse(k, s.bidder));
        if (!humans.length) waiting[multi ? "multi" : "solo"]++;
        // When each player joined, read from their records on Solana.
        const joined: number[] = [];
        for (const h of humans) {
          const rec = await (p.account as any).bidder.fetch(bidderPda(key, h.bidder)).catch(() => null);
          if (rec) joined.push(Number(rec.joinedAt));
        }
        const first = joined.length ? Math.min(...joined) : 0;
        const last = joined.length ? Math.max(...joined) : 0;
        // Solo: two house bidders are always in line. Multiplayer: players only, unless one
        // player has waited alone too long, in which case a single house bidder takes the seat.
        const seats = !multi ? k.house : humans.length === 1 && first && now - first >= MULTI_WAIT_SECONDS ? k.house.slice(0, 1) : [];
        for (const [n, h] of seats.entries()) {
          if (u.slots.some((s: any) => s.bidder.equals(h.publicKey))) continue;
          const ata = getAssociatedTokenAddressSync(BID_MINT, h.publicKey);
          await step(`house ${n + 1} joins unit ${id}`, async () => {
            const hp = prog(connection, h);
            if ((await connection.getBalance(h.publicKey)) < 0.01 * LAMPORTS_PER_SOL) {
              await p.provider.sendAndConfirm!(new Transaction().add(SystemProgram.transfer({ fromPubkey: k.keeper.publicKey, toPubkey: h.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })));
            }
            const bal = await connection.getTokenAccountBalance(ata).then((b) => Number(b.value.amount), () => 0);
            if (bal < HOUSE_DEPOSIT) {
              // House bidders are funded from the keeper's own USDC, where winning bids are paid.
              await p.provider.sendAndConfirm!(new Transaction().add(
                createAssociatedTokenAccountIdempotentInstruction(k.keeper.publicKey, ata, h.publicKey, BID_MINT),
                createTransferInstruction(treasury, ata, k.keeper.publicKey, HOUSE_REFILL),
              ));
            }
            await hp.methods.joinUnit(new BN(HOUSE_DEPOSIT))
              .accountsPartial({ bidder: h.publicKey, yard: YARD, unit: key, bidderRecord: bidderPda(key, h.publicKey), bidderTokenAccount: ata, vault: VAULT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
              .rpc();
          });
        }
        const houseIn = u.slots.length - humans.length;
        const full = u.slots.length >= 8;
        const ready = !multi
          ? first > 0 && now - first >= LINE_SECONDS
          : humans.length >= 2 ? now - last >= MULTI_LINE_SECONDS : humans.length === 1 && houseIn > 0;
        if (humans.length && (full || ready)) {
          await step(`start + delegate unit ${id}`, async () => {
            const del = await p.methods.delegateUnit(new BN(id)).accountsPartial({ authority: k.keeper.publicKey, yard: YARD, unit: key, validator: TEE_VALIDATOR }).instruction();
            await p.methods.startUnit().accountsPartial({ authority: k.keeper.publicKey, unit: key }).postInstructions([del]).rpc();
          });
        }
        continue;
      }

      if (st === "bidding" && !onRollup) {
        // Started but the delegation did not land. Finish it.
        await step(`delegate unit ${id}`, () => p.methods.delegateUnit(new BN(id)).accountsPartial({ authority: k.keeper.publicKey, yard: YARD, unit: key, validator: TEE_VALIDATOR }).rpc());
        continue;
      }

      if (st === "bidding" && onRollup) {
        const tp = prog(await tee(k.keeper), k.keeper);
        const manifest = manifestPda(key);
        if (!u.stocked) {
          await step(`permission unit ${id}`, () => tp.methods.initUnitPermission().accountsPartial({ unit: key, permission: permissionPdaFromAccount(key), ...perm }).rpc());
          await step(`stock unit ${id}`, async () => {
            const seal = await tp.methods.sealManifest().accountsPartial({ unit: key, manifest, permission: permissionPdaFromAccount(manifest), ...perm }).instruction();
            await tp.methods.stockUnit([...saltFor(k, key)]).accountsPartial({ authority: k.keeper.publicKey, unit: key, manifest }).postInstructions([seal]).rpc();
          });
          continue;
        }
        if (now < Number(u.closesAt)) {
          for (const [n, h] of k.house.entries()) {
            const slot = u.slots.find((s: any) => s.bidder.equals(h.publicKey));
            if (!slot || slot.hasBid) continue;
            await step(`house ${n + 1} bids on unit ${id}`, async () => {
              const hp = prog(await tee(h), h);
              const bid = bidPda(key, h.publicKey);
              const seal = await hp.methods.sealBid().accountsPartial({ unit: key, bid, permission: permissionPdaFromAccount(bid), ...perm }).instruction();
              await hp.methods.placeBid(new BN(houseBid(key, n, u.clues))).accountsPartial({ bidder: h.publicKey, unit: key, bid }).postInstructions([seal]).rpc();
            });
          }
          continue;
        }
        if (now >= Number(u.closesAt) + 1) {
          const bids = u.slots.filter((s: any) => s.hasBid).map((s: any) => bidPda(key, s.bidder));
          const ok = await step(`close unit ${id}`, () => tp.methods.closeUnit().accountsPartial({ authority: k.keeper.publicKey, unit: key })
            .remainingAccounts([manifest, ...bids].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc());
          if (ok) await step(`commit unit ${id}`, () => tp.methods.commitUnit().accountsPartial({ payer: k.keeper.publicKey, authority: k.keeper.publicKey, unit: key, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID }).rpc({ skipPreflight: true }));
        }
        continue;
      }

      if (st === "closed" && onRollup) {
        // Closed on the rollup but not yet back on Solana: (re)send the commit.
        const tp = prog(await tee(k.keeper), k.keeper);
        await step(`commit unit ${id}`, () => tp.methods.commitUnit().accountsPartial({ payer: k.keeper.publicKey, authority: k.keeper.publicKey, unit: key, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID }).rpc({ skipPreflight: true }));
        continue;
      }

      if (st === "closed") {
        const hasWinner = !u.winner.equals(PublicKey.default);
        const allClaimed = !hasWinner || u.claimedMask === (1 << u.lots.length) - 1;
        const records = await (p.account as any).bidder.fetchMultiple(u.slots.map((s: any) => bidderPda(key, s.bidder)));
        const unsettled = u.slots.filter((_: any, i: number) => records[i] && !records[i].settled);
        if (!unsettled.length && allClaimed) { finished.add(id); continue; }
        for (const s of unsettled) {
          await step(`settle ${s.bidder.toBase58().slice(0, 4)} on unit ${id}`, () => p.methods.settleBidder()
            .accountsPartial({ crank: k.keeper.publicKey, yard: YARD, unit: key, bidderRecord: bidderPda(key, s.bidder), bidderTokenAccount: getAssociatedTokenAddressSync(BID_MINT, s.bidder), vault: VAULT, treasury, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
        }
        if (hasWinner && !allClaimed) {
          const winnerIndex = u.slots.findIndex((s: any) => s.bidder.equals(u.winner));
          const paid = records[winnerIndex]?.won || !unsettled.some((s: any) => s.bidder.equals(u.winner)) || report.did.some((d) => d.startsWith(`settle ${u.winner.toBase58().slice(0, 4)}`));
          if (paid) {
            for (const [i, lot] of u.lots.entries()) {
              if (u.claimedMask & (1 << i)) continue;
              const mint = yard.catalog[lot.item].mint as PublicKey;
              const ata = getAssociatedTokenAddressSync(mint, u.winner);
              await step(`send ${lot.qty}x ${ITEMS[lot.item].name} from unit ${id}`, () => p.methods.claimLot(i)
                .accountsPartial({ crank: k.keeper.publicKey, yard: YARD, unit: key, bidderRecord: bidderPda(key, u.winner), itemMint: mint, warehouse: warehousePda(mint), winnerTokenAccount: ata, tokenProgram: TOKEN_PROGRAM_ID })
                .preInstructions([createAssociatedTokenAccountIdempotentInstruction(k.keeper.publicKey, ata, u.winner, mint)]).rpc());
            }
          }
        }
      }
    }

    // Keep a few doors waiting for players.
    const want = waiting.solo < TARGET_SOLO ? SOLO_SECONDS : waiting.multi < TARGET_MULTI ? MULTI_SECONDS : 0;
    if (want) {
      const id = Number(yard.unitCount) + 1;
      const key = unitPda(id);
      const commit = createHash("sha256").update(saltFor(k, key)).digest();
      await step(`create ${want === MULTI_SECONDS ? "multiplayer" : "solo"} unit ${id} + request draw`, async () => {
        const draw = await p.methods.requestDraw().accountsPartial({ authority: k.keeper.publicKey, unit: key, oracleQueue: VRF_QUEUE }).instruction();
        await p.methods.createUnit(new BN(id), new BN(want), new BN(MIN_BID), [...commit])
          .accountsPartial({ authority: k.keeper.publicKey, yard: YARD, unit: key, systemProgram: SystemProgram.programId }).postInstructions([draw]).rpc();
      });
    }

    // The yard buys cheap listings and puts the items back in the warehouse future units are stocked from.
    const offers = await readListings();
    const cheap = offers.find((l) => !l.seller.equals(k.keeper.publicKey) && l.price <= l.value * HOUSE_BUY_SHARE);
    if (cheap) {
      const float = await connection.getTokenAccountBalance(treasury).then((b) => Number(b.value.amount), () => 0);
      const qty = Math.min(cheap.qty, 3);
      if (float >= 3 * USD + cheap.price * qty) {
        await step(`house buys ${qty} from ${cheap.key.toBase58().slice(0, 6)}`, async () => {
          const ata = getAssociatedTokenAddressSync(cheap.mint, k.keeper.publicKey);
          await p.methods.buyItem(new BN(qty), new BN(cheap.price))
            .accountsPartial({ buyer: k.keeper.publicKey, yard: YARD, listing: cheap.key, seller: cheap.seller, stall: stallPda(cheap.key), buyerTokenAccount: treasury, sellerTokenAccount: getAssociatedTokenAddressSync(BID_MINT, cheap.seller), buyerItemAccount: ata, tokenProgram: TOKEN_PROGRAM_ID })
            .preInstructions([createAssociatedTokenAccountIdempotentInstruction(k.keeper.publicKey, ata, k.keeper.publicKey, cheap.mint)])
            .postInstructions([createTransferInstruction(ata, warehousePda(cheap.mint), k.keeper.publicKey, qty)]).rpc();
        });
      }
    }
  } catch (e) {
    report.errors.push(`tick: ${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200)}`);
  } finally {
    running = false;
    lastEnd = Date.now();
    report.ms = Date.now() - started;
  }
  return report;
}

let lastDrip = 0;
export interface DripResult { sol: "sent" | "has" | "empty" | "busy" | "limit"; usdc: "sent" | "has" | "empty" | "busy" | "already" | "limit" }

// Starter funds are rationed, and the ration lives on chain so every server instance agrees.
//
// USDC: each starter transaction also creates one tiny "hour slot" account and one "day slot"
// account at addresses derived from the current hour and day. Creating an account that already
// exists fails, and that fails the whole transaction, so two requests racing for the same slot
// cannot both be paid. When every slot of the hour or day is taken, nothing more goes out.
//
// SOL: starter SOL is small, so it is counted from the recent transactions of a marker address.
const USDC_PER_HOUR = Number(process.env.DRIP_USDC_PER_HOUR ?? 8);
const USDC_PER_DAY = Number(process.env.DRIP_USDC_PER_DAY ?? 24);
const SOL_PER_HOUR = Number(process.env.DRIP_SOL_PER_HOUR ?? 16);
const SOL_PER_DAY = Number(process.env.DRIP_SOL_PER_DAY ?? 48);
const SLOT_RENT = 890_880; // rent-exempt minimum for an empty account
const slotKeys = (k: Keeper, seeds: string[]) => Promise.all(seeds.map((seed) => PublicKey.createWithSeed(k.keeper.publicKey, seed, SystemProgram.programId)));
const takeSlot = (k: Keeper, seed: string, key: PublicKey) => SystemProgram.createAccountWithSeed({ fromPubkey: k.keeper.publicKey, basePubkey: k.keeper.publicKey, newAccountPubkey: key, seed, lamports: SLOT_RENT, space: 0, programId: SystemProgram.programId });
/** The first free hour slot and day slot, or null when the ration for either is used up. */
async function freeSlots(k: Keeper) {
  const now = Math.floor(Date.now() / 1000);
  const hours = Array.from({ length: USDC_PER_HOUR }, (_, i) => `h${Math.floor(now / 3600)}-${i}`);
  const days = Array.from({ length: USDC_PER_DAY }, (_, i) => `d${Math.floor(now / 86400)}-${i}`);
  const keys = await slotKeys(k, [...hours, ...days]);
  const infos = await connection.getMultipleAccountsInfo(keys);
  // A random free slot, so two honest requests in the same second rarely pick the same one.
  const pick = (free: number[]) => (free.length ? free[Math.floor(Math.random() * free.length)] : -1);
  const h = pick(hours.map((_, i) => i).filter((i) => !infos[i]));
  const d = pick(days.map((_, i) => i).filter((i) => !infos[hours.length + i]));
  if (h < 0 || d < 0) return null;
  return [takeSlot(k, hours[h], keys[h]), takeSlot(k, days[d], keys[hours.length + d])];
}
const marker = (k: Keeper, what: string) => Keypair.fromSeed(createHmac("sha256", k.secret).update(`starter-${what}`).digest()).publicKey;
const mark = (k: Keeper, what: string) => SystemProgram.transfer({ fromPubkey: k.keeper.publicKey, toPubkey: marker(k, what), lamports: 0 });
async function sentSince(k: Keeper, what: string, seconds: number[]): Promise<number[]> {
  const sigs = await connection.getSignaturesForAddress(marker(k, what), { limit: 100 });
  const now = Date.now() / 1000;
  return seconds.map((s) => sigs.filter((x) => !x.err && (x.blockTime ?? now) > now - s).length);
}

/**
 * Starter funds for a new player: a little devnet SOL for fees and 1 USDC to bid with.
 * SOL goes to any wallet that has none. USDC goes only to a wallet that has never held a USDC
 * account, so each wallet gets it once; after that, more comes from Circle's faucet.
 * Both are capped per hour, and USDC per day, across all visitors.
 */
export async function drip(k: Keeper, to: PublicKey): Promise<DripResult> {
  if (Date.now() - lastDrip < 6000) return { sol: "busy", usdc: "busy" };
  const treasury = getAssociatedTokenAddressSync(BID_MINT, k.keeper.publicKey);
  const ata = getAssociatedTokenAddressSync(BID_MINT, to);
  const [theirs, ours, theirAta, float] = await Promise.all([
    connection.getBalance(to), connection.getBalance(k.keeper.publicKey), connection.getAccountInfo(ata),
    connection.getTokenAccountBalance(treasury).then((b) => Number(b.value.amount), () => 0),
  ]);
  const tx = new Transaction();
  const out: DripResult = { sol: "has", usdc: theirAta ? "already" : "has" };
  if (theirs < 0.01 * LAMPORTS_PER_SOL) {
    if (ours < 0.15 * LAMPORTS_PER_SOL) out.sol = "empty";
    else {
      const [hour, day] = await sentSince(k, "sol", [3600, 86400]);
      if (hour >= SOL_PER_HOUR || day >= SOL_PER_DAY) out.sol = "limit";
      else { tx.add(SystemProgram.transfer({ fromPubkey: k.keeper.publicKey, toPubkey: to, lamports: DRIP_LAMPORTS }), mark(k, "sol")); out.sol = "sent"; }
    }
  }
  if (!theirAta) {
    // USDC is no use to a wallet that can't pay fees, so it only goes out alongside or after SOL.
    if (out.sol === "limit" || out.sol === "empty") out.usdc = "limit";
    // Keep enough back to fund the house bidders.
    else if (float < 3 * USD) out.usdc = "empty";
    else {
      const slots = await freeSlots(k);
      if (!slots) out.usdc = "limit";
      else {
        tx.add(...slots, createAssociatedTokenAccountIdempotentInstruction(k.keeper.publicKey, ata, to, BID_MINT), createTransferInstruction(treasury, ata, k.keeper.publicKey, STARTER_USDC));
        out.usdc = "sent";
      }
    }
  }
  if (tx.instructions.length) {
    lastDrip = Date.now();
    try { await prog(connection, k.keeper).provider.sendAndConfirm!(tx); } catch (e) {
      // With a slot in the transaction, a failure almost always means someone else took the same
      // slot in the same moment. Nothing was sent; the caller can ask again.
      if (out.usdc === "sent") return { sol: "busy", usdc: "busy" };
      throw e;
    }
  }
  return out;
}

export interface ListingView { key: PublicKey; seller: PublicKey; mint: PublicKey; item: number; price: number; qty: number; /** Appraised value of one item, in the bid currency's smallest unit. */ value: number }
const LISTING_SIZE = 121; // 8 discriminator + yard 32 + seller 32 + mint 32 + price 8 + qty 8 + bump 1
/** Every open resale listing in this yard. */
export async function readListings(): Promise<ListingView[]> {
  const coder = prog(connection, Keypair.generate()).coder.accounts;
  const found = await connection.getProgramAccounts(PROGRAM, { filters: [{ dataSize: LISTING_SIZE }, { memcmp: { offset: 8, bytes: YARD.toBase58() } }] });
  const out: ListingView[] = [];
  for (const a of found) {
    let l: any;
    try { l = coder.decode("listing", a.account.data); } catch { continue; }
    const item = ITEMS.findIndex((i) => i.mint === l.mint.toBase58());
    if (item < 0) continue;
    out.push({ key: a.pubkey, seller: l.seller, mint: l.mint, item, price: Number(l.price), qty: Number(l.qty), value: (ITEMS[item].value * USD) / 100 });
  }
  return out.sort((a, b) => a.price / a.value - b.price / b.value);
}
