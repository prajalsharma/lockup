/**
 * A player's standing in the yard. Everything here is worked out from what the chain already
 * says about a wallet: the rounds it joined and what it won. Nothing is stored for it.
 */
import type { HaulRound } from "@/lib/chain/types";

export const RANKS = [
  { name: "Rookie", at: 0 },
  { name: "Picker", at: 1 },
  { name: "Hauler", at: 3 },
  { name: "Dealer", at: 6 },
  { name: "Yard boss", at: 10 },
] as const;

export interface Standing { rank: string; index: number; opened: number; next: string | null; toNext: number; progress: number }

/** Rank goes by units opened. */
export function standing(rounds: HaulRound[]): Standing {
  const opened = rounds.filter((r) => r.won).length;
  let index = 0;
  RANKS.forEach((r, i) => { if (opened >= r.at) index = i; });
  const next = RANKS[index + 1] ?? null;
  return {
    rank: RANKS[index].name, index, opened,
    next: next ? next.name : null,
    toNext: next ? next.at - opened : 0,
    // Measured from zero, so the bar always shows the units already opened.
    progress: next ? opened / next.at : 1,
  };
}

export interface Badge { id: string; name: string; how: string; earned: boolean }

export function badges(rounds: HaulRound[]): Badge[] {
  const done = rounds.filter((r) => r.status === "closed");
  const wins = done.filter((r) => r.won);
  return [
    { id: "first", name: "First door", how: "Open a unit.", earned: wins.length > 0 },
    { id: "steal", name: "Steal", how: "Win a unit for less than half what it held.", earned: wins.some((r) => r.winningBid > 0 && r.value >= r.winningBid * 2) },
    { id: "grail", name: "Grail", how: "Open a unit with a grail inside.", earned: wins.some((r) => r.lots.some((l) => l.rarity === 2)) },
    { id: "close", name: "By a nose", how: "Lose a unit by five cents or less.", earned: done.some((r) => !r.won && r.bid !== null && r.winningBid - r.bid <= 0.05 && r.winningBid >= r.bid) },
    { id: "burned", name: "Burned", how: "Pay more for a unit than it held.", earned: wins.some((r) => r.winningBid > r.value) },
  ];
}

/** How a win turned out, for the stamp on an opened unit. */
export function verdict(paid: number, value: number): { word: string; good: boolean } {
  if (paid <= 0) return { word: "Free", good: true };
  if (value >= paid * 2) return { word: "Steal", good: true };
  if (value >= paid) return { word: "Good buy", good: true };
  return { word: "Burned", good: false };
}
