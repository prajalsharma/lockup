/**
 * The path a consigned item takes, drawn as one line with a stop per step. Each stop names the
 * layer that acts there, so it is clear which parts are Solana and which are MagicBlock.
 * `at` is how far along a player's items are: stops up to it are filled.
 */
const STOPS = [
  { where: "Your wallet", what: "You hold the item" },
  { where: "Solana", what: "It joins the yard's warehouse" },
  { where: "MagicBlock VRF", what: "A random draw puts it in a unit" },
  { where: "Private rollup", what: "Hidden while the bids are sealed" },
  { where: "Solana", what: "The program pays you its share" },
];

export function Journey({ at = -1, className = "" }: { at?: number; className?: string }) {
  return (
    <ol className={`grid gap-y-0 md:grid-cols-5 ${className}`} aria-label="How a consigned item is sold">
      {STOPS.map((s, i) => {
        const done = i <= at;
        const magic = s.where !== "Solana" && s.where !== "Your wallet";
        return (
          <li key={i} className="relative flex gap-4 pb-6 last:pb-0 md:block md:pb-0 md:pr-6">
            {/* The line: down the side on a phone, across the top on a wide screen. */}
            {i < STOPS.length - 1 && <span aria-hidden className={`absolute left-[5px] top-3 h-full w-px md:left-3 md:top-[5px] md:h-px md:w-full ${i < at ? "bg-accent-text" : "bg-line-2"}`} />}
            <span aria-hidden className={`relative z-10 mt-[1px] block h-[11px] w-[11px] shrink-0 border ${done ? "border-accent-text bg-accent-text" : "border-line-2 bg-ground"} ${magic ? "rotate-45" : ""}`} />
            <div className="md:mt-4">
              <p className={`label ${magic ? "text-accent-text" : "text-ink-3"}`}>{s.where}</p>
              <p className={`mt-1 text-[15px] leading-snug ${done ? "text-ink" : "text-ink-2"}`}>{s.what}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
