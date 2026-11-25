/**
 * Exercise the resale instructions on devnet: list, buy part, refuse a bad buy, cancel the rest.
 *
 *     pnpm market
 */
import { readFileSync } from "node:fs";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, transfer } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { RPC, YARD_FILE, enc, loadIdl, loadKeypair, pdas, programFor, tx } from "./lib";

const results: boolean[] = [];
const check = (step: string, ok: boolean, note = "") => { results.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${step}${note ? `  ${note}` : ""}`); };
const fails = async (f: () => Promise<unknown>, want: string) => { try { await f(); return false; } catch (e) { const ok = String(e).includes(want); if (!ok) console.log("    got:", String(e).slice(0, 300)); return ok; } };

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const { idl, programId } = loadIdl();
  const p = pdas(programId);
  const yard = JSON.parse(readFileSync(YARD_FILE, "utf8"));
  const bidMint = new PublicKey(yard.bidMint);
  const itemMint = new PublicKey(yard.items[2].mint); // Cassette deck
  const keeper = loadKeypair("~/.lockup-keys/keeper.json");
  const minter = loadKeypair("~/.config/solana/id.json");
  const seller = Keypair.generate(), buyer = Keypair.generate();

  await sendAndConfirmTransaction(connection, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: seller.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: buyer.publicKey, lamports: 0.02 * LAMPORTS_PER_SOL }),
  ), [keeper]);
  const sellerItem = await getOrCreateAssociatedTokenAccount(connection, seller, itemMint, seller.publicKey);
  const buyerItem = await getOrCreateAssociatedTokenAccount(connection, buyer, itemMint, buyer.publicKey);
  const sellerUsd = await getOrCreateAssociatedTokenAccount(connection, seller, bidMint, seller.publicKey);
  const buyerUsd = await getOrCreateAssociatedTokenAccount(connection, buyer, bidMint, buyer.publicKey);
  await mintTo(connection, minter, itemMint, sellerItem.address, minter, 3);
  const keeperUsd = getAssociatedTokenAddressSync(bidMint, keeper.publicKey);
  await transfer(connection, keeper, keeperUsd, buyerUsd.address, keeper, 90_000); // $0.09

  const [listing] = PublicKey.findProgramAddressSync([enc("listing"), p.yard.toBuffer(), seller.publicKey.toBuffer(), itemMint.toBuffer()], programId);
  const [stall] = PublicKey.findProgramAddressSync([enc("stall"), listing.toBuffer()], programId);
  const sp = programFor(idl, connection, seller), bp = programFor(idl, connection, buyer);
  const PRICE = new BN(20_000); // $0.02 each

  console.log("\n▸ list 3 at $0.02");
  const s1 = await sp.methods.listItem(PRICE, new BN(3)).accountsPartial({ seller: seller.publicKey, yard: p.yard, itemMint, sellerItemAccount: sellerItem.address, listing, stall, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  check("listed", Number((await getAccount(connection, stall)).amount) === 3, tx(s1));
  check("a second listing of the same item is refused", await fails(() => sp.methods.listItem(PRICE, new BN(1)).accountsPartial({ seller: seller.publicKey, yard: p.yard, itemMint, sellerItemAccount: sellerItem.address, listing, stall, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc(), "already in use"));

  const buyAccounts = { buyer: buyer.publicKey, yard: p.yard, listing, seller: seller.publicKey, stall, buyerTokenAccount: buyerUsd.address, sellerTokenAccount: sellerUsd.address, buyerItemAccount: buyerItem.address, pool: p.pool(itemMint), tokenProgram: TOKEN_PROGRAM_ID };
  console.log("\n▸ buy");
  check("a buy below the asking price is refused", await fails(() => bp.methods.buyItem(new BN(1), new BN(10_000)).accountsPartial(buyAccounts).rpc(), "PriceChanged"));
  check("buying more than is listed is refused", await fails(() => bp.methods.buyItem(new BN(4), PRICE).accountsPartial(buyAccounts).rpc(), "NotEnoughListed"));
  check("payment to someone other than the seller is refused", await fails(() => bp.methods.buyItem(new BN(1), PRICE).accountsPartial({ ...buyAccounts, sellerTokenAccount: keeperUsd }).rpc(), "Unauthorized"));
  const s2 = await bp.methods.buyItem(new BN(2), PRICE).accountsPartial(buyAccounts).rpc();
  const paid = Number((await getAccount(connection, sellerUsd.address)).amount);
  const got = Number((await getAccount(connection, buyerItem.address)).amount);
  check("bought 2: seller paid $0.04, buyer holds 2", paid === 40_000 && got === 2, tx(s2));

  console.log("\n▸ cancel");
  check("someone else cannot cancel", await fails(() => bp.methods.cancelListing().accountsPartial({ seller: buyer.publicKey, yard: p.yard, listing, stall, sellerItemAccount: buyerItem.address, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), "Error"));
  const s3 = await sp.methods.cancelListing().accountsPartial({ seller: seller.publicKey, yard: p.yard, listing, stall, sellerItemAccount: sellerItem.address, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  const back = Number((await getAccount(connection, sellerItem.address)).amount);
  const gone = !(await connection.getAccountInfo(listing)) && !(await connection.getAccountInfo(stall));
  check("cancelled: 1 item back, listing and stall closed", back === 1 && gone, tx(s3));

  console.log("\n▸ sell out closes the listing");
  await sp.methods.listItem(PRICE, new BN(1)).accountsPartial({ seller: seller.publicKey, yard: p.yard, itemMint, sellerItemAccount: sellerItem.address, listing, stall, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  const s4 = await bp.methods.buyItem(new BN(1), PRICE).accountsPartial(buyAccounts).rpc();
  check("sold out: listing and stall closed", !(await connection.getAccountInfo(listing)) && !(await connection.getAccountInfo(stall)), tx(s4));

  console.log("\n▸ a stranger drops a stray token into someone's stall");
  await mintTo(connection, minter, itemMint, sellerItem.address, minter, 2);
  const list = () => sp.methods.listItem(PRICE, new BN(1)).accountsPartial({ seller: seller.publicKey, yard: p.yard, itemMint, sellerItemAccount: sellerItem.address, listing, stall, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  await list();
  await mintTo(connection, minter, itemMint, stall, minter, 1);
  await sp.methods.cancelListing().accountsPartial({ seller: seller.publicKey, yard: p.yard, listing, stall, sellerItemAccount: sellerItem.address, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  check("the seller can still cancel, and keeps the stray token", Number((await getAccount(connection, sellerItem.address)).amount) === 3 && !(await connection.getAccountInfo(stall)));
  await list();
  await mintTo(connection, minter, itemMint, stall, minter, 1);
  const had = Number((await getAccount(connection, buyerItem.address)).amount);
  await bp.methods.buyItem(new BN(1), PRICE).accountsPartial(buyAccounts).rpc();
  check("the last item can still be bought, and the stall closes", Number((await getAccount(connection, buyerItem.address)).amount) === had + 2 && !(await connection.getAccountInfo(stall)) && !(await connection.getAccountInfo(listing)));

  // Send the test dollars back to the keeper.
  await transfer(connection, seller, sellerUsd.address, keeperUsd, seller, 80_000);
  await transfer(connection, buyer, buyerUsd.address, keeperUsd, buyer, 10_000);
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  if (results.some((r) => !r)) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
