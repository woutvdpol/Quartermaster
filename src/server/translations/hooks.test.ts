import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueue = vi.fn(async () => "job");
let locales: string[] = ["nl"];
vi.mock("@/server/jobs/queue", () => ({ enqueue }));
vi.mock("@/server/settings", () => ({ getSettings: vi.fn(async () => ({ locales })) }));

const { onAudited, translationHookFor } = await import("./hooks");

const ID = "cmabcdefghijklmnopqrstuv";

describe("translationHookFor", () => {
  it("maps source-text mutations to an entity sync", () => {
    expect(translationHookFor("product.update", "Product", ID)).toEqual({ kind: "entity", entity: "PRODUCT", entityId: ID });
    expect(translationHookFor("category.create", "Category", ID)).toEqual({ kind: "entity", entity: "CATEGORY", entityId: ID });
    expect(translationHookFor("facet.value_update", "FacetValue", ID)).toEqual({ kind: "entity", entity: "FACET_VALUE", entityId: ID });
    expect(translationHookFor("content.menu.update", "MenuItem", ID)).toEqual({ kind: "entity", entity: "MENU_ITEM", entityId: ID });
  });

  it("maps bulk changes to a tenant sync and ignores the rest", () => {
    expect(translationHookFor("import.done", "Import", "x")).toEqual({ kind: "tenant" });
    expect(translationHookFor("product.status", "Product", ID)).toBeNull();
    expect(translationHookFor("product.update", "Product", "bulk")).toBeNull();
    expect(translationHookFor("translation.approve", "Translation", ID)).toBeNull();
    expect(translationHookFor("facet.update", "FacetValue", ID)).toBeNull();
  });
});

describe("onAudited", () => {
  beforeEach(() => {
    enqueue.mockClear();
    locales = ["nl"];
  });

  it("enqueues a debounced sync per entity", async () => {
    await onAudited({ action: "product.update", tenantId: "t1", entity: "Product", entityId: ID });
    expect(enqueue).toHaveBeenCalledWith("translations.sync", { tenantId: "t1", entity: "PRODUCT", entityIds: [ID] }, { singletonKey: `PRODUCT:${ID}`, startAfter: 5 });
  });

  it("does nothing for shops without extra languages", async () => {
    locales = [];
    await onAudited({ action: "product.update", tenantId: "t1", entity: "Product", entityId: ID });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never throws (a translation problem must not break a save)", async () => {
    enqueue.mockRejectedValueOnce(new Error("boss down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(onAudited({ action: "category.update", tenantId: "t1", entity: "Category", entityId: ID })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
