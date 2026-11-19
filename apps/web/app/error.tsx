"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap flex min-h-[100svh] flex-col justify-center py-32">
      <p className="label text-ink-3">Something jammed</p>
      <h1 className="display mt-4 text-[clamp(64px,10vw,152px)]">The door stuck.</h1>
      <p className="mt-6 max-w-[460px] text-[17px] text-ink-2">The page hit an error. Nothing on chain was affected.</p>
      <button type="button" className="btn btn-primary mt-8 self-start" onClick={reset}>Try again</button>
    </div>
  );
}
