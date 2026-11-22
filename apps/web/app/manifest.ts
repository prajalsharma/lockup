import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lockup", short_name: "Lockup",
    description: "Sealed-bid storage units on Solana.",
    start_url: "/yard", display: "standalone", background_color: "#efe9dd", theme_color: "#efe9dd",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
