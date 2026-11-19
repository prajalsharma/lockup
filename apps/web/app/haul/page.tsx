import type { Metadata } from "next";
import { HaulView } from "@/components/haul";

export const metadata: Metadata = { title: "My haul", description: "The units you opened and the items in your wallet, read from Solana devnet." };

export default function HaulPage() {
  return (
    <div className="wrap pb-28 pt-28 md:pt-36">
      <p className="label flex items-center gap-2.5 text-ink-2"><span className="inline-block h-2 w-2 bg-accent" aria-hidden />Read from Solana devnet for your connected wallet</p>
      <h1 className="display mt-4 text-[clamp(64px,9vw,136px)]">My haul</h1>
      <div className="mt-10"><HaulView /></div>
    </div>
  );
}
