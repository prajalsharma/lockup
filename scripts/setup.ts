/**
 * One-time devnet setup: test-dollar mint, yard, vault, catalog, stocked warehouse.
 * Safe to re-run; it skips what already exists.
 *
 *     pnpm setup:devnet
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BN } from "@coral-xyz/anchor";
import { AuthorityType, TOKEN_PROGRAM_ID, createMint, mintTo, setAuthority } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { CATALOG, RPC, sleep, WEIGHT, YARD_FILE, YARD_ID, loadIdl, loadKeypair, pdas, programFor, tx } from "./lib";

async function main() {
  const { idl, programId } = loadIdl();
  // The yard is run by the keeper wallet. Item mints stay under the deploy wallet.
  const authority = loadKeypair(process.env.LOCKUP_AUTHORITY ?? "~/.lockup-keys/keeper.json");
  const minter = loadKeypair(process.env.LOCKUP_MINTER ?? "~/.config/solana/id.json");
  const connection = new Connection(RPC, "confirmed");
  const program = programFor(idl, connection, authority);
  const p = pdas(programId);
  const saved = existsSync(YARD_FILE) ? JSON.parse(readFileSync(YARD_FILE, "utf8")) : {};
  const save = () => { mkdirSync(dirname(YARD_FILE), { recursive: true }); writeFileSync(YARD_FILE, JSON.stringify(saved, null, 2) + "\n"); };

  if (saved.yardId !== Number(YARD_ID)) delete saved.bidMint;
  saved.programId = programId.toBase58();
  saved.yardId = Number(YARD_ID);
  saved.yard = p.yard.toBase58();
  saved.vault = p.vault.toBase58();
  saved.items ??= [];

  if (!(await connection.getAccountInfo(p.yard))) {
    // BID_MINT picks an existing currency (Circle devnet USDC). Without it, a test mint with a faucet is made.
    let bidMint: PublicKey;
    if (process.env.BID_MINT) {
      bidMint = new PublicKey(process.env.BID_MINT);
    } else {
      bidMint = await createMint(connection, authority, authority.publicKey, null, 6);
      await setAuthority(connection, authority, bidMint, authority, AuthorityType.MintTokens, p.yard);
    }
    saved.bidMint = bidMint.toBase58();
    save();
    const sig = await program.methods.initYard(new BN(YARD_ID.toString()))
      .accountsPartial({ authority: authority.publicKey, yard: p.yard, bidMint, vault: p.vault, tokenProgram: TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("init_yard ✓", tx(sig));
  } else {
    const yard = await (program.account as any).yard.fetch(p.yard);
    saved.bidMint = yard.bidMint.toBase58();
    console.log("yard exists");
  }

  const yard = await (program.account as any).yard.fetch(p.yard);
  for (let i = yard.catalog.length; i < CATALOG.length; i++) {
    const c = CATALOG[i];
    // Reuse the item mint from an earlier yard when there is one.
    const mint = saved.items[i]?.mint ? new PublicKey(saved.items[i].mint) : await createMint(connection, minter, minter.publicKey, null, 0);
    const warehouse = p.warehouse(mint);
    await program.methods.addItem(c.value, WEIGHT[c.rarity], c.rarity, c.group, c.heavy)
      .accountsPartial({ authority: authority.publicKey, yard: p.yard, itemMint: mint, warehouse, tokenProgram: TOKEN_PROGRAM_ID, rent: SYSVAR_RENT_PUBKEY, systemProgram: SystemProgram.programId })
      .rpc();
    await sleep(1500);
    await mintTo(connection, minter, mint, warehouse, minter, 1_000_000);
    await sleep(1500);
    saved.items[i] = { ...c, mint: mint.toBase58() };
    save();
    console.log(`item ${i} ${c.name} ✓ ${mint.toBase58()}`);
  }
  const fresh = await (program.account as any).yard.fetch(p.yard);
  saved.items = CATALOG.map((c, i) => ({ ...c, mint: (fresh.catalog[i].mint as PublicKey).toBase58() }));
  // Top up any warehouse left empty by an interrupted run.
  for (const item of fresh.catalog) {
    const warehouse = p.warehouse(item.mint);
    const bal = await connection.getTokenAccountBalance(warehouse);
    if (bal.value.amount === "0") {
      await mintTo(connection, minter, item.mint, warehouse, minter, 1_000_000);
      console.log("topped up", item.mint.toBase58());
    }
    await sleep(700);
  }
  save();
  console.log("\nYard ready:", p.yard.toBase58(), "\nSaved to", YARD_FILE);
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  if (e?.logs) for (const l of e.logs) console.error("  " + l);
  process.exit(1);
});
