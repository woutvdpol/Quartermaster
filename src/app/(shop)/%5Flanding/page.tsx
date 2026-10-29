import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRequestScope } from "@/server/tenant";
import { PlatformLanding } from "../_platform/PlatformLanding";
import { platformCopy as t } from "../_platform/_copy";

/*
 * The platform landing. URL "/_landing", reached as "/" on PLATFORM_HOST through the proxy rewrite
 * (platformLandingRewrite, src/lib/network.ts): a route of its own keeps its client JS out of every shop home page.
 */

export const metadata: Metadata = {
  title: { absolute: `${t.name} — ${t.tagline}` },
  description: t.metaDescription,
  alternates: { canonical: "/" },
};

export default async function PlatformLandingPage() {
  if ((await getRequestScope()).kind !== "platform") notFound();
  return <PlatformLanding />;
}
