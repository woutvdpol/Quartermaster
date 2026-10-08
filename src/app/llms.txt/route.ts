import { getSeoScope, notFoundResponse, textResponse } from "@/server/seo/http";
import { loadLlmsInput } from "@/server/seo/llms";
import { llmsTxt, platformLlmsTxt } from "@/lib/seo/llms";

/** /llms.txt (https://llmstxt.org) for the request's shop, or the platform. docs/seo-geo.md §GEO. */
export async function GET() {
  const scope = await getSeoScope();
  if (scope.kind === "platform") return textResponse(platformLlmsTxt(scope.origin), "text/plain");
  if (scope.kind !== "shop") return notFoundResponse();
  return textResponse(llmsTxt(await loadLlmsInput(scope.shop, false)), "text/plain");
}
