import type { MetadataRoute } from "next";
import { DEMOS } from "@/lib/demos";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, priority: 1 }, ...DEMOS.map((d) => ({ url: `${SITE_URL}/demo/${d.id}`, priority: 0.8 }))];
}
