import type { Metadata, Viewport } from "next";
import { Anton, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Reveals, SmoothScroll } from "@/components/smooth-scroll";
import { WalletPicker } from "@/components/wallet-ui";
import { PlayerProvider } from "@/lib/chain/player";
import { SITE_URL } from "@/lib/config";
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });
const plex = IBM_Plex_Mono({ weight: ["400", "500", "600"], subsets: ["latin"], variable: "--font-plex-mono", display: "swap" });

const title = "Lockup: bid blind, open the door";
const description = "Sealed-bid storage units on Solana. Read three clues, place a bid nobody can see, and the highest bid rolls the door up.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: "%s · Lockup" },
  description,
  applicationName: "Lockup",
  openGraph: { title, description, siteName: "Lockup", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#efe9dd",
  width: "device-width",
  initialScale: 1,
};

// The yard opens in daylight. Dark is used only when a visitor has picked it.
const themeScript = `try{var t=localStorage.getItem("lockup.theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${anton.variable} ${hanken.variable} ${plex.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">Skip to content</a>
        <SmoothScroll />
        <Reveals />
        <PlayerProvider>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
          <WalletPicker />
        </PlayerProvider>
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
