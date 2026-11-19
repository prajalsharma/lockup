export interface ChainUnit {
  id: number;
  address: string;
  status: "created" | "open" | "bidding" | "closed";
  onRollup: boolean;
  stocked: boolean;
  minBid: number;
  duration: number;
  closesAt: number;
  bidCount: number;
  bids: { who: string; house: boolean; deposit: number; hasBid: boolean; bid: number | null }[];
  clues: { kind: number; arg: number }[];
  winner: string | null;
  winningBid: number;
  value: number;
  lots: { name: string; id: string; rarity: number; qty: number; value: number }[];
  claimed: boolean;
}
export interface ChainYard {
  programId: string;
  yard: string;
  unitCount: number;
  settled: number;
  keeper: boolean;
  units: ChainUnit[];
  readAt: number;
}
