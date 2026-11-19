"use client";
import NumberFlow from "@number-flow/react";
import { useEffect, useState } from "react";
import { DEVNET_RPC, PROGRAM_ID, explorer } from "@/lib/config";
import yardFile from "@/lib/chain/yard.json";
import { useChainYard } from "@/components/chain-rounds";

function useSlot() {
  const [slot, setSlot] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const r = await fetch(DEVNET_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "confirmed" }] }) });
        const j = await r.json();
        if (live && typeof j.result === "number") { setSlot(j.result); setFailed(false); }
      } catch { if (live) setFailed(true); }
    };
    void read();
    const t = setInterval(() => { if (document.visibilityState === "visible") void read(); }, 8000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return { slot, failed };
}

const Diamond = () => <span className="hidden text-ink-3 sm:inline" aria-hidden>◆</span>;

export function Facts() {
  const { slot, failed } = useSlot();
  const chain = useChainYard(15000);
  return (
    <dl className="label flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-5 text-ink-2">
      <div className="flex gap-2">
        <dt className="text-ink-3">Devnet slot</dt>
        <dd className="num text-ink">
          {slot !== null
            ? <a className="ulink" href="https://explorer.solana.com/?cluster=devnet" target="_blank" rel="noreferrer"><NumberFlow value={slot} /></a>
            : failed ? "devnet not answering" : "reading devnet"}
        </dd>
      </div>
      <Diamond />
      <div className="flex gap-2"><dt className="text-ink-3">Units created on chain</dt><dd className="num text-ink">{chain.data ? <a className="ulink" href="/yard#onchain"><NumberFlow value={chain.data.unitCount} /></a> : chain.failed ? "devnet not answering" : "reading devnet"}</dd></div>
      <Diamond />
      <div className="flex gap-2"><dt className="text-ink-3">Items in the catalog</dt><dd className="num text-ink">{yardFile.items.length}</dd></div>
      <Diamond />
      <div className="flex gap-2">
        <dt className="text-ink-3">Program</dt>
        <dd className="text-ink">{PROGRAM_ID ? <a className="ulink num" href={explorer(PROGRAM_ID)} target="_blank" rel="noreferrer">{PROGRAM_ID.slice(0, 4)}…{PROGRAM_ID.slice(-4)}</a> : "not deployed yet"}</dd>
      </div>
    </dl>
  );
}
