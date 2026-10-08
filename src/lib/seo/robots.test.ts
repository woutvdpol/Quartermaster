import { describe, expect, it } from "vitest";
import { AI_SEARCH_BOTS, AI_TRAINING_BOTS, htmlLimitedBotsPattern } from "./bots";
import { SHOP_PRIVATE_PATHS, closedRobots, platformRobots, shopRobots } from "./robots";

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const rulesOf = (r: { rules: Rule | Rule[] }) => (Array.isArray(r.rules) ? r.rules : [r.rules]);
const agents = (rule: Rule) => [rule.userAgent ?? []].flat();

describe("shopRobots", () => {
  it("allows the shop, disallows private paths and links the sitemap", () => {
    const robots = shopRobots({ origin: "https://s.example", allowAiTraining: true });
    const star = rulesOf(robots).find((r) => agents(r).includes("*"))!;
    expect(star.allow).toBe("/");
    for (const p of ["/cart", "/checkout", "/account", "/wishlist", "/order/", "/offer/", "/admin", "/api/", "/*?*q=", "/*?*sort="]) expect(star.disallow).toContain(p);
    // Product, catalog, CMS, markdown and image URLs stay crawlable.
    for (const p of ["/product", "/shop", "/uploads", "/llms.txt"]) expect([star.disallow].flat().some((d) => d === p)).toBe(false);
    expect(robots.sitemap).toBe("https://s.example/sitemap.xml");
  });

  it("welcomes AI search and training bots by default", () => {
    const rules = rulesOf(shopRobots({ origin: "https://s.example", allowAiTraining: true }));
    const ai = rules.find((r) => agents(r).includes("OAI-SearchBot"))!;
    for (const bot of [...AI_SEARCH_BOTS, ...AI_TRAINING_BOTS]) expect(agents(ai)).toContain(bot);
    expect(ai.allow).toBe("/");
    expect(rules.some((r) => r.disallow === "/")).toBe(false);
  });

  it("blocks only training bots when the shop opts out", () => {
    const rules = rulesOf(shopRobots({ origin: "https://s.example", allowAiTraining: false }));
    const blocked = rules.find((r) => r.disallow === "/")!;
    expect(agents(blocked).sort()).toEqual([...AI_TRAINING_BOTS].sort());
    const search = rules.find((r) => agents(r).includes("OAI-SearchBot"))!;
    expect(search.allow).toBe("/");
    for (const bot of AI_TRAINING_BOTS) expect(agents(search)).not.toContain(bot);
    for (const bot of ["ClaudeBot", "GPTBot", "Google-Extended", "Applebot-Extended"]) expect(agents(blocked)).toContain(bot);
    for (const bot of ["Claude-SearchBot", "OAI-SearchBot", "PerplexityBot", "ChatGPT-User"]) expect(agents(blocked)).not.toContain(bot);
  });
});

describe("closed / platform robots", () => {
  it("disallows everything while closed", () => {
    expect(closedRobots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
  it("keeps the platform landing crawlable but not the admin", () => {
    const r = platformRobots("https://platform.example");
    const [rule] = rulesOf(r);
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(expect.arrayContaining(["/admin", "/api/", "/apply/"]));
  });
});

describe("htmlLimitedBotsPattern", () => {
  it("extends Next's default list with AI fetchers", () => {
    const re = htmlLimitedBotsPattern("Bingbot|Twitterbot");
    for (const ua of ["Mozilla/5.0 (compatible; GPTBot/1.2)", "ClaudeBot/1.0", "PerplexityBot/1.0", "OAI-SearchBot/1.0", "Bingbot"]) expect(re.test(ua)).toBe(true);
    expect(re.test("Mozilla/5.0 (Macintosh) Safari/605.1.15")).toBe(false);
  });
});

describe("private paths", () => {
  it("are absolute prefixes", () => {
    for (const p of SHOP_PRIVATE_PATHS) expect(p.startsWith("/")).toBe(true);
  });
});
