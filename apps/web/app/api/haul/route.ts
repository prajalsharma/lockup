import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import bs58 from "bs58";
import idl from "@/lib/chain/idl.json";
import { BID_MINT, ITEMS, PROGRAM, RPC, YARD } from "@/lib/chain/shared";
import type { Consigned, DoorLot, Haul, HaulRound } from "@/lib/chain/types";

export const dynamic = "force-dynamic";

const BIDDER_SIZE = 123; // 8 discriminator + yard 32 + unit 32 + bidder 32 + deposit 8 + joined_at 8 + 3 flags
const CONSIGN_SIZE = 129; // 8 discriminator + yard 32 + seller 32 + mint 32 + qty 8 + sold 8 + earned 8 + bump 1
const connection = new Connection(RPC, "confirmed");
const coder = new BorshAccountsCoder(idl as Idl);

/** Everything one wallet has done in the yard, read from Solana: its rounds and the item tokens it holds. */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  let owner: PublicKey;
  try { owner = new PublicKey(address); } catch { return NextResponse.json({ error: "bad address" }, { status: 400 }); }
  try {
    const [records, tokens, waiting] = await Promise.all([
      connection.getProgramAccounts(PROGRAM, {
        filters: [{ dataSize: BIDDER_SIZE }, { memcmp: { offset: 8, bytes: YARD.toBase58() } }, { memcmp: { offset: 72, bytes: bs58.encode(owner.toBuffer()) } }],
      }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      connection.getProgramAccounts(PROGRAM, {
        filters: [{ dataSize: CONSIGN_SIZE }, { memcmp: { offset: 8, bytes: YARD.toBase58() } }, { memcmp: { offset: 40, bytes: bs58.encode(owner.toBuffer()) } }],
      }),
    ]);
    const consigned: Consigned[] = [];
    for (const w of waiting) {
      let c;
      // An item's shelf account is the same size; its discriminator makes the decode fail, which skips it.
      try { c = coder.decode("Consignment", w.account.data); } catch { continue; }
      const it = ITEMS.find((i) => i.mint === c.mint.toBase58());
      if (it) consigned.push({ mint: it.mint, id: it.id, name: it.name, rarity: it.rarity, value: it.value / 100, qty: Number(c.qty), sold: Number(c.sold), earned: Number(c.earned) / 1e6 });
    }

    const held = new Map<string, number>();
    for (const t of tokens.value) {
      const info = t.account.data.parsed.info;
      held.set(info.mint, (held.get(info.mint) ?? 0) + Number(info.tokenAmount.amount));
    }
    const items = ITEMS.map((it) => ({ name: it.name, id: it.id, rarity: it.rarity, qty: held.get(it.mint) ?? 0, value: (it.value * (held.get(it.mint) ?? 0)) / 100, mint: it.mint })).filter((i) => i.qty > 0);

    const decoded = records.map((r) => coder.decode("Bidder", r.account.data));
    const unitKeys: PublicKey[] = decoded.map((d) => d.unit);
    const unitInfos = unitKeys.length ? await connection.getMultipleAccountsInfo(unitKeys) : [];
    const rounds: HaulRound[] = [];
    decoded.forEach((d, i) => {
      const info = unitInfos[i];
      if (!info) return;
      let u;
      try { u = coder.decode("Unit", info.data); } catch { return; }
      const status = Object.keys(u.status)[0].toLowerCase() as HaulRound["status"];
      const closed = status === "closed";
      const slot = u.slots.find((s: any) => s.bidder.equals(owner));
      const lots: DoorLot[] = closed ? u.lots.map((l: any) => ({ name: ITEMS[l.item].name, id: ITEMS[l.item].id, rarity: ITEMS[l.item].rarity, heavy: ITEMS[l.item].heavy, qty: l.qty, value: (ITEMS[l.item].value * l.qty) / 100 })) : [];
      rounds.push({
        unit: Number(u.unit_id), address: unitKeys[i].toBase58(), status,
        deposit: Number(d.deposit) / 1e6,
        bid: closed && slot?.has_bid ? Number(slot.bid) / 1e6 : null,
        won: closed && u.winner.equals(owner), settled: d.settled,
        winningBid: Number(u.winning_bid) / 1e6, value: u.value / 100, lots,
      });
    });
    rounds.sort((a, b) => b.unit - a.unit);
    const body: Haul = { address: owner.toBase58(), dollars: (held.get(BID_MINT.toBase58()) ?? 0) / 1e6, items, rounds, consigned };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "read failed" }, { status: 502 });
  }
}
