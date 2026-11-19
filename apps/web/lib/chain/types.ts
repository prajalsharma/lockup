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
  lots: DoorLot[];
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

/** One lot of a unit's contents, as shown in the 3D unit and the result lists. */
export interface DoorLot { name: string; id: string; rarity: number; heavy: boolean; qty: number; value: number }

export interface HaulRound {
  unit: number;
  address: string;
  status: ChainUnit["status"];
  deposit: number;
  bid: number | null;
  won: boolean;
  settled: boolean;
  winningBid: number;
  value: number;
  lots: DoorLot[];
}
export interface Haul {
  address: string;
  dollars: number;
  items: { name: string; id: string; rarity: number; qty: number; value: number; mint: string }[];
  rounds: HaulRound[];
}
