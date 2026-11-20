import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", "/yard", "/market", "/haul"];
  return paths.map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: "daily", priority: p === "" ? 1 : 0.6 }));
}
