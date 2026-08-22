import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { buildRobotsDocument } from "@/seo/robots-policy";
import { readSearchExposure } from "@/seo/search-exposure";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return buildRobotsDocument(readSearchExposure());
}
