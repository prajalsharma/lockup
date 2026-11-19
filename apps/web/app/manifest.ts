import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lockup", short_name: "Lockup",
    description: "Sealed-bid storage units on Solana.",
    start_url: "/yard", display: "standalone", background_color: "#0a0b0e", theme_color: "#0a0b0e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
