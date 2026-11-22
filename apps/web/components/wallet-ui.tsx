"use client";
import { useEffect, useRef, useState } from "react";
import { PRIVY_GOOGLE } from "@/lib/chain/email-wallet";
import { usePlayer } from "@/lib/chain/player";
import { explorer } from "@/lib/config";
import { short, usd } from "@/lib/format";
import { RollingUsd } from "@/components/juice";

/** Header button: "Connect wallet", or the connected address with a small menu. */
export function ConnectButton() {
  const p = usePlayer();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);

  if (!p.ready) return <span className="btn btn-ghost btn-sm invisible">Connect wallet</span>;
  if (!p.address) return <button type="button" className="btn btn-primary btn-sm" onClick={p.openPicker}>{p.connecting ? "Connecting" : "Connect wallet"}</button>;
  return (
    <div ref={box} className="relative">
      <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        {p.walletIcon && <img src={p.walletIcon} alt="" width={16} height={16} />}
        <span className="num">{short(p.address)}</span>
        <span className="num hidden text-ink-2 sm:inline">{p.dollars === null ? "" : <RollingUsd value={p.dollars} />}</span>
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 top-[46px] z-50 w-[280px] border border-line-2 bg-ground p-4">
          <p className="label text-ink-3">{p.walletName} · devnet</p>
          <p className="num mt-1 break-all text-[13px]">{p.address}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div><dt className="label text-ink-3">Devnet USDC</dt><dd className="num mt-1">{p.dollars === null ? "reading" : usd(p.dollars)}</dd></div>
            <div><dt className="label text-ink-3">Devnet SOL</dt><dd className="num mt-1">{p.sol === null ? "reading" : p.sol.toFixed(3)}</dd></div>
          </dl>
          <div className="mt-4 flex flex-col gap-2">
            {p.dollars === 0 && <button type="button" role="menuitem" className="btn btn-ghost btn-sm" disabled={!!p.busy} onClick={() => void p.topUp()}>{p.busy ?? "Get starter USDC"}</button>}
            <a role="menuitem" className="btn btn-ghost btn-sm" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle USDC faucet</a>
            <button type="button" role="menuitem" className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(p.address!); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>{copied ? "Copied" : "Copy address"}</button>
            <a role="menuitem" className="btn btn-ghost btn-sm" href={explorer(p.address)} target="_blank" rel="noreferrer">Open in explorer</a>
            <button type="button" role="menuitem" className="btn btn-ghost btn-sm" onClick={() => { p.disconnect(); setMenu(false); }}>Disconnect</button>
          </div>
          {p.error && <p role="alert" className="mt-3 text-sm text-bad">{p.error}</p>}
        </div>
      )}
    </div>
  );
}

/** The wallet picker. Lists every Solana wallet extension the browser has, plus the quick wallet. */
export function WalletPicker() {
  const p = usePlayer();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!p.pickerOpen) return;
    first.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") p.closePicker(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [p.pickerOpen, p]);
  if (!p.pickerOpen) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5" onMouseDown={(e) => { if (e.target === e.currentTarget) p.closePicker(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="wallet-title" className="brackets w-full max-w-[440px] border border-line-2 bg-ground p-7">
        <div className="flex items-start justify-between gap-6">
          <h2 id="wallet-title" className="display text-[40px] leading-none">Connect a wallet</h2>
          <button type="button" aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-ink-2 hover:text-ink" onClick={p.closePicker}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
        </div>
        <p className="mt-3 text-ink-2">Lockup runs on Solana devnet. You sign every deposit and bid yourself.</p>

        <ul className="mt-6 border-t border-line">
          {p.emailLogin && (
            <li className="border-b border-line">
              <button type="button" className="group flex w-full items-center gap-4 py-4 text-left" onClick={p.useEmail}>
                <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-ground" aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="2.5" width="12" height="9" rx="1" /><path d="M1.5 3.5L7 8l5.5-4.5" /></svg>
                </span>
                <span>
                  <span className="block text-[17px] font-semibold">{PRIVY_GOOGLE ? "Email or Google" : "Email"}</span>
                  <span className="block text-sm text-ink-2">Sign in and get a wallet made for you.</span>
                </span>
                <span className="label ml-auto text-ink-3 transition-colors group-hover:text-ink">No install</span>
              </button>
            </li>
          )}
          {p.choices.map((c, i) => (
            <li key={c.name} className="border-b border-line">
              <button ref={i === 0 ? first : undefined} type="button" className="group flex w-full items-center gap-4 py-4 text-left" onClick={() => p.useExtension(c.name)}>
                <img src={c.icon} alt="" width={28} height={28} className="rounded-md" />
                <span className="text-[17px] font-semibold">{c.name}</span>
                <span className="label ml-auto text-ink-3 transition-colors group-hover:text-ink">{c.installed ? "Detected" : "Open"}</span>
              </button>
            </li>
          ))}
          <li className="border-b border-line">
            <button ref={p.choices.length === 0 ? first : undefined} type="button" className="group flex w-full items-center gap-4 py-4 text-left" onClick={p.useQuick}>
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-on-accent" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M8 0L2 8h4l-1 6 6-8H7z" /></svg>
              </span>
              <span>
                <span className="block text-[17px] font-semibold">Quick wallet</span>
                <span className="block text-sm text-ink-2">Made in this browser. Devnet only.</span>
              </span>
              <span className="label ml-auto text-ink-3 transition-colors group-hover:text-ink">No install</span>
            </button>
          </li>
        </ul>
        {p.choices.length === 0 && <p className="mt-4 text-sm text-ink-2">No wallet extension found in this browser. Install Phantom, Solflare or Backpack, or pick another option above.</p>}
        {p.error && <p role="alert" className="mt-4 text-sm text-bad">{p.error}</p>}
        <p className="mt-5 text-sm text-ink-3">New wallets are sent a little devnet SOL for fees and 1 devnet USDC to start. Nothing here has real value.</p>
      </div>
    </div>
  );
}
