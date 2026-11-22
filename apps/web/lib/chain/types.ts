export interface ChainUnit {
  id: number;
  address: string;
  status: "created" | "open" | "bidding" | "closed";
  onRollup: boolean;
  /** Solo: you against two house bidders. Multi: players only. Read from the unit's clock length. */
  mode: "solo" | "multi";
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
  /** First bytes of the unit's VRF randomness, as hex. Empty until the draw lands. */
  draw: string;
}
export interface ChainYard {
  programId: string;
  yard: string;
  unitCount: number;
  settled: number;
  keeper: boolean;
  units: ChainUnit[];
  /** Players ranked by what they came out ahead across the units they opened. House bidders are left out. */
  board: { who: string; opened: number; profit: number; best: number }[];
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

/** One open resale listing, read from Solana. Prices are per item. */
export interface MarketListing {
  address: string;
  seller: string;
  mint: string;
  id: string;
  name: string;
  rarity: number;
  /** Appraised value of one item. */
  value: number;
  price: number;
  qty: number;
}
