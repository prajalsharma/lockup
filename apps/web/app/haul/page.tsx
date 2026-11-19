import type { Metadata } from "next";
import { HaulShelf } from "@/components/haul-shelf";

export const metadata: Metadata = { title: "My haul", description: "Everything you have pulled out of a unit, and what you paid for it." };

export default function HaulPage() {
  return (
    <div className="wrap pb-28 pt-28 md:pt-36">
      <p className="label text-ink-2">Practice record · saved in this browser only</p>
      <h1 className="display mt-4 text-[clamp(64px,9vw,136px)]">My haul</h1>
      <div className="mt-10"><HaulShelf /></div>
    </div>
  );
}
