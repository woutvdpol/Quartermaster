import type { MetadataRoute } from "next";
import { getSeoScope } from "@/server/seo/http";
import { closedRobots, networkRobots, platformRobots, shopRobots } from "@/lib/seo/robots";

/*
 * Per-host robots.txt (rules: src/lib/seo/robots.ts, docs/seo-geo.md):
 *  - live shop:   crawlable minus private areas and crawl traps; AI search bots welcome; AI training
 *                 bots blocked when settings content.seo.allowAiTraining is off
 *  - coming soon: everything disallowed (shops still in the setup wizard; src/server/storefront/launch.ts)
 *  - platform:    landing + application page + network (/network) crawlable, admin/API not
 *  - network:     NETWORK_HOST (docs/network.md): network pages crawlable, API not
 *  - unknown:     everything disallowed
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const scope = await getSeoScope();
  switch (scope.kind) {
    case "shop":
      return shopRobots({ origin: scope.shop.origin, allowAiTraining: scope.shop.settings.content.seo.allowAiTraining });
    case "platform":
      return platformRobots(scope.origin);
    case "network":
      return networkRobots(scope.origin);
    default:
      return closedRobots();
  }
}
