import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap flex min-h-[100svh] flex-col justify-center py-32">
      <p className="label text-ink-3">404 · no unit at this address</p>
      <h1 className="display mt-4 text-[clamp(72px,13vw,200px)]">Empty <span className="hl">unit.</span></h1>
      <p className="mt-6 max-w-[460px] text-[17px] text-ink-2">Somebody cleared this one out, or it was never here. The yard still has doors to open.</p>
      <div className="mt-8 flex gap-3"><Link href="/yard" className="btn btn-primary">Enter the yard</Link><Link href="/" className="btn btn-ghost">Home</Link></div>
    </div>
  );
}
