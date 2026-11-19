import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveStage } from "@/components/live/live-stage";
import { pad2 } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Live unit ${pad2(Number(id) || 0)}`, description: "A storage unit on Solana devnet. Line up, read the clues and place a sealed bid." };
}

export default async function LiveUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) notFound();
  return (
    <div className="wrap pb-24 pt-24 md:pt-28">
      <Link href="/yard" className="ulink label text-ink-2">← Back to the yard</Link>
      <div className="mt-6"><LiveStage unitId={n} /></div>
    </div>
  );
}
