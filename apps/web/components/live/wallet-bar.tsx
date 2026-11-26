"use client";
import { usePlayer } from "@/lib/chain/player";
import { explorer } from "@/lib/config";
import { short, usd } from "@/lib/format";

/** Wallet summary shown on a unit page, or the prompt to connect. `held` is the deposit this wallet has escrowed in the unit. */
export function WalletBar({ held }: { held?: number }) {
  const p = usePlayer();
  if (!p.ready) return <p className="label text-ink-3">Checking for a wallet</p>;
  if (!p.address) {
    return (
      <div>
        <button type="button" className="btn btn-primary" onClick={p.openPicker}>Connect a wallet to play <span className="arrow" aria-hidden>→</span></button>
        <p className="mt-3 max-w-[460px] text-sm text-ink-2">Any Solana wallet works. No extension? Pick the quick wallet in the list.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div>
        <p className="label text-ink-3">{p.walletName}</p>
        <a className="ulink num mt-1 inline-block" href={explorer(p.address)} target="_blank" rel="noreferrer">{short(p.address)}</a>
      </div>
      <div><p className="label text-ink-3">Devnet USDC</p><p className="num mt-1">{p.dollars === null ? "reading devnet" : usd(p.dollars)}</p></div>
      <div><p className="label text-ink-3">Devnet SOL</p><p className="num mt-1">{p.sol === null ? "reading devnet" : p.sol.toFixed(3)}</p></div>
      {held ? <div><p className="label text-ink-3">Held in this unit</p><p className="num mt-1">{usd(held)}</p></div> : null}
      {p.dollars === 0 && !held && <button type="button" className="btn btn-ghost btn-sm" disabled={!!p.busy} onClick={() => void p.topUp()}>Get starter USDC</button>}
      <a className="ulink ulink-on text-sm text-ink-2" href="https://faucet.circle.com" target="_blank" rel="noreferrer">More from Circle's faucet</a>
    </div>
  );
}
