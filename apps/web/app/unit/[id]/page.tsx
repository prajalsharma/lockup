import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UnitStage } from "@/components/unit-stage";
import { pad2 } from "@/lib/format";

const IDS = [3, 7, 12, 18, 24, 31];
export function generateStaticParams() { return IDS.map((id) => ({ id: String(id) })); }
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Unit ${pad2(Number(id))}`, description: `Read the clues on unit ${pad2(Number(id))} and seal a bid before the door opens.` };
}

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!IDS.includes(n)) notFound();
  return (
    <div className="wrap pb-24 pt-24 md:pt-28">
      <Link href="/yard" className="ulink label text-ink-2">← Back to the yard</Link>
      <div className="mt-6"><UnitStage unitId={n} /></div>
    </div>
  );
}
