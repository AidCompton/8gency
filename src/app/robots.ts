import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/", "/privacy", "/terms", "/leak-calculator", "/waitlist"], disallow: ["/app", "/api", "/hub", "/reset", "/invite", "/signup"] }, sitemap: `${SITE.url}/sitemap.xml` };
}
