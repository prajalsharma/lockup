"use client";
/**
 * Email and Google sign-in through Privy, with a Solana wallet created for the user on first
 * login. Only loaded when NEXT_PUBLIC_PRIVY_APP_ID is set.
 */
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useMemo } from "react";
import { EmailWalletCtx, PRIVY_APP_ID, PRIVY_GOOGLE, type EmailWallet } from "./email-wallet";
import { RPC } from "./shared";

function Bridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0] ?? null;

  const value: EmailWallet = useMemo(() => ({
    ready: ready && walletsReady,
    authenticated,
    address: authenticated && wallet ? wallet.address : null,
    login: () => login(),
    logout,
    signMessage: async (message) => {
      if (!wallet) throw new Error("Your wallet is still being set up. Try again in a moment.");
      return (await signMessage({ message, wallet, options: { uiOptions: { showWalletUIs: false } } })).signature;
    },
    signTransaction: async (transaction) => {
      if (!wallet) throw new Error("Your wallet is still being set up. Try again in a moment.");
      return (await signTransaction({ transaction, wallet, chain: "solana:devnet", options: { uiOptions: { showWalletUIs: false } } })).signedTransaction;
    },
  }), [ready, walletsReady, authenticated, wallet, login, logout, signMessage, signTransaction]);

  return <EmailWalletCtx.Provider value={value}>{children}</EmailWalletCtx.Provider>;
}

export default function PrivyBridge({ children }: { children: React.ReactNode }) {
  const rpcs = useMemo(() => ({
    "solana:devnet": {
      rpc: createSolanaRpc(RPC),
      rpcSubscriptions: createSolanaRpcSubscriptions(RPC.replace(/^http/, "ws")),
      blockExplorerUrl: "https://explorer.solana.com",
    },
  }), []);
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: PRIVY_GOOGLE ? ["email", "google"] : ["email"],
        appearance: { theme: "dark", accentColor: "#ffb01f", walletChainType: "solana-only" },
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        solana: { rpcs },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}
