/**
 * Shapes shared by the practice yard (browser sim) and the on-chain yard.
 * Mirrors docs/CONTRACTS.md so the chain source can drop in behind the same UI.
 */
export type Rarity = "common" | "rare" | "grail";

export interface CatalogItem {
  id: string;
  name: string;
  /** Appraised value in test dollars. Set in the on-chain catalog. */
  value: number;
  rarity: Rarity;
  group: "electronics" | "music" | "sport" | "arcade" | "metal" | "paper";
  heavy?: boolean;
}

export interface Clue {
  kind: "count" | "group" | "floor" | "grail" | "heavy";
  text: string;
}

export type Phase = "bidding" | "opening" | "opened";

export interface RivalBid {
  who: string;
  bid: number;
}

export interface Lot {
  item: CatalogItem;
  qty: number;
}

export interface Unit {
  id: number;
  round: number;
  phase: Phase;
  /** Paint colour of the door. */
  paint: string;
  minBid: number;
  closesAt: number;
  clues: Clue[];
  /** Public: how many bids are sealed. Amounts stay hidden until opened. */
  bidCount: number;
  myBid: number | null;
  /** Filled only once the unit is opened. */
  result: null | {
    bids: RivalBid[];
    winner: string;
    winningBid: number;
    contents: Lot[];
    value: number;
  };
}

export interface Find {
  unit: number;
  round: number;
  paid: number;
  value: number;
  contents: Lot[];
  at: number;
}

export interface Player {
  balance: number;
  rounds: number;
  wins: number;
  finds: Find[];
}

export const YOU = "You";
