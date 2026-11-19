"use client";
import Link from "next/link";
import { pad2, usd } from "@/lib/format";
import { useYard, yard } from "@/lib/yard/sim";

export function HaulShelf() {
  const { player, ready } = useYard();
  if (!ready) return <p className="label py-24 text-ink-3">Opening your locker</p>;
  const paid = player.finds.reduce((s, f) => s + f.paid, 0);
  const value = player.finds.reduce((s, f) => s + f.value, 0);
  const net = value - paid;
  return (
    <>
      <dl className="grid grid-cols-2 gap-y-8 border-b border-line pb-10 md:grid-cols-4">
        <div><dt className="label text-ink-3">Units opened</dt><dd className="display num mt-1 text-[56px] leading-none">{player.wins}</dd></div>
        <div><dt className="label text-ink-3">Rounds played</dt><dd className="display num mt-1 text-[56px] leading-none">{player.rounds}</dd></div>
        <div><dt className="label text-ink-3">Paid</dt><dd className="display num mt-1 text-[56px] leading-none">{usd(paid)}</dd></div>
        <div><dt className="label text-ink-3">{net >= 0 ? "Ahead by" : "Down by"}</dt><dd className={`display num mt-1 text-[56px] leading-none ${net >= 0 ? "text-accent-text" : "text-bad"}`}>{usd(Math.abs(net))}</dd></div>
      </dl>

      {player.finds.length === 0 ? (
        <div className="py-20">
          <p className="display text-[clamp(40px,5vw,72px)]">Nothing on the shelf yet</p>
          <p className="mt-4 max-w-[480px] text-[17px] text-ink-2">Win a unit and everything inside it lands here.</p>
          <Link href="/yard" className="btn btn-primary mt-8">Enter the yard <span className="arrow" aria-hidden>→</span></Link>
        </div>
      ) : (
        <ol className="mt-2">
          {player.finds.map((f) => {
            const n = f.value - f.paid;
            return (
              <li key={`${f.unit}-${f.round}-${f.at}`} className="grid gap-x-10 gap-y-4 border-b border-line py-8 md:grid-cols-[180px_1fr_200px]">
                <div>
                  <p className="stencil text-[72px] text-ink">{pad2(f.unit)}</p>
                  <p className="label mt-2 text-ink-3">Round {f.round}</p>
                </div>
                <ul className="flex flex-wrap content-start gap-2">
                  {f.contents.map((l) => (
                    <li key={l.item.id} className={`border px-3 py-2 ${l.item.rarity === "grail" ? "border-accent-text text-accent-text" : "border-line-2"}`}>
                      <span className="block text-[15px] font-semibold">{l.qty > 1 ? `${l.qty} × ` : ""}{l.item.name}</span>
                      <span className="label num text-ink-3">{usd(l.item.value * l.qty)} · {l.item.rarity}</span>
                    </li>
                  ))}
                </ul>
                <div className="md:text-right">
                  <p className="label text-ink-3">Paid {usd(f.paid)} · held {usd(f.value)}</p>
                  <p className={`display num mt-1 text-[44px] leading-none ${n >= 0 ? "text-accent-text" : "text-bad"}`}>{n >= 0 ? "+" : "−"}{usd(Math.abs(n))}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {player.rounds > 0 && (
        <button type="button" className="ulink ulink-on mt-10 text-sm text-ink-2" onClick={() => { if (window.confirm("Clear your practice record and start again with 500 test dollars?")) yard.reset(); }}>Reset my practice record</button>
      )}
    </>
  );
}
