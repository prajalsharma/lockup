"use client";
/**
 * Email and Google sign-in through Privy, with a Solana wallet created for the user on first
 * login. Only loaded when NEXT_PUBLIC_PRIVY_APP_ID is set, and only after the page has started.
 */
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useEffect, useMemo, useRef } from "react";
import { PRIVY_APP_ID, PRIVY_GOOGLE, type EmailWallet } from "./email-wallet";
import { RPC } from "./shared";

/** Reads Privy's state and hands it up to the app. Renders nothing. */
function Bridge({ onChange }: { onChange: (w: EmailWallet | null) => void }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0] ?? null;

  // Privy hands back new function objects on every render. The app is told only when something
  // it can see changes (ready, signed in, address); the functions are reached through a ref so
  // they are always current without re-publishing.
  const live = useRef({ wallet, login, logout, signMessage, signTransaction });
  live.current = { wallet, login, logout, signMessage, signTransaction };
  const isReady = ready && walletsReady;
  const address = authenticated && wallet ? wallet.address : null;
  useEffect(() => {
    onChange({
      ready: isReady, authenticated, address,
      login: () => live.current.login(),
      logout: () => live.current.logout(),
      signMessage: async (message) => {
        const w = live.current.wallet;
        if (!w) throw new Error("Your wallet is still being set up. Try again in a moment.");
        return (await live.current.signMessage({ message, wallet: w, options: { uiOptions: { showWalletUIs: false } } })).signature;
      },
      signTransaction: async (transaction) => {
        const w = live.current.wallet;
        if (!w) throw new Error("Your wallet is still being set up. Try again in a moment.");
        return (await live.current.signTransaction({ transaction, wallet: w, chain: "solana:devnet", options: { uiOptions: { showWalletUIs: false } } })).signedTransaction;
      },
    });
  }, [isReady, authenticated, address, onChange]);
  useEffect(() => () => onChange(null), [onChange]);
  return null;
}

/**
 * Mounted beside the app, not around it: the app must not wait for this library before it starts.
 */
export default function PrivyIsland({ onChange }: { onChange: (w: EmailWallet | null) => void }) {
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
      <Bridge onChange={onChange} />
    </PrivyProvider>
  );
}
