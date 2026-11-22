/**
 * Drive one complete unit end to end on devnet and report what actually worked.
 *
 *     pnpm round
 *
 * Solana:  create_unit, request_draw (VRF), join x2, start, delegate
 * Rollup:  permission, stock + seal, bid + seal x2, privacy checks, close, commit
 * Solana:  settle x2, claim every lot
 */
import { createHash, randomBytes } from "node:crypto";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID, permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  CATALOG, RPC, TEE_VALIDATOR, USD, VRF_QUEUE, cachedKeypair, loadIdl, loadKeypair, pdas, programFor, sleep, teeConnection, tx,
} from "./lib";

const DURATION = Number(process.env.DURATION ?? 45);
const CENT = USD / 100n;
const MIN_BID = 10n * CENT;
const PLAN = [
  { label: "A", deposit: 100n * CENT, bid: 60n * CENT },
  { label: "B", deposit: 80n * CENT, bid: 45n * CENT },
];
const results: { step: string; ok: boolean; note?: string }[] = [];
const record = (step: string, ok: boolean, note?: string) => {
  results.push({ step, ok, note });
  console.log(`  ${ok ? "✓" : "✗"} ${step}${note ? `  ${note}` : ""}`);
};
const head = (s: string) => console.log(`\n▸ ${s}`);
const msg = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));
const perm = { permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID };

async function retry<T>(f: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); } catch (e) {
      if (i >= tries - 1 || !/429|Too Many|blockhash|timed out|not confirmed|fetch failed/i.test(String(e))) throw e;
      await sleep(2500 * (i + 1));
    }
  }
}

async function main() {
  const { idl, programId } = loadIdl();
  const operator = loadKeypair(process.env.LOCKUP_AUTHORITY ?? "~/.lockup-keys/keeper.json");
  const wallets: Keypair[] = [cachedKeypair("bidder-a"), cachedKeypair("bidder-b")];
  const connection = new Connection(RPC, "confirmed");
  const program = programFor(idl, connection, operator);
  const p = pdas(programId);
  const yard = await (program.account as any).yard.fetch(p.yard);
  const bidMint = yard.bidMint as PublicKey;
  const unitId = BigInt(process.env.UNIT_ID ?? (BigInt(yard.unitCount.toString()) + 1n).toString());
  const unit = p.unit(unitId);
  const salt = randomBytes(32);
  const commit = createHash("sha256").update(salt).digest();

  console.log("LOCKUP round", { program: programId.toBase58(), unit: unit.toBase58(), unitId: Number(unitId), operator: operator.publicKey.toBase58() });

  const treasury = getAssociatedTokenAddressSync(bidMint, operator.publicKey);
  head("Solana: fund bidders");
  const atas: PublicKey[] = [];
  for (const [i, kp] of wallets.entries()) {
    if ((await connection.getBalance(kp.publicKey)) < 0.03 * LAMPORTS_PER_SOL) {
      await retry(() => program.provider.sendAndConfirm!(new Transaction().add(SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: kp.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL }))));
    }
    const ata = await retry(() => getOrCreateAssociatedTokenAccount(connection, operator, bidMint, kp.publicKey));
    atas.push(ata.address);
    if (BigInt(ata.amount.toString()) < PLAN[i].deposit) {
      // Bidders are funded with devnet USDC from the operator.
      try {
        await retry(() => transfer(connection, operator, treasury, ata.address, operator, PLAN[i].deposit));
        record(`fund ${PLAN[i].label} with USDC`, true);
      } catch (e) { record(`fund ${PLAN[i].label} with USDC`, false, msg(e)); }
    }
    await sleep(800);
  }

  head("Solana: create unit, line up");
  let sig = await retry(() => program.methods.createUnit(new BN(unitId.toString()), new BN(DURATION), new BN(MIN_BID.toString()), [...commit])
    .accountsPartial({ authority: operator.publicKey, yard: p.yard, unit, systemProgram: SystemProgram.programId }).rpc());
  record("create_unit", true, tx(sig));
  let fresh = await (program.account as any).unit.fetch(unit);
  record("no draw exists while the line is open", fresh.randomness.every((b: number) => b === 0) && "open" in fresh.status);
  for (const [i, kp] of wallets.entries()) {
    sig = await retry(() => programFor(idl, connection, kp).methods.joinUnit(new BN(PLAN[i].deposit.toString()))
      .accountsPartial({ bidder: kp.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, kp.publicKey), bidderTokenAccount: atas[i], vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc());
    record(`join_unit ${PLAN[i].label}`, true);
    await sleep(800);
  }
  try {
    await program.methods.delegateUnit(new BN(unitId.toString())).accountsPartial({ authority: operator.publicKey, yard: p.yard, unit, validator: TEE_VALIDATOR }).rpc();
    record("the unit cannot leave for the rollup before its line is locked", false, "it went through");
  } catch { record("the unit cannot leave for the rollup before its line is locked", true); }

  head("Solana: lock the line, VRF draw, delegate");
  sig = await retry(() => program.methods.startUnit().accountsPartial({ authority: operator.publicKey, unit, oracleQueue: VRF_QUEUE }).rpc());
  record("start_unit (locks the line and requests the draw)", true, tx(sig));
  try {
    const late = Keypair.generate();
    await programFor(idl, connection, wallets[0]).methods.joinUnit(new BN(PLAN[0].deposit.toString()))
      .accountsPartial({ bidder: wallets[0].publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, late.publicKey), bidderTokenAccount: atas[0], vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
    record("nobody can join after the lock", false, "it went through");
  } catch { record("nobody can join after the lock", true); }
  let drawn = false;
  const asked = Date.now();
  for (let i = 0; i < 40 && !drawn; i++) {
    await sleep(1500);
    fresh = await retry(() => (program.account as any).unit.fetch(unit));
    drawn = !fresh.randomness.every((b: number) => b === 0);
  }
  record("VRF callback arrived after the lock", drawn, `${((Date.now() - asked) / 1000).toFixed(1)} s`);
  if (!drawn) return finish();
  try {
    await program.methods.requestDraw().accountsPartial({ authority: operator.publicKey, unit, oracleQueue: VRF_QUEUE }).rpc();
    record("a second draw is refused", false, "it went through");
  } catch (e) { record("a second draw is refused", /AlreadyDrawn/.test(String((e as any)?.message ?? e)), /Error Code: (\w+)/.exec(String((e as any)?.message ?? e))?.[1] ?? ""); }
  try {
    await program.methods.delegateUnit(new BN(unitId.toString())).accountsPartial({ authority: operator.publicKey, yard: p.yard, unit, validator: Keypair.generate().publicKey }).rpc();
    record("delegating to any validator but MagicBlock's private one is refused", false, "it went through");
  } catch { record("delegating to any validator but MagicBlock's private one is refused", true); }
  sig = await retry(() => program.methods.delegateUnit(new BN(unitId.toString()))
    .accountsPartial({ authority: operator.publicKey, yard: p.yard, unit, validator: TEE_VALIDATOR }).rpc());
  record("delegate_unit", true, tx(sig));
  await sleep(5000);

  head("Private rollup: stock, bid, check privacy");
  const teeOp = programFor(idl, await teeConnection(operator), operator);
  const teeBidders = await Promise.all(wallets.map(async (kp) => programFor(idl, await teeConnection(kp), kp)));
  record("TEE sessions opened", true);

  try {
    await teeOp.methods.initUnitPermission().accountsPartial({ unit, permission: permissionPdaFromAccount(unit), ...perm }).rpc();
    record("init_unit_permission", true);
  } catch (e) { record("init_unit_permission", false, msg(e)); }

  const manifest = p.manifest(unit);
  let stockSig = "";
  const bidSigs: string[] = [];
  try {
    const seal = await teeOp.methods.sealManifest().accountsPartial({ unit, manifest, permission: permissionPdaFromAccount(manifest), ...perm }).instruction();
    stockSig = await teeOp.methods.stockUnit([...salt]).accountsPartial({ authority: operator.publicKey, unit, manifest }).postInstructions([seal]).rpc();
    record("stock_unit + seal_manifest", true);
  } catch (e) { record("stock_unit + seal_manifest", false, msg(e)); logs(e); return finish(); }

  let u = await (teeOp.account as any).unit.fetch(unit);
  console.log("    clues:", u.clues.map((c: any) => `${c.kind}:${c.arg}`).join("  "));

  for (const [i, kp] of wallets.entries()) {
    const bid = p.bid(unit, kp.publicKey);
    try {
      const seal = await teeBidders[i].methods.sealBid().accountsPartial({ unit, bid, permission: permissionPdaFromAccount(bid), ...perm }).instruction();
      const sent = Date.now();
      bidSigs[i] = await teeBidders[i].methods.placeBid(new BN(PLAN[i].bid.toString())).accountsPartial({ bidder: kp.publicKey, unit, bid }).postInstructions([seal]).rpc();
      // Wall-clock time from sending the sealed bid to the rollup confirming it, network included.
      record(`place_bid + seal_bid ${PLAN[i].label}`, true, `confirmed in ${Date.now() - sent} ms`);
    } catch (e) { record(`place_bid + seal_bid ${PLAN[i].label}`, false, msg(e)); logs(e); }
  }

  // Privacy: who can read what on the rollup?
  const canRead = async (prog: any, kind: "bid" | "manifest", key: PublicKey) => {
    try { const a = await prog.provider.connection.getAccountInfo(key); return !!a && a.data.length > 0; } catch { return false; }
  };
  const bidA = p.bid(unit, wallets[0].publicKey);
  record("bidder A can read own bid", await canRead(teeBidders[0], "bid", bidA));
  record("bidder B cannot read A's bid", !(await canRead(teeBidders[1], "bid", bidA)));
  record("operator cannot read A's bid", !(await canRead(teeOp, "bid", bidA)));
  record("bidder cannot read the manifest", !(await canRead(teeBidders[0], "manifest", manifest)));
  record("bid is not visible on Solana", !(await connection.getAccountInfo(bidA)));

  // The bid amount and the salt travel as instruction data. Can anyone pull them back out of
  // the rollup's transaction history?
  const leak = async (prog: any, sig: string, secret: Buffer) => {
    const conn: Connection = prog.provider.connection;
    const found: string[] = [];
    try {
      const t: any = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (t) { found.push("getTransaction returned it");
        const ixs = t.transaction?.message?.compiledInstructions ?? t.transaction?.message?.instructions ?? [];
        found.push(`${ixs.length} instructions, data bytes ${ixs.map((ix: any) => (ix.data?.length ?? 0)).join("/")}, ${(t.transaction?.message?.staticAccountKeys ?? t.transaction?.message?.accountKeys ?? []).length} account keys, ${(t.meta?.logMessages ?? []).length} log lines`); if (JSON.stringify(t).includes(secret.toString("base64")) || Buffer.from(t.transaction?.message?.serialize?.() ?? []).includes(secret) || JSON.stringify(t.transaction?.message ?? {}).length > 0 && (t.transaction?.message?.compiledInstructions ?? t.transaction?.message?.instructions ?? []).some((ix: any) => Buffer.from(ix.data?.type ? ix.data.data : typeof ix.data === "string" ? require("bs58").decode(ix.data) : ix.data ?? []).includes(secret))) found.push("SECRET IN DATA"); }
    } catch { /* refused */ }
    try { const sigs = await conn.getSignaturesForAddress(unit, { limit: 20 }); if (sigs.length) found.push(`history lists ${sigs.length} tx`); } catch { /* refused */ }
    return found;
  };
  const amountA = Buffer.alloc(8); amountA.writeBigUInt64LE(PLAN[0].bid);
  const views: [string, any][] = [["bidder A (its own bid)", teeBidders[0]], ["bidder B", teeBidders[1]], ["operator", teeOp]];
  for (const [who, prog] of views) {
    const got = await leak(prog, bidSigs[0], amountA);
    console.log(`    ${who} asks for A's bid transaction: ${got.join("; ") || "nothing readable"}`);
    if (who !== "bidder A (its own bid)") record(`${who} cannot read A's bid amount from the transaction`, !got.includes("SECRET IN DATA"));
  }
  for (const [who, prog] of views.slice(0, 2)) {
    const got = await leak(prog, stockSig, salt);
    console.log(`    ${who} asks for the stocking transaction: ${got.join("; ") || "nothing readable"}`);
    record(`${who.replace(" (its own bid)", "")} cannot read the salt from the stocking transaction`, !got.includes("SECRET IN DATA"));
  }
  // An unauthenticated connection to the rollup
  for (const [what, sig, secret] of [["A's bid", bidSigs[0], amountA], ["the salt", stockSig, salt]] as [string, string, Buffer][]) {
    const got = await leak({ provider: { connection: new Connection(process.env.TEE_RPC ?? "https://devnet-tee.magicblock.app", "confirmed") } }, sig, secret);
    console.log(`    someone not logged in asks for ${what}: ${got.join("; ") || "nothing readable"}`);
    record(`someone not logged in cannot read ${what}`, !got.includes("SECRET IN DATA"));
  }

  head("Private rollup: close and commit");
  u = await (teeOp.account as any).unit.fetch(unit);
  const wait = Number(u.closesAt) * 1000 - Date.now() + 3000;
  if (wait > 0) { console.log(`    waiting ${Math.ceil(wait / 1000)}s for the clock`); await sleep(wait); }
  try {
    await teeOp.methods.closeUnit().accountsPartial({ authority: operator.publicKey, unit })
      .remainingAccounts([manifest, ...wallets.map((k) => p.bid(unit, k.publicKey))].map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }))).rpc();
    record("close_unit", true);
  } catch (e) { record("close_unit", false, msg(e)); logs(e); return finish(); }
  u = await (teeOp.account as any).unit.fetch(unit);
  console.log("    winner:", u.winner.toBase58(), "bid", Number(u.winningBid) / 1e6, "value $" + (u.value / 100).toFixed(2));
  console.log("    lots:", u.lots.map((l: any) => `${l.qty}× ${CATALOG[l.item].name}`).join(", "));

  try {
    const s = await teeOp.methods.commitUnit().accountsPartial({ payer: operator.publicKey, authority: operator.publicKey, unit, magicContext: MAGIC_CONTEXT_ID, magicProgram: MAGIC_PROGRAM_ID }).rpc({ skipPreflight: true });
    record("commit_unit sent", true, s);
  } catch (e) { record("commit_unit", false, msg(e)); logs(e); return finish(); }

  head("Solana: wait for the commit, settle, claim");
  let back = false;
  for (let i = 0; i < 40 && !back; i++) {
    await sleep(3000);
    const info = await retry(() => connection.getAccountInfo(unit));
    back = !!info && info.owner.equals(programId);
  }
  record("unit is back on Solana", back);
  if (!back) return finish();
  u = await (program.account as any).unit.fetch(unit);
  record("unit on Solana is Closed", "closed" in u.status);

  for (const [i, kp] of wallets.entries()) {
    const before = BigInt((await connection.getTokenAccountBalance(atas[i])).value.amount);
    try {
      await retry(() => program.methods.settleBidder().accountsPartial({ crank: operator.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, kp.publicKey), bidderTokenAccount: atas[i], vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
      const after = BigInt((await connection.getTokenAccountBalance(atas[i])).value.amount);
      const won = (u.winner as PublicKey).equals(kp.publicKey);
      const want = won ? PLAN[i].deposit - PLAN[i].bid : PLAN[i].deposit;
      record(`settle ${PLAN[i].label} (${won ? "winner" : "refund"})`, after - before === want, `got ${Number(after - before) / 1e6}, expected ${Number(want) / 1e6}`);
    } catch (e) { record(`settle ${PLAN[i].label}`, false, msg(e)); logs(e); }
    await sleep(800);
  }

  const winner = u.winner as PublicKey;
  const lotCount = (u.lots as any[]).length;
  const treasuryAt = async () => BigInt((await connection.getTokenAccountBalance(treasury)).value.amount);
  const treasuryBefore = await treasuryAt();
  for (const [i, lot] of (u.lots as any[]).entries()) {
    // The operator is paid the winning bid only when the last lot has been delivered.
    if (i === lotCount - 1) record("operator not paid while a lot is still undelivered", (await treasuryAt()) === treasuryBefore);
    const mint = yard.catalog[lot.item].mint as PublicKey;
    try {
      const ata = await retry(() => getOrCreateAssociatedTokenAccount(connection, operator, mint, winner));
      const before = BigInt(ata.amount.toString());
      await retry(() => program.methods.claimLot(i).accountsPartial({ crank: operator.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, winner), itemMint: mint, warehouse: p.warehouse(mint), winnerTokenAccount: ata.address, vault: p.vault, treasury, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
      const after = BigInt((await connection.getTokenAccountBalance(ata.address)).value.amount);
      record(`claim ${lot.qty}× ${CATALOG[lot.item].name}`, after - before === BigInt(lot.qty));
    } catch (e) {
      // A retry after a timeout finds the lot already delivered, which is the outcome wanted.
      if (/AlreadyClaimed/.test(String((e as any)?.message ?? e))) record(`claim lot ${i} (delivered on an earlier attempt)`, true);
      else { record(`claim lot ${i}`, false, msg(e)); logs(e); }
    }
    await sleep(800);
  }

  record("operator paid the winning bid after the last lot", (await treasuryAt()) - treasuryBefore === BigInt(u.winningBid.toString()), `+${Number((await treasuryAt()) - treasuryBefore) / 1e6}`);

  // Anyone can now recompute the draw: the salt is public and must match the commitment.
  u = await (program.account as any).unit.fetch(unit);
  record("published salt matches the commitment", createHash("sha256").update(Buffer.from(u.salt)).digest().equals(Buffer.from(u.saltCommit)));
  finish();
}

function logs(e: any) {
  for (const l of e?.logs ?? e?.transactionLogs ?? []) console.log("      " + l);
}
function finish() {
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${"─".repeat(60)}\n${results.length - bad.length} of ${results.length} steps passed`);
  for (const b of bad) console.log(`  FAILED: ${b.step}  ${b.note ?? ""}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\nFailed:", msg(e));
  logs(e);
  finish();
});
