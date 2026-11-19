/** Public config. Nothing here is secret. Unset values mean "not live yet" and the UI says so. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

import yardFile from "./chain/yard.json";

export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ?? yardFile.programId;
export const YARD_ADDRESS = yardFile.yard;
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";
export const DEVNET_RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

/** MagicBlock programs LOCKUP calls. Read from ephemeral-rollups-sdk 0.16.2 and its VRF SDK. */
export const MAGICBLOCK = {
  delegation: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
  permission: "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
  vrf: "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz",
  teeValidator: "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
};

export const explorer = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;
