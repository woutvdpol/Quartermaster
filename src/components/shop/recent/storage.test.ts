import { describe, expect, it } from "vitest";
import { RECENT_MAX, addRecent, parseRecent, pushRecent, readRecent, recentKey, type RecentStorage } from "./storage";

function memory(): RecentStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("recently viewed storage", () => {
  it("adds newest first, de-duplicates and caps at RECENT_MAX", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_MAX + 5; i++) list = addRecent(list, `p${i}`);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe(`p${RECENT_MAX + 4}`);
    list = addRecent(list, "p10");
    expect(list[0]).toBe("p10");
    expect(list.filter((x) => x === "p10")).toHaveLength(1);
  });

  it("ignores invalid ids", () => {
    expect(addRecent(["a"], "../x")).toEqual(["a"]);
    expect(addRecent(["a"], "")).toEqual(["a"]);
  });

  it("parses defensively", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('["a","a",1,"<b>","c"]')).toEqual(["a", "c"]);
    expect(parseRecent(JSON.stringify(Array.from({ length: 30 }, (_, i) => `x${i}`)))).toHaveLength(RECENT_MAX);
  });

  it("keeps a list per shop host", () => {
    const s = memory();
    pushRecent("concept.localhost:3000", "a", s);
    pushRecent("concept.localhost:3000", "b", s);
    pushRecent("other.test", "z", s);
    expect(readRecent("concept.localhost:3000", s)).toEqual(["b", "a"]);
    expect(readRecent("OTHER.test", s)).toEqual(["z"]);
    expect([...s.data.keys()]).toEqual([recentKey("concept.localhost:3000"), recentKey("other.test")]);
  });

  it("survives throwing or missing storage", () => {
    const broken: RecentStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(readRecent("h", broken)).toEqual([]);
    expect(pushRecent("h", "a", broken)).toEqual(["a"]);
    expect(readRecent("h", null)).toEqual([]);
    expect(pushRecent("h", "a", null)).toEqual(["a"]);
  });
});
