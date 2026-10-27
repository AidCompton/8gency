import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/leak-calculator", "/waitlist", "/privacy", "/terms"].map((p) => ({ url: `${SITE.url}${p}` }));
}
