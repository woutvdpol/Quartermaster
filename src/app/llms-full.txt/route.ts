import { getSeoScope, notFoundResponse, textResponse } from "@/server/seo/http";
import { loadLlmsInput } from "@/server/seo/llms";
import { llmsFullTxt } from "@/lib/seo/llms";

/** /llms-full.txt: categories with descriptions, facet landing pages and the latest items (≤ 100 kB). */
export async function GET() {
  const scope = await getSeoScope();
  if (scope.kind !== "shop") return notFoundResponse();
  return textResponse(llmsFullTxt(await loadLlmsInput(scope.shop, true)), "text/plain");
}
