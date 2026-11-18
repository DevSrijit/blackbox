import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // /trace shows a file that a visitor opened in their own browser. It has nothing to index.
  return { rules: { userAgent: "*", allow: "/", disallow: "/trace" }, sitemap: `${SITE_URL}/sitemap.xml` };
}
