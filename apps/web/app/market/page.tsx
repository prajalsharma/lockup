import type { Metadata } from "next";
import { MarketView } from "@/components/market";

export const metadata: Metadata = { title: "Market", description: "Items won from units, listed for sale by the wallets that hold them. Read from Solana devnet." };

export default function MarketPage() {
  return (
    <div className="wrap pb-28 pt-28 md:pt-36">
      <p className="label flex items-center gap-2.5 text-ink-2"><span className="inline-block h-2 w-2 bg-accent" aria-hidden />Open listings, read from Solana devnet</p>
      <h1 className="display mt-4 text-[clamp(64px,9vw,136px)]">Market</h1>
      <p className="mt-4 max-w-[560px] text-[17px] text-ink-2">Winners keep what they find or sell it here, one piece at a time.</p>
      <div className="mt-10"><MarketView /></div>
    </div>
  );
}
