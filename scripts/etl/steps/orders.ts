import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../src/generated/prisma/client";
import type { FulfillmentStatus, PaymentStatus } from "../../../src/generated/prisma/enums";
import { ETL_MARK, isEtlOwned, json, sameValues, type EtlContext } from "../context";
import type { LegacyOrder } from "../legacy/types";
import { UNKNOWN_COUNTRY, isUuid, normalizeEmail, splitName, splitStreet, toCountryCode } from "../transforms/people";
import { reconstructLinePrices } from "../transforms/prices";
import { PICKUP_NAME } from "./shipping";

const DAY = 86_400_000;

/** Legacy payment_status → PaymentStatus. See docs/etl/README.md "Betaalstatus". */
export function mapPaymentStatus(o: Pick<LegacyOrder, "payment_status" | "order_paid_on">): { status: PaymentStatus; inferred: boolean } {
  const s = (o.payment_status ?? "").trim().toLowerCase();
  if (s === "paid") return { status: "PAID", inferred: false };
  // `manual` = bank transfer / cash awaiting payment. Owner decision (docs/02-besluiten.md): ALWAYS
  // PENDING (not revenue), also when order_paid_on is set — paid revenue matches legacy `paid` exactly.
  if (s === "manual") return { status: "PENDING", inferred: false };
  if (s === "pending" || s === "open") return { status: "PENDING", inferred: false };
  if (s === "canceled" || s === "cancelled") return { status: "CANCELED", inferred: false };
  if (s === "expired") return { status: "EXPIRED", inferred: false };
  return { status: "FAILED", inferred: s !== "failed" };
}

/** docs/etl/invoices-and-fulfillment.md: paid and (archived or paid > 14 days ago) → DELIVERED. */
export function inferFulfillment(paid: boolean, archived: boolean, paidAt: Date | null, now: Date): FulfillmentStatus {
  if (!paid) return "UNFULFILLED";
  if (archived) return "DELIVERED";
  if (paidAt && now.getTime() - paidAt.getTime() > 14 * DAY) return "DELIVERED";
  return "UNFULFILLED";
}

const METHOD: Record<string, string> = { BANK_TRANSFER: "banktransfer", BTRANS: "banktransfer", CASH: "cash", MOLLIE: "mollie", PAYPAL: "paypal" };

/**
 * Legacy `orders` + `order_details` → Order, OrderLine, OrderAddress (SHIPPING + BILLING copy),
 * Payment and OrderEvent. Upsert on (tenantId, number = orders.id). Child rows of ETL-owned orders
 * are rebuilt on every run (lines, addresses, payments, ETL events); orders are never deleted.
 * Customers: one Customer per lower-case e-mail (legacy "virtual customer"), linked to the user's
 * customer when orders.customer_id points at a migrated user.
 */
export async function ordersStep(ctx: EtlContext) {
  const { tx, report, tenantId } = ctx;
  const orders = await ctx.legacy.read("orders");
  const details = await ctx.legacy.read("order_details");
  const methods = await ctx.legacy.read("payment_methods");
  const legacyUsers = await ctx.legacy.read("users");
  report.legacy("orders", orders.length);
  report.legacy("order lines", details.length);

  const surchargeByMethod = new Map(methods.map((m) => [m.name.replace(/\s+/g, "_").toUpperCase(), Number(m.surcharge ?? 0) || 0]));
  const linesByOrder = new Map<number, typeof details>();
  for (const d of details) linesByOrder.set(d.order_id, [...(linesByOrder.get(d.order_id) ?? []), d]);
  const orderIds = new Set(orders.map((o) => o.id));
  const orphanLines = details.filter((d) => !orderIds.has(d.order_id)).length;
  if (orphanLines) report.skip("order lines", "order bestaat niet", orphanLines);

  const productRows = await tx.product.findMany({
    where: { tenantId, stockCode: { in: [...new Set(details.map((d) => d.product_id))] } },
    select: {
      id: true,
      stockCode: true,
      title: true,
      sku: true,
      price: true,
      purchasePrice: true,
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { storageKey: true, processedAt: true } },
    },
  });
  const products = new Map(productRows.map((p) => [p.stockCode, p]));
  const legacyProducts = new Map((await ctx.legacy.read("products")).map((p) => [p.id, p]));

  const userEmailByLegacyId = new Map(legacyUsers.map((u) => [u.id, normalizeEmail(u.email)]));
  const customerRows = await tx.customer.findMany({ where: { tenantId }, select: { id: true, email: true, user: { select: { emailVerifiedAt: true } } } });
  const customers = new Map(customerRows.map((c) => [c.email, c.id]));
  // Customers that belong to an account whose email was never verified. Guest orders with that email
  // are NOT linked to them (anyone could have registered that address — security review R1); they
  // stay customerId = null and are claimed by the account once it verifies (claimVerifiedEmail).
  const unverifiedAccountEmails = new Set(customerRows.filter((c) => c.user && !c.user.emailVerifiedAt).map((c) => c.email));
  const zones = new Map((await tx.shippingZone.findMany({ where: { tenantId }, select: { name: true, isPickup: true } })).map((z) => [z.name.toLowerCase(), z]));
  const existingOrders = new Map(
    (await tx.order.findMany({ where: { tenantId, number: { in: [...orderIds] } } })).map((o) => [o.number, o]),
  );

  const stats = { reconstructed: 0, byMethod: new Map<string, number>(), noLines: 0, unknownCountry: [] as number[] };

  for (const o of orders) {
    if (!Number.isInteger(o.id) || o.id <= 0) {
      report.skip("orders", "ongeldige id");
      continue;
    }
    const existing = existingOrders.get(o.id);
    if (existing && !isEtlOwned(existing)) {
      report.skip("orders", "ordernummer bestaat al (niet-ETL order)");
      report.warn(`order legacy #${o.id}: number already used by a non-ETL order → skipped`);
      continue;
    }

    const email = normalizeEmail(o.email);
    const lines = linesByOrder.get(o.id) ?? [];
    const currency = /^[A-Za-z]{3}$/.test((o.currency ?? "").trim()) ? o.currency.trim().toUpperCase() : ctx.currency;
    const total = Math.max(0, o.total ?? 0);
    let delivery = Math.max(0, o.delivery ?? 0);
    const legacyData: Record<string, unknown> = {
      etl: ETL_MARK,
      paymentStatus: o.payment_status,
      paymentMethod: o.payment_method,
      region: o.region,
      country: o.country,
    };
    if (o.uuid && !isUuid(o.uuid)) legacyData.legacyUuid = o.uuid;

    // ── Amounts ──
    let subtotal: number;
    let surcharge = 0;
    let lineData: Prisma.OrderLineCreateManyInput[] = [];
    if (lines.length === 0) {
      stats.noLines++;
      legacyData.legacyNoLines = true;
      if (total < delivery) {
        legacyData.deliveryExceedsTotal = delivery;
        delivery = total;
      }
      subtotal = total - delivery;
    } else {
      const method = (o.payment_method ?? "").trim().toUpperCase();
      const rec = reconstructLinePrices({
        total,
        delivery,
        surchargePercent: surchargeByMethod.get(method) ?? 0,
        lines: lines.map((l) => ({ quantity: l.quantity, roundedEuros: l.price, productPrice: products.get(l.product_id)?.price ?? null })),
      });
      if (rec.warning) report.warn(`order #${o.id}: ${rec.warning}`);
      stats.reconstructed++;
      stats.byMethod.set(rec.method, (stats.byMethod.get(rec.method) ?? 0) + 1);
      legacyData.priceReconstruction = { method: rec.method, roundingDelta: rec.roundingDelta, legacyLinePrices: lines.map((l) => l.price) };
      report.note("Orders met gereconstrueerde regelprijzen", `#${o.id}: ${rec.method}, ${lines.length} regel(s), afrondingsverschil ${rec.roundingDelta} ct`);
      if (rec.method === "proportional" && total - delivery < 0) legacyData.deliveryExceedsTotal = delivery;
      subtotal = rec.subtotal;
      surcharge = rec.surcharge;
      if (subtotal + delivery + surcharge !== total) {
        // goods < 0 case: keep the stored total consistent.
        delivery = Math.max(0, total - subtotal - surcharge);
      }
      lineData = lines.map((l, i) => {
        const p = products.get(l.product_id);
        const lp = legacyProducts.get(l.product_id);
        if (!p) report.note("Orderregels zonder product", `order #${o.id}, product #${l.product_id}`);
        const image = p?.images[0];
        return {
          tenantId,
          orderId: "", // set below
          productId: p?.id ?? null,
          title: p?.title ?? lp?.title?.trim() ?? `Item ${l.product_id}`,
          stockCode: l.product_id,
          sku: p?.sku ?? null,
          imagePath: image?.processedAt ? image.storageKey : null,
          unitPrice: rec.lines[i].unitPrice,
          quantity: rec.lines[i].quantity,
          lineTotal: rec.lines[i].lineTotal,
          purchasePriceSnapshot: p?.purchasePrice ?? null,
          priceReconstructed: true,
          sortOrder: i,
        };
      });
    }

    // ── Status ──
    const pay = mapPaymentStatus(o);
    const paid = pay.status === "PAID";
    const archivedRaw = !!o.archive;
    const archivedAt = archivedRaw || lines.length === 0 ? (o.updated_at ?? o.created_at ?? ctx.now) : null;
    const paidAt = paid ? (o.order_paid_on ?? o.updated_at ?? o.created_at) : null;
    const fulfillmentStatus = inferFulfillment(paid, archivedRaw, paidAt, ctx.now);
    if (fulfillmentStatus === "DELIVERED") legacyData.fulfillmentInferred = true;
    const placedAt = o.created_at ?? ctx.now;
    const finalizedAt = paid || o.is_order_placed_event_fired ? placedAt : null;

    // ── Customer ──
    let customerId: string | null = null;
    const userEmail = o.customer_id !== null ? userEmailByLegacyId.get(o.customer_id) : undefined;
    if (userEmail && customers.has(userEmail)) customerId = customers.get(userEmail)!;
    else if (email && unverifiedAccountEmails.has(email)) {
      customerId = null;
      report.note("Gastorder niet gekoppeld", `#${o.id}: account met dit e-mailadres is niet geverifieerd`);
    } else if (email) {
      customerId = customers.get(email) ?? null;
      if (!customerId) {
        const { firstName, lastName } = splitName(o.name);
        const row = await tx.customer.create({
          data: { tenantId, email, firstName: firstName || null, lastName: lastName || null, phone: o.phone?.trim() || null, createdAt: placedAt },
        });
        customerId = row.id;
        customers.set(email, row.id);
        report.created("customers (uit orders)");
      }
    }

    const region = (o.region ?? "").trim();
    const zone = region ? zones.get(region.toLowerCase()) : undefined;
    const isPickup = zone?.isPickup ?? PICKUP_NAME.test(region);

    const orderData = {
      customerId,
      email: email || `unknown-${o.id}@invalid`,
      customerName: o.name?.trim() || "",
      phone: o.phone?.trim() || null,
      currency,
      subtotal,
      shippingTotal: delivery,
      surchargeTotal: surcharge,
      discountTotal: 0,
      total,
      paymentStatus: pay.status,
      fulfillmentStatus,
      paymentMethod: o.payment_method?.trim() || null,
      shippingMethod: isPickup ? ("PICKUP" as const) : ("SHIP" as const),
      shippingZoneId: null,
      shippingZoneName: region || null,
      placedAt,
      paidAt,
      finalizedAt,
      confirmationSentAt: o.email_sent_on,
      archivedAt,
      notes: o.notes?.trim() || null,
      legacyData: json(legacyData),
      createdAt: placedAt,
    };

    let orderId: string;
    // Child rows are rebuilt on every run; counts go to "unchanged" when the order itself did not change.
    let count: (entity: string, n?: number) => void = (entity, n = 1) => report.created(entity, n);
    if (existing) {
      orderId = existing.id;
      if (sameValues(existing, orderData)) {
        report.unchanged("orders");
        count = (entity, n = 1) => report.unchanged(entity, n);
      } else {
        await tx.order.update({ where: { id: orderId }, data: orderData });
        report.updated("orders");
      }
      await tx.orderLine.deleteMany({ where: { orderId } });
      await tx.orderAddress.deleteMany({ where: { orderId } });
      await tx.payment.deleteMany({ where: { orderId } });
      await tx.orderEvent.deleteMany({ where: { orderId, data: { path: ["etl"], equals: ETL_MARK } } });
    } else {
      const row = await tx.order.create({
        data: { tenantId, number: o.id, ...(isUuid(o.uuid) ? { uuid: o.uuid.trim().toLowerCase() } : { uuid: randomUUID() }), ...orderData },
      });
      orderId = row.id;
      report.created("orders");
    }

    if (lineData.length) {
      await tx.orderLine.createMany({ data: lineData.map((l) => ({ ...l, orderId })) });
      count("order lines", lineData.length);
    }

    // ── Addresses ──
    const { firstName, lastName } = splitName(o.name);
    const street = splitStreet(o.address);
    const cc = toCountryCode(o.country);
    if (!cc && !isPickup) stats.unknownCountry.push(o.id);
    const address = {
      tenantId,
      orderId,
      firstName,
      lastName,
      street: street.street,
      houseNumber: street.houseNumber,
      line2: street.line2,
      postalCode: o.zip?.trim() || null,
      city: o.city?.trim() ?? "",
      region: o.state?.trim() || null,
      countryCode: cc ?? UNKNOWN_COUNTRY,
      phone: o.phone?.trim() || null,
    };
    if (street.street || address.city || address.postalCode) {
      await tx.orderAddress.createMany({ data: [{ ...address, type: "SHIPPING" }, { ...address, type: "BILLING" }] });
      count("order addresses", 2);
    } else report.skip("order addresses", "geen adres in legacy");

    // ── Payment ──
    const providerId = o.payment_id?.trim() || null;
    const method = METHOD[(o.payment_method ?? "").trim().toUpperCase()] ?? null;
    if (providerId && /^tr_/.test(providerId)) {
      const taken = await tx.payment.findUnique({ where: { providerPaymentId: providerId } });
      if (taken) report.warn(`order #${o.id}: Mollie payment id already used by another order → recorded as MANUAL`);
      await tx.payment.create({
        data: {
          tenantId,
          orderId,
          provider: taken ? "MANUAL" : "MOLLIE",
          providerPaymentId: taken ? null : providerId,
          method,
          status: paid ? "PAID" : pay.status === "PENDING" ? "OPEN" : "FAILED",
          amount: total,
          currency,
          paidAt,
          failedAt: pay.status === "FAILED" ? (o.updated_at ?? placedAt) : null,
          raw: json({ etl: ETL_MARK, legacyPaymentId: providerId }),
          createdAt: placedAt,
        },
      });
      count("payments");
    } else if (paid) {
      await tx.payment.create({
        data: { tenantId, orderId, provider: "MANUAL", method, status: "PAID", amount: total, currency, paidAt, raw: json({ etl: ETL_MARK }), createdAt: paidAt ?? placedAt },
      });
      count("payments");
    }

    // ── Timeline ──
    const events: Prisma.OrderEventCreateManyInput[] = [
      { tenantId, orderId, type: "created", data: json({ etl: ETL_MARK, source: "Concept500" }), createdAt: placedAt },
    ];
    if (paid && paidAt) events.push({ tenantId, orderId, type: "payment.paid", data: json({ etl: ETL_MARK, provider: providerId ? "MOLLIE" : "MANUAL" }), createdAt: paidAt });
    if (pay.status === "FAILED") events.push({ tenantId, orderId, type: "payment.failed", data: json({ etl: ETL_MARK }), createdAt: o.updated_at ?? placedAt });
    if (o.email_sent_on) events.push({ tenantId, orderId, type: "email.sent", data: json({ etl: ETL_MARK, template: "order-confirmation" }), createdAt: o.email_sent_on });
    if (archivedAt) events.push({ tenantId, orderId, type: "archived", data: json({ etl: ETL_MARK, ...(lines.length === 0 ? { reason: "legacyNoLines" } : {}) }), createdAt: archivedAt });
    await tx.orderEvent.createMany({ data: events });
    count("order events", events.length);
  }

  for (const [method, n] of stats.byMethod) report.note("Prijsreconstructie per methode", `${method}: ${n} orders`);
  if (stats.noLines) report.note("Orders zonder regels (gearchiveerd, legacyNoLines)", `${stats.noLines} orders`);
  if (stats.unknownCountry.length) report.note("Orders met onbekend land (countryCode ZZ)", `#${stats.unknownCountry.join(", #")}`);

  // ── Revenue check (paid orders, refunds excluded — legacy had none) ──
  const legacyPaid = orders.filter((o) => (o.payment_status ?? "").toLowerCase() === "paid");
  const legacyManual = orders.filter((o) => (o.payment_status ?? "").toLowerCase() === "manual");
  const newPaid = await tx.order.aggregate({
    where: { tenantId, number: { in: [...orderIds] }, paymentStatus: "PAID", legacyData: { path: ["etl"], equals: ETL_MARK } },
    _sum: { total: true, subtotal: true },
    _count: { _all: true },
  });
  report.revenue = {
    legacyPaidOrders: legacyPaid.length,
    legacyPaidTotal: legacyPaid.reduce((a, o) => a + (o.total ?? 0), 0),
    legacyManualOrders: legacyManual.length,
    legacyManualTotal: legacyManual.reduce((a, o) => a + (o.total ?? 0), 0),
    newPaidOrders: newPaid._count._all,
    newPaidTotal: newPaid._sum.total ?? 0,
    newPaidSubtotal: newPaid._sum.subtotal ?? 0,
    currency: ctx.currency,
  };
}
