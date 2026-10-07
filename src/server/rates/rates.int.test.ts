import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import { setSettings } from "../../../tests/integration/mail-harness";
import { getDisplayRates, parseEcbDaily, refreshRates, storeEcbDaily } from "./index";

const fixture = readFileSync(new URL("./__fixtures__/eurofxref-daily.xml", import.meta.url), "utf8");

beforeEach(resetDb);

describe("exchange rates", () => {
  it("stores the ECB file idempotently and refreshes via an injected fetch", async () => {
    expect(await storeEcbDaily(parseEcbDaily(fixture))).toBe(30);
    await storeEcbDaily(parseEcbDaily(fixture));
    expect(await db.exchangeRate.count()).toBe(30);
    const fakeFetch = (async () => new Response(fixture.replace("2026-10-06", "2026-10-07"), { status: 200 })) as typeof fetch;
    expect(await refreshRates(fakeFetch)).toEqual({ date: "2026-10-07", stored: 30 });
    expect(await db.exchangeRate.count()).toBe(60);
    const failing = (async () => new Response("down", { status: 503 })) as typeof fetch;
    await expect(refreshRates(failing)).rejects.toThrow(/503/);
  });

  it("returns display rates for the configured currencies, via EUR for non-EUR shops", async () => {
    await storeEcbDaily(parseEcbDaily(fixture));
    const eurShop = await createTenantContext();
    await setSettings(eurShop.tenantId, "general", { displayCurrencies: ["USD", "GBP", "EUR"] });
    const r = await getDisplayRates(eurShop.tenantId);
    expect(r.shopCurrency).toBe("EUR");
    expect(r.rates).toEqual([
      { currency: "USD", rate: 1.1712 },
      { currency: "GBP", rate: 0.86915 },
    ]);
    expect(r.rateDate?.toISOString().slice(0, 10)).toBe("2026-10-06");

    const gbpShop = await createTenantContext();
    await db.tenant.update({ where: { id: gbpShop.tenantId }, data: { currency: "GBP" } });
    await setSettings(gbpShop.tenantId, "general", { displayCurrencies: ["EUR", "USD"] });
    const g = await getDisplayRates(gbpShop.tenantId);
    expect(g.rates[0].currency).toBe("EUR");
    expect(g.rates[0].rate).toBeCloseTo(1 / 0.86915, 8);
    expect(g.rates[1].rate).toBeCloseTo(1.1712 / 0.86915, 8);

    const none = await createTenantContext();
    expect((await getDisplayRates(none.tenantId)).rates).toEqual([]);
  });
});
