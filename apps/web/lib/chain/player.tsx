"use client";
/**
 * The player's wallet and the three things a player does on chain: get test dollars, line up
 * with a deposit (Solana), and place a sealed bid (private rollup).
 */
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getAuthToken, permissionPdaFromAccount, EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import idl from "./idl.json";
import { BID_MINT, RPC, TEE_RPC, USD, VAULT, YARD, bidPda, bidderPda, sleep, tapPda, unitPda } from "./shared";

interface Signer {
  kind: "quick" | "extension";
  name: string;
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
  disconnect(): void;
}

const QUICK_KEY = "lockup.quick-wallet";

function quickSigner(): Signer {
  let kp: Keypair;
  try {
    const raw = localStorage.getItem(QUICK_KEY);
    kp = raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : Keypair.generate();
    if (!raw) localStorage.setItem(QUICK_KEY, JSON.stringify(Array.from(kp.secretKey)));
  } catch { kp = Keypair.generate(); }
  return {
    kind: "quick", name: "Quick wallet", publicKey: kp.publicKey,
    signTransaction: async (tx) => { tx.partialSign(kp); return tx; },
    signMessage: async (m) => nacl.sign.detached(m, kp.secretKey),
    disconnect: () => undefined,
  };
}

/** Injected wallets that expose the common connect / signTransaction / signMessage API. */
function injected(): { name: string; provider: any }[] {
  const w = window as any;
  const out: { name: string; provider: any }[] = [];
  if (w.phantom?.solana?.isPhantom) out.push({ name: "Phantom", provider: w.phantom.solana });
  if (w.solflare?.isSolflare) out.push({ name: "Solflare", provider: w.solflare });
  if (w.backpack?.isBackpack) out.push({ name: "Backpack", provider: w.backpack });
  return out;
}

async function extensionSigner(name: string, provider: any): Promise<Signer> {
  const res = await provider.connect();
  const publicKey = new PublicKey((res?.publicKey ?? provider.publicKey).toString());
  return {
    kind: "extension", name, publicKey,
    signTransaction: (tx) => provider.signTransaction(tx),
    signMessage: async (m) => { const r = await provider.signMessage(m, "utf8"); return r.signature ?? r; },
    disconnect: () => { try { provider.disconnect(); } catch { /* ignore */ } },
  };
}

interface PlayerState {
  ready: boolean;
  address: string | null;
  walletName: string | null;
  isQuick: boolean;
  sol: number | null;
  dollars: number | null;
  extensions: string[];
  busy: string | null;
  error: string | null;
  myBids: Record<number, number>;
  useQuick(): void;
  useExtension(name: string): Promise<void>;
  disconnect(): void;
  clearError(): void;
  join(unitId: number, deposit: number): Promise<boolean>;
  bid(unitId: number, amount: number): Promise<boolean>;
  topUp(): Promise<boolean>;
}

const Ctx = createContext<PlayerState | null>(null);
export const usePlayer = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlayer outside PlayerProvider");
  return c;
};

const plain = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  const named = /Error Message: ([^.]+)\./.exec(m);
  if (named) return named[1] + ".";
  if (/User rejected|rejected the request/i.test(m)) return "You cancelled that in your wallet.";
  if (/insufficient lamports|insufficient funds for (fee|rent)|Attempt to debit/i.test(m)) return "This wallet has no devnet SOL for fees.";
  if (/429|Too Many/i.test(m)) return "Devnet is busy. Try again in a few seconds.";
  return m.split("\n")[0].slice(0, 140);
};

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [ready, setReady] = useState(false);
  const [sol, setSol] = useState<number | null>(null);
  const [dollars, setDollars] = useState<number | null>(null);
  const [extensions, setExtensions] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myBids, setMyBids] = useState<Record<number, number>>({});
  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);
  const teeConn = useRef<{ who: string; conn: Connection } | null>(null);

  useEffect(() => {
    setExtensions(injected().map((i) => i.name));
    try {
      if (localStorage.getItem(QUICK_KEY)) setSigner(quickSigner());
      setMyBids(JSON.parse(sessionStorage.getItem("lockup.my-bids") || "{}"));
    } catch { /* ignore */ }
    setReady(true);
  }, []);

  const refresh = useCallback(async (who: PublicKey) => {
    try {
      const [lamports, tok] = await Promise.all([
        connection.getBalance(who),
        connection.getTokenAccountBalance(getAssociatedTokenAddressSync(BID_MINT, who)).then((b) => Number(b.value.amount), () => 0),
      ]);
      setSol(lamports / LAMPORTS_PER_SOL);
      setDollars(tok / USD);
      return { lamports, tok };
    } catch { return null; }
  }, [connection]);

  useEffect(() => {
    if (!signer) { setSol(null); setDollars(null); return; }
    void refresh(signer.publicKey);
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(signer.publicKey); }, 12000);
    return () => clearInterval(t);
  }, [signer, refresh]);

  const program = useCallback((conn: Connection, who: PublicKey) => {
    const wallet = { publicKey: who, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t };
    return new Program(idl as Idl, new AnchorProvider(conn, wallet as any, { commitment: "confirmed" }));
  }, []);

  /** Sign, send and wait for a Solana transaction. */
  const send = useCallback(async (s: Signer, tx: Transaction, conn: Connection, skipPreflight = false) => {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.feePayer = s.publicKey;
    tx.recentBlockhash = blockhash;
    const signed = await s.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  }, []);

  /** Make sure the wallet can pay fees: ask the keeper for a little devnet SOL if it has none. */
  const ensureSol = useCallback(async (s: Signer) => {
    if ((await connection.getBalance(s.publicKey)) >= 0.005 * LAMPORTS_PER_SOL) return;
    setBusy("Getting devnet SOL for fees");
    for (let i = 0; i < 4; i++) {
      const r = await fetch("/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: s.publicKey.toBase58() }) }).then((x) => x.json()).catch(() => ({ result: "error" }));
      if (r.result === "sent" || r.result === "has-sol") break;
      if (r.result === "empty" || r.result === "off") throw new Error("This wallet has no devnet SOL for fees.");
      await sleep(3000);
    }
    for (let i = 0; i < 12; i++) {
      if ((await connection.getBalance(s.publicKey)) >= 0.005 * LAMPORTS_PER_SOL) return;
      await sleep(1500);
    }
    throw new Error("This wallet has no devnet SOL for fees.");
  }, [connection]);

  const faucetIxs = useCallback(async (s: Signer) => {
    const ata = getAssociatedTokenAddressSync(BID_MINT, s.publicKey);
    const p = program(connection, s.publicKey);
    return [
      createAssociatedTokenAccountIdempotentInstruction(s.publicKey, ata, s.publicKey, BID_MINT),
      await p.methods.faucet().accountsPartial({ user: s.publicKey, yard: YARD, bidMint: BID_MINT, userTokenAccount: ata, tap: tapPda(s.publicKey), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction(),
    ];
  }, [connection, program]);

  const run = useCallback(async (label: string, f: (s: Signer) => Promise<void>) => {
    if (!signer) { setError("Pick a wallet first."); return false; }
    setError(null); setBusy(label);
    try { await f(signer); return true; } catch (e) { setError(plain(e)); return false; } finally { setBusy(null); void refresh(signer.publicKey); }
  }, [signer, refresh]);

  const topUp = useCallback(() => run("Getting 500 test dollars", async (s) => {
    await ensureSol(s);
    setBusy("Getting 500 test dollars");
    await send(s, new Transaction().add(...(await faucetIxs(s))), connection);
  }), [run, ensureSol, send, faucetIxs, connection]);

  const join = useCallback((unitId: number, deposit: number) => run("Lining up", async (s) => {
    await ensureSol(s);
    const have = (await refresh(s.publicKey))?.tok ?? 0;
    const need = Math.round(deposit * USD);
    const unit = unitPda(unitId);
    const ata = getAssociatedTokenAddressSync(BID_MINT, s.publicKey);
    const tx = new Transaction();
    if (have < need) tx.add(...(await faucetIxs(s)));
    tx.add(await program(connection, s.publicKey).methods.joinUnit(new BN(need))
      .accountsPartial({ bidder: s.publicKey, yard: YARD, unit, bidderRecord: bidderPda(unit, s.publicKey), bidderTokenAccount: ata, vault: VAULT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction());
    setBusy("Lining up with your deposit");
    await send(s, tx, connection);
  }), [run, ensureSol, refresh, faucetIxs, program, connection, send]);

  const bid = useCallback((unitId: number, amount: number) => run("Opening the private rollup", async (s) => {
    const who = s.publicKey.toBase58();
    if (teeConn.current?.who !== who) {
      // One signature proves to the rollup who is asking. It is not a transaction.
      const auth = await getAuthToken(TEE_RPC, s.publicKey, (m: Uint8Array) => s.signMessage(m));
      teeConn.current = { who, conn: new Connection(`${TEE_RPC}?token=${auth.token}`, { commitment: "confirmed" }) };
    }
    const conn = teeConn.current.conn;
    const unit = unitPda(unitId);
    const bidKey = bidPda(unit, s.publicKey);
    const p = program(conn, s.publicKey);
    const perm = { permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: EPHEMERAL_VAULT_ID, magicProgram: MAGIC_PROGRAM_ID };
    const tx = new Transaction().add(
      await p.methods.placeBid(new BN(Math.round(amount * USD))).accountsPartial({ bidder: s.publicKey, unit, bid: bidKey }).instruction(),
      await p.methods.sealBid().accountsPartial({ unit, bid: bidKey, permission: permissionPdaFromAccount(bidKey), ...perm }).instruction(),
    );
    setBusy("Sealing your bid");
    await send(s, tx, conn);
    setMyBids((m) => {
      const n = { ...m, [unitId]: amount };
      try { sessionStorage.setItem("lockup.my-bids", JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  }), [run, program, send]);

  const value: PlayerState = {
    ready, address: signer?.publicKey.toBase58() ?? null, walletName: signer?.name ?? null, isQuick: signer?.kind === "quick",
    sol, dollars, extensions, busy, error, myBids,
    useQuick: () => { setError(null); setSigner(quickSigner()); },
    useExtension: async (name) => {
      setError(null);
      const found = injected().find((i) => i.name === name);
      if (!found) { setError(`${name} was not found in this browser.`); return; }
      try { setSigner(await extensionSigner(name, found.provider)); } catch (e) { setError(plain(e)); }
    },
    disconnect: () => { signer?.disconnect(); teeConn.current = null; setSigner(null); },
    clearError: () => setError(null),
    join, bid, topUp,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
