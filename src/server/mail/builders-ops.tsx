import "server-only";
import type { z } from "zod";
import { db } from "@/server/db";
import { decrypt } from "@/server/auth/encryption";
import { hashToken } from "@/server/auth/tokens";
import { OWNER_INVITE_TTL_MS } from "@/server/users";
import { EMAIL_VERIFICATION_TTL_HOURS, VERIFY_EMAIL_PATH } from "@/server/email-verification/config";
import OrderShipped, { orderShippedSubject } from "@/emails/OrderShipped";
import OwnerInvite, { ownerInviteSubject } from "@/emails/OwnerInvite";
import CustomerEmailVerification, { customerEmailVerificationSubject } from "@/emails/CustomerEmailVerification";
import type { MAIL_TEMPLATE_PROPS } from "./contracts";
import type { BuiltMail } from "./builders";
import type { MailIdentity } from "./identity";
import { loadOrderMailData } from "./order-data";
import { MAIL_PATHS, withQuery } from "./urls";

/*
 * Builders for the admin-ops mail templates (order shipped, owner invite, customer e-mail
 * verification). Spread into MAIL_BUILDERS in ./builders.tsx. Each builder re-checks the current
 * state and returns null (skip) when the mail is no longer relevant: order un-shipped, invite
 * accepted or superseded, address already verified.
 */

type OpsTemplate = "order-shipped" | "owner-invite" | "customer-email-verification";
type Input<T extends OpsTemplate> = {
  tenantId: string | null;
  to?: string;
  props: z.output<(typeof MAIL_TEMPLATE_PROPS)[T]>;
  identity: MailIdentity;
};

function requireTenant(tenantId: string | null, template: string): string {
  if (!tenantId) throw new Error(`${template}: tenantId is required`);
  return tenantId;
}

/** An unused, unexpired token of `type` for `userId`, or null (used, superseded, expired). */
async function liveToken(token: string, userId: string, type: "PASSWORD_RESET" | "EMAIL_VERIFICATION") {
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.userId !== userId || row.type !== type || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

export const OPS_MAIL_BUILDERS = {
  "order-shipped": async ({ tenantId, props, identity }: Input<"order-shipped">): Promise<BuiltMail | null> => {
    const tid = requireTenant(tenantId, "order-shipped");
    const [order, f] = await Promise.all([
      loadOrderMailData(tid, props.orderId, identity.brand.baseUrl),
      db.order.findFirst({
        where: { id: props.orderId, tenantId: tid },
        select: { fulfillmentStatus: true, carrier: true, trackingNumber: true, trackingUrl: true },
      }),
    ]);
    // Reset to unfulfilled/packed before the job ran → nothing to announce.
    if (!order || !f || (f.fulfillmentStatus !== "SHIPPED" && f.fulfillmentStatus !== "DELIVERED")) return null;
    const data = {
      number: order.number,
      customerName: order.customerName,
      carrier: f.carrier,
      trackingNumber: f.trackingNumber,
      trackingUrl: f.trackingUrl,
      shippingMethod: order.shippingMethod,
      shippingAddress: order.shippingAddress,
      lines: order.lines.map((l) => ({ title: l.title, stockCode: l.stockCode, quantity: l.quantity })),
      statusUrl: order.statusUrl,
    };
    return { to: order.email, subject: orderShippedSubject(identity.brand, data), react: <OrderShipped brand={identity.brand} order={data} /> };
  },

  "owner-invite": async ({ tenantId, props, identity }: Input<"owner-invite">): Promise<BuiltMail | null> => {
    const tid = requireTenant(tenantId, "owner-invite");
    const user = await db.user.findFirst({
      where: { id: props.userId, tenantId: tid, role: "OWNER" },
      select: { email: true, name: true, passwordHash: true, disabledAt: true },
    });
    // Accepted already, disabled or gone → skip.
    if (!user || user.passwordHash !== null || user.disabledAt) return null;
    const token = decrypt(props.tokenEnc);
    if (!(await liveToken(token, props.userId, "PASSWORD_RESET"))) return null; // superseded by a newer invite/reset
    const inviteUrl = withQuery(identity.brand.baseUrl, MAIL_PATHS.adminPasswordReset, { token });
    return {
      to: user.email,
      subject: ownerInviteSubject(identity.brand),
      react: (
        <OwnerInvite
          brand={identity.brand}
          inviteUrl={inviteUrl}
          name={user.name}
          invitedBy={props.invitedBy ?? null}
          expiresInDays={Math.round(OWNER_INVITE_TTL_MS / 86_400_000)}
        />
      ),
    };
  },

  "customer-email-verification": async ({ tenantId, props, identity }: Input<"customer-email-verification">): Promise<BuiltMail | null> => {
    const tid = requireTenant(tenantId, "customer-email-verification");
    const user = await db.user.findFirst({
      where: { id: props.userId, tenantId: tid, role: "CUSTOMER" },
      select: { email: true, emailVerifiedAt: true, disabledAt: true },
    });
    if (!user || user.emailVerifiedAt || user.disabledAt) return null;
    const token = decrypt(props.tokenEnc);
    if (!(await liveToken(token, props.userId, "EMAIL_VERIFICATION"))) return null;
    const verifyUrl = withQuery(identity.brand.baseUrl, VERIFY_EMAIL_PATH, { token });
    return {
      to: user.email,
      subject: customerEmailVerificationSubject(identity.brand),
      react: <CustomerEmailVerification brand={identity.brand} verifyUrl={verifyUrl} expiresInHours={EMAIL_VERIFICATION_TTL_HOURS} />,
    };
  },
};
