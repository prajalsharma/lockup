/**
 * Try to break the rules of a live solo unit from a player's wallet, and check every attempt is refused.
 * The hosted keeper runs the round; this script only plays the cheat.
 *
 *     KEYS=<dir with g.json and h.json, each funded with SOL and 1 USDC> pnpm attack
 */
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID, permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { RPC, USD, loadIdl, loadKeypair, pdas, programFor, sleep, teeConnection } from "./lib";

const SITE = process.env.SITE ?? "https://lockup-seven.vercel.app";
const results: boolean[] = [];
const check = (step: string, ok: boolean, note = "") => { results.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${step}${note ? `  (${note})` : ""}`); };
const ERRORS = new Map<number, string>();
/** Why a transaction would fail, read from a simulation. The rollup's send path returns no logs, but its simulation does. */
async function reason(builder: any): Promise<string> {
  try { await builder.simulate(); return ""; } catch (e: any) {
    const logs: string[] = e?.simulationResponse?.logs ?? e?.logs ?? [];
    const text = `${logs.join("\n")}\n${e?.message ?? ""}`;
    const named = /Error Code: (\w+)/.exec(text)?.[1];
    if (named) return named;
    const custom = /custom program error: (0x[0-9a-f]+)/i.exec(text)?.[1] ?? (/"Custom":\s*(\d+)/.exec(JSON.stringify(e?.simulationResponse?.err ?? ""))?.[1]);
    if (custom) { const n = Number(custom); return ERRORS.get(n) ?? (n === 0 ? "account already exists" : `error ${n}`); }
    return text.replace(/\s+/g, " ").trim().slice(0, 70);
  }
}
/** Passes only if the call fails, and reports why. `f` returns either a promise or an Anchor method builder. */
async function refused(step: string, f: () => any, want?: RegExp) {
  let builder: any = null;
  try {
    const x = await f();
    if (x && typeof x.rpc === "function") { builder = x; await x.rpc(); }
    check(step, false, "it went through");
  } catch (e) {
    const m = String((e as any)?.message ?? e) + ((e as any)?.logs ?? []).join("\n");
    let code = /Error Code: (\w+)/.exec(m)?.[1] ?? "";
    if (!code && builder) code = await reason(builder);
    if (!code) code = /custom program error: (0x\w+)/.exec(m)?.[1] ?? (m.replace(/\s+/g, " ").trim().slice(0, 70) || "refused, no reason returned");
    check(step, want ? want.test(code) || want.test(m) : true, code);
  }
}
const chain = async () => { for (;;) { try { const j: any = await (await fetch(`${SITE}/api/chain`)).json(); if (j.units) return j; } catch { /* retry */ } await sleep(1500); } };
const perm = { permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID };

async function main() {
  const dir = process.env.KEYS!;
  const g = loadKeypair(`${dir}/g.json`), h = loadKeypair(`${dir}/h.json`);
  const connection = new Connection(RPC, "confirmed");
  const { idl, programId } = loadIdl();
  for (const e of (idl as any).errors ?? []) ERRORS.set(e.code, e.name);
  const p = pdas(programId);
  const gp = programFor(idl, connection, g), hp = programFor(idl, connection, h);
  const yard = await (gp.account as any).yard.fetch(p.yard);
  const usdc = yard.bidMint as PublicKey;
  const gAta = getAssociatedTokenAddressSync(usdc, g.publicKey), hAta = getAssociatedTokenAddressSync(usdc, h.publicKey);

  const c = await chain();
  const target = c.units.filter((u: any) => u.mode === "solo" && u.status === "open" && u.bids.every((b: any) => b.house)).sort((a: any, b: any) => a.id - b.id)[0];
  const old = c.units.find((u: any) => u.status === "closed" && u.winner && u.claimed);
  const id = BigInt(target.id), unit = p.unit(id);
  console.log("attacking solo unit", target.id, "| old closed unit", old.id);
  const join = (prog: any, who: PublicKey, ata: PublicKey, amount: bigint, u = unit) => prog.methods.joinUnit(new BN(amount.toString()))
    .accountsPartial({ bidder: who, yard: p.yard, unit: u, bidderRecord: p.bidder(u, who), bidderTokenAccount: ata, vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();

  console.log("\n▸ Solana, before the door locks");
  await refused("deposit below the minimum bid", () => join(gp, g.publicKey, gAta, USD / 100n), /DepositTooSmall/);
  await refused("deposit paid from someone else's USDC", () => join(gp, g.publicKey, hAta, USD), /Unauthorized|owner/);
  await refused("join a unit that already closed", () => join(gp, g.publicKey, gAta, USD, p.unit(BigInt(old.id))), /WrongStatus/);
  await join(gp, g.publicKey, gAta, USD);
  check("honest join with $1.00", true);
  await refused("join the same unit twice", () => join(gp, g.publicKey, gAta, USD));
  await refused("a player asks for the draw early to peek", () => gp.methods.requestDraw().accountsPartial({ authority: g.publicKey, unit, oracleQueue: new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh") }).rpc(), /Unauthorized|has_one|Constraint/);
  await refused("a player starts the clock themself", () => gp.methods.startUnit().accountsPartial({ authority: g.publicKey, unit, oracleQueue: new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh") }).rpc(), /Unauthorized|has_one|Constraint/);
  await refused("take the deposit back early (reclaim)", () => gp.methods.reclaimStalled().accountsPartial({ bidder: g.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, g.publicKey), bidderTokenAccount: gAta, vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /TooEarly/);
  await refused("settle before the unit closes", () => gp.methods.settleBidder().accountsPartial({ crank: g.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, g.publicKey), bidderTokenAccount: gAta, vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /WrongStatus/);
  // an old unit someone else won: try to take its contents and re-run its payouts
  const oldUnit = p.unit(BigInt(old.id)), oldWinner = new PublicKey(old.winner);
  const oldU = await (gp.account as any).unit.fetch(oldUnit);
  const mint = yard.catalog[oldU.lots[0].item].mint as PublicKey;
  const gItem = await getOrCreateAssociatedTokenAccount(connection, g, mint, g.publicKey);
  await refused("claim another winner's items into my wallet", () => gp.methods.claimLot(0).accountsPartial({ crank: g.publicKey, yard: p.yard, unit: oldUnit, bidderRecord: p.bidder(oldUnit, oldWinner), itemMint: mint, warehouse: p.warehouse(mint), winnerTokenAccount: gItem.address, vault: p.vault, treasury: getAssociatedTokenAddressSync(usdc, yard.authority), tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /NotWinner|AlreadyClaimed/);
  await refused("pay out an already settled bidder again", () => gp.methods.settleBidder().accountsPartial({ crank: g.publicKey, yard: p.yard, unit: oldUnit, bidderRecord: p.bidder(oldUnit, oldWinner), bidderTokenAccount: getAssociatedTokenAddressSync(usdc, oldWinner), vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /AlreadySettled/);
  await refused("send a finished unit's winning bid to my wallet instead of the operator", () => gp.methods.claimLot(0).accountsPartial({ crank: g.publicKey, yard: p.yard, unit: oldUnit, bidderRecord: p.bidder(oldUnit, oldWinner), itemMint: mint, warehouse: p.warehouse(mint), winnerTokenAccount: getAssociatedTokenAddressSync(mint, oldWinner), vault: p.vault, treasury: gAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /Unauthorized|AlreadyClaimed/);
  await refused("redirect someone's refund to my wallet", () => gp.methods.settleBidder().accountsPartial({ crank: g.publicKey, yard: p.yard, unit: oldUnit, bidderRecord: p.bidder(oldUnit, oldWinner), bidderTokenAccount: gAta, vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /Unauthorized|AlreadySettled/);

  console.log("\n▸ waiting for the door to lock and the unit to be stocked");
  let u: any;
  for (;;) { u = (await chain()).units.find((x: any) => x.id === target.id); if (u.status === "bidding" && u.stocked) break; await sleep(2500); }
  await refused("join after the door locked", () => join(hp, h.publicKey, hAta, USD));

  console.log("\n▸ private rollup, bidding open");
  const tg = programFor(idl, await teeConnection(g), g), th = programFor(idl, await teeConnection(h), h);
  const bidIx = async (prog: any, who: PublicKey, amount: bigint) => {
    const bid = p.bid(unit, who);
    const seal = await prog.methods.sealBid().accountsPartial({ unit, bid, permission: permissionPdaFromAccount(bid), ...perm }).instruction();
    return prog.methods.placeBid(new BN(amount.toString())).accountsPartial({ bidder: who, unit, bid }).postInstructions([seal]);
  };
  await refused("bid from a wallet that is not in line", () => bidIx(th, h.publicKey, USD / 2n), /NotInLine/);
  await refused("bid more than the deposit", () => bidIx(tg, g.publicKey, 5n * USD), /BidAboveDeposit/);
  await refused("bid below the minimum", () => bidIx(tg, g.publicKey, USD / 100n), /BidTooLow/);
  const manifest = p.manifest(unit);
  await refused("a player closes the unit early", () => tg.methods.closeUnit().accountsPartial({ authority: g.publicKey, unit }).remainingAccounts([{ pubkey: manifest, isSigner: false, isWritable: false }]), /Unauthorized/);
  await refused("a player restocks the unit with their own salt", () => tg.methods.stockUnit(Array(32).fill(7)).accountsPartial({ authority: g.publicKey, unit, manifest }), /Unauthorized/);
  // wait for a house bid, then try to read it and the contents
  for (let i = 0; i < 20; i++) { u = (await chain()).units.find((x: any) => x.id === target.id); if (u.bidCount > 0) break; await sleep(2000); }
  const house = u.bids.filter((b: any) => b.house && b.hasBid).map((b: any) => new PublicKey(b.who));
  const read = async (conn: Connection, key: PublicKey) => { try { const a = await conn.getAccountInfo(key); return !!a && a.data.length > 0; } catch { return false; } };
  check(`${house.length} house bid(s) placed; reading one from a player's session is refused`, house.length > 0 && !(await read(tg.provider.connection, p.bid(unit, house[0]))));
  check("reading the unit's contents from a player's session is refused", !(await read(tg.provider.connection, manifest)));
  check("reading the contents from a wallet that is not in line is refused", !(await read(th.provider.connection, manifest)));
  check("the bid and the contents are not on Solana", !(await connection.getAccountInfo(p.bid(unit, house[0]))) && !(await connection.getAccountInfo(manifest)));
  // If either bad bid above had landed, this one would be refused as a second bid.
  await (await bidIx(tg, g.publicKey, (USD * 95n) / 100n)).rpc();
  check("honest bid of $0.95 goes through, so neither bad bid landed", true);
  check("I can read my own bid", await read(tg.provider.connection, p.bid(unit, g.publicKey)));
  await refused("bid a second time", () => bidIx(tg, g.publicKey, USD / 2n), /AlreadyBid|already exists/);

  console.log("\n▸ after the clock");
  for (;;) { u = (await chain()).units.find((x: any) => x.id === target.id); if (u.status === "closed" && (u.claimed || !u.winner)) break; await sleep(3000); }
  await sleep(6000);
  const bal = Number((await connection.getTokenAccountBalance(gAta)).value.amount) / 1e6;
  check(`round finished: winner ${u.winner === g.publicKey.toBase58() ? "me" : "someone else"}, my USDC is ${bal}`, u.winner === g.publicKey.toBase58() ? Math.abs(bal - 0.05) < 1e-9 : Math.abs(bal - 1) < 1e-9);
  await refused("get paid out a second time", () => gp.methods.settleBidder().accountsPartial({ crank: g.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, g.publicKey), bidderTokenAccount: gAta, vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /AlreadySettled/);
  await refused("take the deposit back as well (reclaim after closing)", () => gp.methods.reclaimStalled().accountsPartial({ bidder: g.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, g.publicKey), bidderTokenAccount: gAta, vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /AlreadySettled|TooEarly|WrongStatus/);
  const m0 = yard.catalog[(await (gp.account as any).unit.fetch(unit)).lots[0].item].mint as PublicKey;
  const myItem = await getOrCreateAssociatedTokenAccount(connection, g, m0, new PublicKey(u.winner), true);
  await refused("claim the same lot twice", () => gp.methods.claimLot(0).accountsPartial({ crank: g.publicKey, yard: p.yard, unit, bidderRecord: p.bidder(unit, new PublicKey(u.winner)), itemMint: m0, warehouse: p.warehouse(m0), winnerTokenAccount: myItem.address, vault: p.vault, treasury: getAssociatedTokenAddressSync(usdc, yard.authority), tokenProgram: TOKEN_PROGRAM_ID }).rpc(), /AlreadyClaimed/);

  console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
