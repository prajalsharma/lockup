"use client";
/**
 * The player's wallet and the things a player does on chain: get starter funds, line up
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
import { EmailWalletCtx, PRIVY_APP_ID, type EmailWallet } from "./email-wallet";
import { BID_MINT, RPC, TEE_RPC, USD, VAULT, YARD, bidPda, bidderPda, listingPda, sleep, stallPda, unitPda } from "./shared";

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
  /** Put items up for sale at a price each. */
  sell(mint: string, price: number, qty: number): Promise<boolean>;
  /** Take a listing down and get the items back. */
  unlist(mint: string): Promise<boolean>;
  /** Buy one item from a listing. */
  buy(l: { seller: string; mint: string; price: number }): Promise<boolean>;
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
  if (/caused by account: (listing|stall)[\s\S]*AccountNotInitialized/.test(m)) return "That listing is gone. Someone else just bought it.";
  if (/Error: insufficient funds|custom program error: 0x1\b/.test(m)) return "Not enough USDC in this wallet for that.";
  const named = /Error Message: ([^.]+)\./.exec(m);
  if (named) return named[1] + ".";
  if (/User rejected|rejected the request|cancel/i.test(m)) return "You cancelled that in your wallet.";
  if (/insufficient lamports|insufficient funds for (fee|rent)|Attempt to debit/i.test(m)) return "This wallet has no devnet SOL for fees.";
  if (/^Not enough USDC|^Starter USDC|^Starter funds/.test(m)) return m;
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

  /**
   * Starter funds from the keeper: devnet SOL for fees if the wallet has none, and 1 USDC the
   * first time a wallet shows up. Returns what the wallet holds afterwards.
   */
  const starter = useCallback(async (s: Signer) => {
    const before = await refreshFor(s.publicKey);
    const needSol = (before?.lamports ?? 0) < 0.005 * LAMPORTS_PER_SOL;
    const needUsdc = (before?.tok ?? 0) === 0;
    if (!needSol && !needUsdc) return before;
    setBusy("Getting starter funds");
    let r: { sol?: string; usdc?: string } = {};
    for (let i = 0; i < 4; i++) {
      r = await fetch("/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: s.publicKey.toBase58() }) }).then((x) => x.json()).catch(() => ({}));
      if (r.sol !== "busy" && r.sol !== undefined) break;
      await sleep(3500);
    }
    if (r.sol === "limit" || (needUsdc && r.usdc === "limit")) throw new Error("Starter funds are rationed and this hour's are gone. Try again later, or use Circle's faucet.");
    if (needSol && r.sol !== "sent") throw new Error("This wallet has no devnet SOL for fees.");
    for (let i = 0; i < 10; i++) {
      const now = await refreshFor(s.publicKey);
      const solOk = !needSol || (now?.lamports ?? 0) >= 0.005 * LAMPORTS_PER_SOL;
      const usdcOk = r.usdc !== "sent" || (now?.tok ?? 0) > 0;
      if (solOk && usdcOk) return now;
      await sleep(1500);
    }
    return refreshFor(s.publicKey);
  }, [refreshFor]);

  const run = useCallback(async (label: string, f: (s: Signer) => Promise<void>) => {
    if (!signer) { setPickerOpen(true); return false; }
    setError(null); setBusy(label);
    try { await f(signer); return true; } catch (e) { setError(plain(e)); return false; } finally { setBusy(null); void refreshFor(signer.publicKey); }
  }, [signer, refreshFor]);

  const topUp = useCallback(() => run("Getting starter funds", async (s) => {
    const after = await starter(s);
    if ((after?.tok ?? 0) === 0) throw new Error("Starter USDC is given once per wallet. Get more from Circle's faucet.");
  }), [run, starter]);

  const join = useCallback((unitId: number, deposit: number) => run("Lining up", async (s) => {
    const funds = await starter(s);
    const { BN, program } = await chainKit();
    const have = funds?.tok ?? 0;
    const need = Math.round(deposit * USD);
    if (have < need) throw new Error(`Not enough USDC. Deposit is $${deposit.toFixed(2)}, wallet has $${(have / USD).toFixed(2)}.`);
    const unit = unitPda(unitId);
    const ata = getAssociatedTokenAddressSync(BID_MINT, s.publicKey);
    const tx = new Transaction().add(await program(connection, s.publicKey).methods.joinUnit(new BN(need))
      .accountsPartial({ bidder: s.publicKey, yard: YARD, unit, bidderRecord: bidderPda(unit, s.publicKey), bidderTokenAccount: ata, vault: VAULT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction());
    setBusy("Lining up with your deposit");
    await send(s, tx, connection);
  }), [run, starter, connection, send]);

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

  const sell = useCallback((mintStr: string, price: number, qty: number) => run("Listing it for sale", async (s) => {
    const { BN, program } = await chainKit();
    const mint = new PublicKey(mintStr);
    const listing = listingPda(s.publicKey, mint);
    const tx = new Transaction().add(await program(connection, s.publicKey).methods.listItem(new BN(Math.round(price * USD)), new BN(qty))
      .accountsPartial({ seller: s.publicKey, yard: YARD, itemMint: mint, sellerItemAccount: getAssociatedTokenAddressSync(mint, s.publicKey), listing, stall: stallPda(listing), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).instruction());
    await send(s, tx, connection);
  }), [run, connection, send]);

  const unlist = useCallback((mintStr: string) => run("Taking it back", async (s) => {
    const { program } = await chainKit();
    const mint = new PublicKey(mintStr);
    const listing = listingPda(s.publicKey, mint);
    const ata = getAssociatedTokenAddressSync(mint, s.publicKey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(s.publicKey, ata, s.publicKey, mint),
      await program(connection, s.publicKey).methods.cancelListing()
        .accountsPartial({ seller: s.publicKey, yard: YARD, listing, stall: stallPda(listing), sellerItemAccount: ata, tokenProgram: TOKEN_PROGRAM_ID }).instruction(),
    );
    await send(s, tx, connection);
  }), [run, connection, send]);

  const buy = useCallback((l: { seller: string; mint: string; price: number }) => run("Buying it", async (s) => {
    const { BN, program } = await chainKit();
    const mint = new PublicKey(l.mint), seller = new PublicKey(l.seller);
    const listing = listingPda(seller, mint);
    const itemAta = getAssociatedTokenAddressSync(mint, s.publicKey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(s.publicKey, itemAta, s.publicKey, mint),
      await program(connection, s.publicKey).methods.buyItem(new BN(1), new BN(Math.round(l.price * USD)))
        .accountsPartial({ buyer: s.publicKey, yard: YARD, listing, seller, stall: stallPda(listing), buyerTokenAccount: getAssociatedTokenAddressSync(BID_MINT, s.publicKey), sellerTokenAccount: getAssociatedTokenAddressSync(BID_MINT, seller), buyerItemAccount: itemAta, tokenProgram: TOKEN_PROGRAM_ID }).instruction(),
    );
    await send(s, tx, connection);
  }), [run, connection, send]);

  const remember = (m: "quick" | "extension" | "email" | null) => {
    try { if (m) localStorage.setItem(MODE_KEY, m); else localStorage.removeItem(MODE_KEY); } catch { /* ignore */ }
    setMode(m);
  };

  const choices: WalletChoice[] = adapter.wallets
    .filter((w) => w.readyState === "Installed" || w.readyState === "Loadable")
    .map((w) => ({ name: w.adapter.name, icon: w.adapter.icon, installed: w.readyState === "Installed" }));

  // Email sign-in chosen before Privy finished loading: open its login as soon as it is ready.
  const wantLogin = useRef(false);
  useEffect(() => {
    if (!wantLogin.current || !email?.ready) return;
    wantLogin.current = false;
    if (!email.authenticated) email.login();
  }, [email]);

  // Selecting a wallet in the adapter is asynchronous; connect once it is selected.
  const wantConnect = useRef(false);
  useEffect(() => {
    if (!wantConnect.current || !adapter.wallet || adapter.connected || adapter.connecting) return;
    wantConnect.current = false;
    adapter.connect().then(() => setPickerOpen(false)).catch((e) => { setError(plain(e)); remember(null); });
  }, [adapter]);
  useEffect(() => { if (mode === "extension" && adapter.connected) setPickerOpen(false); }, [mode, adapter.connected]);

  const value: PlayerState = {
    ready: ready && (mode !== "email" || (email ? email.ready : !PRIVY_APP_ID)), address: who, walletName: signer?.name ?? null, walletIcon: signer?.icon ?? null, isQuick: signer?.kind === "quick",
    connecting: adapter.connecting, sol, dollars, choices, pickerOpen, busy, error, myBids,
    openPicker: () => { setError(null); setPickerOpen(true); },
    closePicker: () => setPickerOpen(false),
    emailLogin: !!PRIVY_APP_ID,
    useEmail: () => { setError(null); remember("email"); setPickerOpen(false); if (email?.ready) { if (!email.authenticated) email.login(); } else wantLogin.current = true; },
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
    join, bid, topUp, sell, unlist, buy,
    refresh: () => { if (signer) void refreshFor(signer.publicKey); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const PrivyIsland = dynamic(() => import("./privy"), { ssr: false });
/**
 * Email sign-in. Privy is loaded beside the app, after it has started, and reports its state
 * here. Wrapping the app in it instead would make every page wait for that library.
 */
function EmailLayer({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<EmailWallet | null>(null);
  return (
    <EmailWalletCtx.Provider value={wallet}>
      {children}
      {PRIVY_APP_ID && <PrivyIsland onChange={setWallet} />}
    </EmailWalletCtx.Provider>
  );
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
