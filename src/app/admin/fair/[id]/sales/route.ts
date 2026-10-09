import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AuthError } from "@/server/auth/guards";
import { requireStaffContext, ServiceError } from "@/server/context";
import { isSameOrigin } from "@/server/request-meta";
import { getFairSellData, recordFairSale } from "@/server/fairs";

/*
 * Fair-mode sync endpoint (docs/fair-mode.md).
 *   GET   current sell data (items, floors, sold flags) — the client caches it for offline lookups.
 *   POST  one sale { productId, price, method, buyerEmail?, allowBelowFloor?, clientRef, soldAt? }.
 *         Idempotent on clientRef: a retried sale answers 200 with the order it already created.
 * A Route Handler (not a Server Action) so the offline queue gets plain status codes it can classify
 * (src/server/fairs/queue.ts → syncOutcome). Staff session + tenant, same-origin check for POST.
 */

type Params = { params: Promise<{ id: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const STATUS: Record<ServiceError["code"], number> = { NOT_FOUND: 404, CONFLICT: 409, INVALID: 422, FORBIDDEN: 403, UNAVAILABLE: 503 };

function failure(err: unknown) {
  if (err instanceof AuthError) return json({ ok: false, code: err.code, message: "Sign in again to sync." }, err.code === "UNAUTHENTICATED" ? 401 : 403);
  if (err instanceof ServiceError) return json({ ok: false, code: err.code, message: err.message }, STATUS[err.code]);
  if (err instanceof ZodError) return json({ ok: false, code: "INVALID", message: "Invalid request" }, 422);
  console.error("[fair] sync failed:", err);
  return json({ ok: false, code: "ERROR", message: "Something went wrong. The sale stays queued." }, 500);
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const ctx = await requireStaffContext();
    return json({ ok: true, data: await getFairSellData(ctx, id) });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!isSameOrigin(request)) return json({ ok: false, code: "FORBIDDEN", message: "Forbidden" }, 403);
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return json({ ok: false, code: "INVALID", message: "Invalid request" }, 422);
  }
  try {
    const ctx = await requireStaffContext();
    const sale = await recordFairSale(ctx, {
      fairId: id,
      productId: String(body.productId ?? ""),
      price: Number(body.price),
      method: body.method as "card",
      buyerEmail: typeof body.buyerEmail === "string" ? body.buyerEmail : null,
      allowBelowFloor: body.allowBelowFloor === true,
      clientRef: String(body.clientRef ?? ""),
      soldAt: typeof body.soldAt === "string" ? body.soldAt : null,
    });
    if (!sale.reused) {
      revalidatePath(`/admin/fairs/${id}`);
      revalidatePath("/admin/orders");
    }
    return json({ ok: true, ...sale });
  } catch (err) {
    return failure(err);
  }
}
