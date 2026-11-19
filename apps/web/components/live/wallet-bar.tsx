"use client";
import { explorer } from "@/lib/config";
import { short, usd } from "@/lib/format";
import { usePlayer } from "@/lib/chain/player";

export function WalletBar() {
  const p = usePlayer();
  if (!p.ready) return <p className="label text-ink-3">Checking for a wallet</p>;
  if (!p.address) {
    return (
      <div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={p.useQuick}>Play with a quick wallet</button>
          {p.extensions.map((name) => (
            <button key={name} type="button" className="btn btn-ghost" onClick={() => void p.useExtension(name)}>Connect {name}</button>
          ))}
        </div>
        <p className="mt-3 max-w-[460px] text-sm text-ink-2">
          A quick wallet is made in this browser and only ever holds devnet test tokens. We send it a little devnet SOL for fees.
        </p>
        {p.error && <p role="alert" className="mt-2 text-sm text-bad">{p.error}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div>
        <p className="label text-ink-3">{p.walletName}</p>
        <a className="ulink num mt-1 inline-block" href={explorer(p.address)} target="_blank" rel="noreferrer">{short(p.address)}</a>
      </div>
      <div>
        <p className="label text-ink-3">Test dollars</p>
        <p className="num mt-1">{p.dollars === null ? "reading devnet" : usd(p.dollars)}</p>
      </div>
      <div>
        <p className="label text-ink-3">Devnet SOL</p>
        <p className="num mt-1">{p.sol === null ? "reading devnet" : p.sol.toFixed(3)}</p>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!!p.busy} onClick={() => void p.topUp()}>Get 500 test dollars</button>
      <button type="button" className="ulink ulink-on text-sm text-ink-2" onClick={p.disconnect}>{p.isQuick ? "Use another wallet" : "Disconnect"}</button>
    </div>
  );
}
