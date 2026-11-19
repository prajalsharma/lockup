import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", "/yard", "/haul", ...[3, 7, 12, 18, 24, 31].map((n) => `/unit/${n}`)];
  return paths.map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: "daily", priority: p === "" ? 1 : 0.6 }));
}
