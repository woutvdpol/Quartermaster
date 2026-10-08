/*
 * AI crawlers and fetchers, by what they do (docs/seo-geo.md §GEO lists the sources). Pure.
 *
 *  - TRAINING crawlers collect content to train models. A shop can opt out of these
 *    (settings content.seo.allowAiTraining) without disappearing from AI answers.
 *  - SEARCH crawlers / user fetchers retrieve pages to show and cite them in AI search answers
 *    (ChatGPT search, Claude, Perplexity …). Blocking them removes the shop from those answers, so
 *    they always follow the normal `*` rules.
 *
 * Google AI Overviews / AI Mode use the regular Googlebot (governed by `*`); "Google-Extended" only
 * controls Gemini model training and grounding. Likewise Applebot (search) vs "Applebot-Extended".
 */

export const AI_TRAINING_BOTS = [
  "GPTBot", // OpenAI — model training
  "ClaudeBot", // Anthropic — model training
  "Google-Extended", // Google — Gemini training / grounding (not Search, not AI Overviews)
  "Applebot-Extended", // Apple — foundation model training (Applebot itself stays allowed)
  "CCBot", // Common Crawl — widely used as training data
  "meta-externalagent", // Meta — AI training
] as const;

export const AI_SEARCH_BOTS = [
  "OAI-SearchBot", // OpenAI — ChatGPT search index
  "ChatGPT-User", // OpenAI — fetches a page a ChatGPT user asked about
  "Claude-SearchBot", // Anthropic — search index for Claude
  "Claude-User", // Anthropic — fetches a page a Claude user asked about
  "PerplexityBot", // Perplexity — search index (not used for training per Perplexity)
  "Perplexity-User", // Perplexity — user-initiated fetches
  "DuckAssistBot", // DuckDuckGo — AI answers
] as const;

/**
 * User agents that should get *blocking* metadata (all tags in <head>) instead of Next's streamed
 * metadata. Next's default list covers classic crawlers and link-preview bots; AI fetchers are not
 * in it and many of them do not execute JavaScript. Used by next.config.ts (`htmlLimitedBots`),
 * which replaces Next's list — so this extends it.
 */
export const EXTRA_HTML_LIMITED_BOTS = [
  ...AI_TRAINING_BOTS.filter((b) => b !== "Google-Extended" && b !== "Applebot-Extended"), // tokens, not user agents
  ...AI_SEARCH_BOTS,
  "Amazonbot",
  "MistralAI-User",
  "YouBot",
] as const;

/** `next/dist`'s default HTML-limited bot pattern extended with EXTRA_HTML_LIMITED_BOTS. */
export function htmlLimitedBotsPattern(defaultSource: string): RegExp {
  const extra = EXTRA_HTML_LIMITED_BOTS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`${defaultSource}|${extra}`, "i");
}
