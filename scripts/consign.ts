/**
 * The seller pool on devnet: open every item's shelf, then consign, top up, refuse the bad cases
 * and take one back. Leaves one of every item consigned by a test seller, so the next `pnpm round`
 * pays that seller out of a real winning bid.
 *
 *     pnpm consign            open shelves, run the checks, leave items consigned
 *     pnpm consign withdraw   take back whatever the test seller still has waiting
 */
import { readFileSync } from "node:fs";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { CATALOG, RPC, YARD_FILE, cachedKeypair, loadIdl, loadKeypair, pdas, programFor, tx } from "./lib";

const results: boolean[] = [];
const check = (step: string, ok: boolean, note = "") => { results.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${step}${note ? `  ${note}` : ""}`); };
const fails = async (f: () => Promise<unknown>, want: RegExp) => { try { await f(); return false; } catch (e) { const ok = want.test(String(e)); if (!ok) console.log("    got:", String(e).slice(0, 300)); return ok; } };

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const { idl, programId } = loadIdl();
  const p = pdas(programId);
  const yard = JSON.parse(readFileSync(YARD_FILE, "utf8"));
  const mints: PublicKey[] = yard.items.map((i: { mint: string }) => new PublicKey(i.mint));
  const keeper = loadKeypair("~/.lockup-keys/keeper.json");
  const minter = loadKeypair("~/.config/solana/id.json");
  const seller = cachedKeypair("consignor"), stranger = cachedKeypair("bidder-b");
  const kp = programFor(idl, connection, keeper), sp = programFor(idl, connection, seller), xp = programFor(idl, connection, stranger);
  const acct = (m: PublicKey, who = seller.publicKey, item: PublicKey) => ({ seller: who, yard: p.yard, pool: p.pool(m), consignment: p.consign(who, m), sellerItemAccount: item, warehouse: p.warehouse(m), tokenProgram: TOKEN_PROGRAM_ID });
  const poolOf = async (m: PublicKey) => Number(((await (sp.account as any).pool.fetch(p.pool(m))) as any).consigned);
  const mine = async (m: PublicKey) => (sp.account as any).consignment.fetchNullable(p.consign(seller.publicKey, m)) as Promise<any>;

  if ((await connection.getBalance(seller.publicKey)) < 0.03 * LAMPORTS_PER_SOL) {
    await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: seller.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL })), [keeper]);
  }

  if (process.argv[2] === "withdraw") {
    for (const [i, m] of mints.entries()) {
      const c = await mine(m);
      if (!c || Number(c.qty) === 0) continue;
      const ata = await getOrCreateAssociatedTokenAccount(connection, seller, m, seller.publicKey);
      await sp.methods.withdrawConsignment(c.qty).accountsPartial(acct(m, seller.publicKey, ata.address)).rpc();
      console.log(`  took back ${c.qty}× ${CATALOG[i].name}  (sold ${c.sold}, earned $${Number(c.earned) / 1e6})`);
    }
    return;
  }

  console.log("\n▸ open a shelf for every item");
  let opened = 0;
  for (const m of mints) {
    if (await connection.getAccountInfo(p.pool(m))) continue;
    await kp.methods.initPool().accountsPartial({ payer: keeper.publicKey, yard: p.yard, itemMint: m, pool: p.pool(m), systemProgram: SystemProgram.programId }).rpc();
    opened++;
  }
  check(`all ${mints.length} shelves exist`, (await connection.getMultipleAccountsInfo(mints.map((m) => p.pool(m)))).every(Boolean), `${opened} opened now`);
  check("a shelf cannot be opened twice", await fails(() => kp.methods.initPool().accountsPartial({ payer: keeper.publicKey, yard: p.yard, itemMint: mints[0], pool: p.pool(mints[0]), systemProgram: SystemProgram.programId }).rpc(), /already in use|custom program error: 0x0/));

  const m = mints[2]; // Cassette deck
  const item = await getOrCreateAssociatedTokenAccount(connection, seller, m, seller.publicKey);
  await mintTo(connection, minter, m, item.address, minter, 3);
  const whBefore = Number((await getAccount(connection, p.warehouse(m))).amount), poolBefore = await poolOf(m), had = Number((await mine(m))?.qty ?? 0);
  const held = Number((await getAccount(connection, item.address)).amount);

  console.log("\n▸ consign");
  const s1 = await sp.methods.consign(new BN(2)).accountsPartial({ ...acct(m, seller.publicKey, item.address), itemMint: m, systemProgram: SystemProgram.programId }).rpc();
  check("2 items moved into the warehouse and counted on the shelf", Number((await getAccount(connection, p.warehouse(m))).amount) === whBefore + 2 && (await poolOf(m)) === poolBefore + 2 && Number((await mine(m)).qty) === had + 2, tx(s1));
  await sp.methods.consign(new BN(1)).accountsPartial({ ...acct(m, seller.publicKey, item.address), itemMint: m, systemProgram: SystemProgram.programId }).rpc();
  check("consigning again adds to the same record", Number((await mine(m)).qty) === had + 3 && (await poolOf(m)) === poolBefore + 3);
  check("consigning nothing is refused", await fails(() => sp.methods.consign(new BN(0)).accountsPartial({ ...acct(m, seller.publicKey, item.address), itemMint: m, systemProgram: SystemProgram.programId }).rpc(), /BadListing/));
  check("consigning more than you hold is refused", await fails(() => sp.methods.consign(new BN(50)).accountsPartial({ ...acct(m, seller.publicKey, item.address), itemMint: m, systemProgram: SystemProgram.programId }).rpc(), /insufficient funds|0x1/));

  console.log("\n▸ take back");
  const strangerItem = await getOrCreateAssociatedTokenAccount(connection, keeper, m, stranger.publicKey);
  check("someone else cannot take your consigned items", await fails(() => xp.methods.withdrawConsignment(new BN(1)).accountsPartial({ ...acct(m, stranger.publicKey, strangerItem.address), consignment: p.consign(seller.publicKey, m) }).rpc(), /Unauthorized|ConstraintSeeds|ConstraintHasOne|seeds/i));
  check("taking back more than is waiting is refused", await fails(() => sp.methods.withdrawConsignment(new BN(had + 4)).accountsPartial(acct(m, seller.publicKey, item.address)).rpc(), /NotEnoughConsigned/));
  const s2 = await sp.methods.withdrawConsignment(new BN(1)).accountsPartial(acct(m, seller.publicKey, item.address)).rpc();
  check("1 item back in the wallet, shelf count down by 1", Number((await getAccount(connection, item.address)).amount) === held - 2 && (await poolOf(m)) === poolBefore + 2, tx(s2));

  console.log("\n▸ leave one of every item waiting, so the next unit pays this seller");
  for (const [i, mint] of mints.entries()) {
    if (Number((await mine(mint))?.qty ?? 0) > 0) continue;
    const ata = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
    if (Number(ata.amount) === 0) await mintTo(connection, minter, mint, ata.address, minter, 1);
    await sp.methods.consign(new BN(1)).accountsPartial({ ...acct(mint, seller.publicKey, ata.address), itemMint: mint, systemProgram: SystemProgram.programId }).rpc();
    console.log(`    consigned 1× ${CATALOG[i].name}`);
  }
  check("every shelf has a player's item waiting", (await Promise.all(mints.map(poolOf))).every((n) => n > 0));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed   test seller ${seller.publicKey.toBase58()}`);
  if (results.some((r) => !r)) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
