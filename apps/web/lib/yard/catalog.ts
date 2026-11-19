import type { CatalogItem } from "./types";

/** Each entry becomes one SPL mint in the on-chain warehouse. Values are test dollars. */
export const CATALOG: CatalogItem[] = [
  { id: "cables", name: "Box of cables", value: 4, rarity: "common", group: "electronics" },
  { id: "crt", name: "CRT television", value: 12, rarity: "common", group: "electronics", heavy: true },
  { id: "deck", name: "Cassette deck", value: 18, rarity: "common", group: "music" },
  { id: "vinyl", name: "Crate of vinyl", value: 26, rarity: "common", group: "music", heavy: true },
  { id: "bike", name: "Road bike", value: 30, rarity: "common", group: "sport" },
  { id: "boards", name: "Skate decks", value: 22, rarity: "common", group: "sport" },
  { id: "binder", name: "Card binder", value: 55, rarity: "rare", group: "paper" },
  { id: "jersey", name: "Signed jersey", value: 70, rarity: "rare", group: "sport" },
  { id: "synth", name: "Analog synth", value: 95, rarity: "rare", group: "music" },
  { id: "cabinet", name: "Arcade cabinet", value: 120, rarity: "rare", group: "arcade", heavy: true },
  { id: "pinball", name: "Pinball table", value: 240, rarity: "grail", group: "arcade", heavy: true },
  { id: "bar", name: "Gold bar", value: 400, rarity: "grail", group: "metal", heavy: true },
];

export const GROUP_CLUE: Record<CatalogItem["group"], string> = {
  electronics: "Wires and screens in here",
  music: "Something that plays music",
  sport: "Sports gear inside",
  arcade: "A coin slot was spotted",
  metal: "Something metal and very dense",
  paper: "A stack of card sleeves",
};
