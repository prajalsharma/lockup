"use client";
import { createContext } from "react";

/** A wallet created by signing in with email or Google (Privy). Null when Privy is not configured. */
export interface EmailWallet {
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  login(): void;
  logout(): Promise<void>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Takes and returns a serialized transaction. */
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
}

export const EmailWalletCtx = createContext<EmailWallet | null>(null);
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
/** Google sign-in also has to be switched on in the Privy dashboard before this is set. */
export const PRIVY_GOOGLE = process.env.NEXT_PUBLIC_PRIVY_GOOGLE === "1";
