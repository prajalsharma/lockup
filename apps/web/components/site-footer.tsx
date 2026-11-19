import Link from "next/link";
import { MAGICBLOCK, PROGRAM_ID, REPO_URL, explorer } from "@/lib/config";
import { Wordmark } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="wrap grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-sm text-ink-2">Sealed-bid storage units on Solana. Built for Solana Blitz v10 on MagicBlock.</p>
          <p className="label mt-6 text-ink-3">Test network. Nothing here is worth real money.</p>
        </div>
        <div>
          <p className="label text-ink-3">Play</p>
          <ul className="mt-4 space-y-2.5">
            <li><Link className="ulink" href="/yard">The yard</Link></li>
            <li><Link className="ulink" href="/haul">My haul</Link></li>
            <li><Link className="ulink" href="/#how">How it works</Link></li>
            <li><Link className="ulink" href="/#limits">What it can't do</Link></li>
          </ul>
        </div>
        <div>
          <p className="label text-ink-3">Check</p>
          <ul className="mt-4 space-y-2.5">
            <li>{PROGRAM_ID ? <a className="ulink" href={explorer(PROGRAM_ID)} target="_blank" rel="noreferrer">Lockup program</a> : <span className="text-ink-3">Lockup program: not deployed yet</span>}</li>
            <li><a className="ulink" href={explorer(MAGICBLOCK.vrf)} target="_blank" rel="noreferrer">MagicBlock VRF</a></li>
            <li><a className="ulink" href={explorer(MAGICBLOCK.permission)} target="_blank" rel="noreferrer">Permission program</a></li>
            <li><a className="ulink" href="https://docs.magicblock.gg" target="_blank" rel="noreferrer">MagicBlock docs</a></li>
            {REPO_URL && <li><a className="ulink" href={REPO_URL} target="_blank" rel="noreferrer">Source code</a></li>}
          </ul>
        </div>
      </div>
    </footer>
  );
}
