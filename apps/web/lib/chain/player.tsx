"use client";
/**
 * The player's wallet and the three things a player does on chain: get test dollars, line up
 * with a deposit (Solana), and place a sealed bid (private rollup).
 *
 * Two kinds of wallet: any Solana wallet extension found through the wallet standard
 * (Phantom, Solflare, Backpack and others), or a quick wallet whose key is made and kept in
 * this browser. Both sign locally; the site never sees a key from an extension.
 */
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { EmailWalletCtx, PRIVY_APP_ID } from "./email-wallet";
import { BID_MINT, RPC, TEE_RPC, USD, VAULT, YARD, bidPda, bidderPda, sleep, tapPda, unitPda } from "./shared";

interface Signer {
  kind: "quick" | "extension" | "email";
  name: string;
  icon?: string;
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
}

const QUICK_KEY = "lockup.quick-wallet";
const MODE_KEY = "lockup.wallet-mode";

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
  };
}

export interface WalletChoice { name: string; icon: string; installed: boolean }

interface PlayerState {
  ready: boolean;
  address: string | null;
  walletName: string | null;
  walletIcon: string | null;
  isQuick: boolean;
  connecting: boolean;
  sol: number | null;
  dollars: number | null;
  choices: WalletChoice[];
  pickerOpen: boolean;
  busy: string | null;
  error: string | null;
  myBids: Record<number, number>;
  openPicker(): void;
  closePicker(): void;
  /** True when email / Google sign-in is configured. */
  emailLogin: boolean;
  useEmail(): void;
  useQuick(): void;
  useExtension(name: string): void;
  disconnect(): void;
  join(unitId: number, deposit: number): Promise<boolean>;
  bid(unitId: number, amount: number): Promise<boolean>;
  topUp(): Promise<boolean>;
  refresh(): void;
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
  if (/User rejected|rejected the request|cancel/i.test(m)) return "You cancelled that in your wallet.";
  if (/insufficient lamports|insufficient funds for (fee|rent)|Attempt to debit/i.test(m)) return "This wallet has no devnet SOL for fees.";
  if (/429|Too Many/i.test(m)) return "Devnet is busy. Try again in a few seconds.";
  if (/does not support|signMessage/i.test(m)) return "This wallet can't sign messages, which the private rollup needs. Try another wallet.";
  return m.split("\n")[0].slice(0, 140);
};

/** Anchor and the MagicBlock SDK are loaded only when a transaction is actually built. */
async function chainKit() {
  const [anchor, mb, idl] = await Promise.all([import("@coral-xyz/anchor"), import("@magicblock-labs/ephemeral-rollups-sdk"), import("./idl.json")]);
  const program = (conn: Connection, who: PublicKey) => {
    const wallet = { publicKey: who, signTransaction: async (t: unknown) => t, signAllTransactions: async (t: unknown) => t };
    return new anchor.Program(idl.default as never, new anchor.AnchorProvider(conn, wallet as never, { commitment: "confirmed" }));
  };
  return { BN: anchor.BN, program, mb };
}

function Inner({ children }: { children: React.ReactNode }) {
  const adapter = useWallet();
  const email = useContext(EmailWalletCtx);
  const [mode, setMode] = useState<"quick" | "extension" | "email" | null>(null);
  const [quick, setQuick] = useState<Signer | null>(null);
  const [ready, setReady] = useState(false);
  const [sol, setSol] = useState<number | null>(null);
  const [dollars, setDollars] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myBids, setMyBids] = useState<Record<number, number>>({});
  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);
  const teeConn = useRef<{ who: string; conn: Connection } | null>(null);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "quick" && localStorage.getItem(QUICK_KEY)) { setQuick(quickSigner()); setMode("quick"); }
      if (m === "extension") setMode("extension");
      if (m === "email") setMode("email");
      setMyBids(JSON.parse(sessionStorage.getItem("lockup.my-bids") || "{}"));
    } catch { /* storage blocked */ }
    setReady(true);
  }, []);

  const signer: Signer | null = useMemo(() => {
    if (mode === "quick") return quick;
    if (mode === "extension" && adapter.connected && adapter.publicKey && adapter.wallet) {
      const a = adapter;
      return {
        kind: "extension", name: a.wallet!.adapter.name, icon: a.wallet!.adapter.icon, publicKey: a.publicKey!,
        signTransaction: async (tx) => {
          if (!a.signTransaction) throw new Error("This wallet does not support signing transactions.");
          return a.signTransaction(tx);
        },
        signMessage: async (m) => {
          if (!a.signMessage) throw new Error("This wallet does not support signMessage.");
          return a.signMessage(m);
        },
      };
    }
    if (mode === "email" && email?.address) {
      const e = email;
      return {
        kind: "email", name: "Email wallet", publicKey: new PublicKey(e.address!),
        signTransaction: async (tx) => Transaction.from(await e.signTransaction(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))),
        signMessage: (m) => e.signMessage(m),
      };
    }
    return null;
  }, [mode, quick, adapter, email]);

  const who = signer?.publicKey.toBase58() ?? null;

  const refreshFor = useCallback(async (key: PublicKey) => {
    try {
      const [lamports, tok] = await Promise.all([
        connection.getBalance(key),
        connection.getTokenAccountBalance(getAssociatedTokenAddressSync(BID_MINT, key)).then((b) => Number(b.value.amount), () => 0),
      ]);
      setSol(lamports / LAMPORTS_PER_SOL);
      setDollars(tok / USD);
      return { lamports, tok };
    } catch { return null; }
  }, [connection]);

  useEffect(() => {
    if (!who) { setSol(null); setDollars(null); return; }
    const key = new PublicKey(who);
    void refreshFor(key);
    const t = setInterval(() => { if (document.visibilityState === "visible") void refreshFor(key); }, 12000);
    return () => clearInterval(t);
  }, [who, refreshFor]);

  /** Sign locally, send and wait. The site sends the transaction itself, so the wallet's own network setting does not matter. */
  const send = useCallback(async (s: Signer, tx: Transaction, conn: Connection) => {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.feePayer = s.publicKey;
    tx.recentBlockhash = blockhash;
    const signed = await s.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
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
    const { program } = await chainKit();
    const ata = getAssociatedTokenAddressSync(BID_MINT, s.publicKey);
    return [
      createAssociatedTokenAccountIdempotentInstruction(s.publicKey, ata, s.publicKey, BID_MINT),
      await program(connection, s.publicKey).methods.faucet().accountsPartial({ user: s.publicKey, yard: YARD, bidMint: BID_MINT, userTokenAccount: ata, tap: tapPda(s.publicKey), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction(),
    ];
  }, [connection]);

  const run = useCallback(async (label: string, f: (s: Signer) => Promise<void>) => {
    if (!signer) { setPickerOpen(true); return false; }
    setError(null); setBusy(label);
    try { await f(signer); return true; } catch (e) { setError(plain(e)); return false; } finally { setBusy(null); void refreshFor(signer.publicKey); }
  }, [signer, refreshFor]);

  const topUp = useCallback(() => run("Getting 500 test dollars", async (s) => {
    await ensureSol(s);
    setBusy("Getting 500 test dollars");
    await send(s, new Transaction().add(...(await faucetIxs(s))), connection);
  }), [run, ensureSol, send, faucetIxs, connection]);

  const join = useCallback((unitId: number, deposit: number) => run("Lining up", async (s) => {
    await ensureSol(s);
    const { BN, program } = await chainKit();
    const have = (await refreshFor(s.publicKey))?.tok ?? 0;
    const need = Math.round(deposit * USD);
    const unit = unitPda(unitId);
    const ata = getAssociatedTokenAddressSync(BID_MINT, s.publicKey);
    const tx = new Transaction();
    if (have < need) tx.add(...(await faucetIxs(s)));
    tx.add(await program(connection, s.publicKey).methods.joinUnit(new BN(need))
      .accountsPartial({ bidder: s.publicKey, yard: YARD, unit, bidderRecord: bidderPda(unit, s.publicKey), bidderTokenAccount: ata, vault: VAULT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction());
    setBusy("Lining up with your deposit");
    await send(s, tx, connection);
  }), [run, ensureSol, refreshFor, faucetIxs, connection, send]);

  const bid = useCallback((unitId: number, amount: number) => run("Opening the private rollup", async (s) => {
    const { BN, program, mb } = await chainKit();
    const key = s.publicKey.toBase58();
    if (teeConn.current?.who !== key) {
      // One signed message proves to the rollup who is asking. It is not a transaction.
      const auth = await mb.getAuthToken(TEE_RPC, s.publicKey, (m: Uint8Array) => s.signMessage(m));
      teeConn.current = { who: key, conn: new Connection(`${TEE_RPC}?token=${auth.token}`, { commitment: "confirmed" }) };
    }
    const conn = teeConn.current.conn;
    const unit = unitPda(unitId);
    const bidKey = bidPda(unit, s.publicKey);
    const p = program(conn, s.publicKey);
    const perm = { permissionProgram: mb.PERMISSION_PROGRAM_ID, ephemeralVault: mb.EPHEMERAL_VAULT_ID, magicProgram: mb.MAGIC_PROGRAM_ID };
    const tx = new Transaction().add(
      await p.methods.placeBid(new BN(Math.round(amount * USD))).accountsPartial({ bidder: s.publicKey, unit, bid: bidKey }).instruction(),
      await p.methods.sealBid().accountsPartial({ unit, bid: bidKey, permission: mb.permissionPdaFromAccount(bidKey), ...perm }).instruction(),
    );
    setBusy("Sealing your bid");
    await send(s, tx, conn);
    setMyBids((m) => {
      const n = { ...m, [unitId]: amount };
      try { sessionStorage.setItem("lockup.my-bids", JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  }), [run, send]);

  const remember = (m: "quick" | "extension" | "email" | null) => {
    try { if (m) localStorage.setItem(MODE_KEY, m); else localStorage.removeItem(MODE_KEY); } catch { /* ignore */ }
    setMode(m);
  };

  const choices: WalletChoice[] = adapter.wallets
    .filter((w) => w.readyState === "Installed" || w.readyState === "Loadable")
    .map((w) => ({ name: w.adapter.name, icon: w.adapter.icon, installed: w.readyState === "Installed" }));

  // Selecting a wallet in the adapter is asynchronous; connect once it is selected.
  const wantConnect = useRef(false);
  useEffect(() => {
    if (!wantConnect.current || !adapter.wallet || adapter.connected || adapter.connecting) return;
    wantConnect.current = false;
    adapter.connect().then(() => setPickerOpen(false)).catch((e) => { setError(plain(e)); remember(null); });
  }, [adapter]);
  useEffect(() => { if (mode === "extension" && adapter.connected) setPickerOpen(false); }, [mode, adapter.connected]);

  const value: PlayerState = {
    ready: ready && (mode !== "email" || !email || email.ready), address: who, walletName: signer?.name ?? null, walletIcon: signer?.icon ?? null, isQuick: signer?.kind === "quick",
    connecting: adapter.connecting, sol, dollars, choices, pickerOpen, busy, error, myBids,
    openPicker: () => { setError(null); setPickerOpen(true); },
    closePicker: () => setPickerOpen(false),
    emailLogin: !!email,
    useEmail: () => { setError(null); remember("email"); setPickerOpen(false); if (email && !email.authenticated) email.login(); },
    useQuick: () => { setError(null); setQuick(quickSigner()); remember("quick"); setPickerOpen(false); },
    useExtension: (name) => {
      setError(null);
      remember("extension");
      wantConnect.current = true;
      const w = adapter.wallets.find((x) => x.adapter.name === name);
      if (w) adapter.select(w.adapter.name);
    },
    disconnect: () => {
      teeConn.current = null;
      if (mode === "extension") void adapter.disconnect().catch(() => undefined);
      if (mode === "email") void email?.logout().catch(() => undefined);
      remember(null);
    },
    join, bid, topUp,
    refresh: () => { if (signer) void refreshFor(signer.publicKey); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const PrivyBridge = dynamic(() => import("./privy"));
/** Email sign-in is only mounted when a Privy app is configured; otherwise its code is never loaded. */
function EmailLayer({ children }: { children: React.ReactNode }) {
  return PRIVY_APP_ID ? <PrivyBridge>{children}</PrivyBridge> : <>{children}</>;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // An empty list is deliberate: the provider finds every installed wallet through the wallet standard.
  const wallets = useMemo(() => [], []);
  return (
    <EmailLayer>
      <ConnectionProvider endpoint={RPC}>
        <WalletProvider wallets={wallets} autoConnect>
          <Inner>{children}</Inner>
        </WalletProvider>
      </ConnectionProvider>
    </EmailLayer>
  );
}
