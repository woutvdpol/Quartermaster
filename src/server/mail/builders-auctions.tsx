import "server-only";
import type { z } from "zod";
import { loadAuctionLotMailData } from "@/server/auctions/mail-data";
import AuctionOutbid, { auctionOutbidSubject } from "@/emails/auctions/AuctionOutbid";
import AuctionWon, { auctionPaymentReminderSubject, auctionWonSubject } from "@/emails/auctions/AuctionWon";
import type { MAIL_TEMPLATE_PROPS } from "./contracts";
import type { BuiltMail } from "./builders";
import type { MailIdentity } from "./identity";

/*
 * Builders for the auction mails (docs/auctions.md). Spread into MAIL_BUILDERS in ./builders.tsx.
 * Each re-checks the lot when the mail is sent and skips (null) when it no longer applies: the
 * customer leads again / the lot closed (outbid), the order was paid or cancelled (won, reminder).
 */

type AuctionTemplate = "auction-outbid" | "auction-won" | "auction-payment-reminder";
type Input<T extends AuctionTemplate> = {
  tenantId: string | null;
  to?: string;
  props: z.output<(typeof MAIL_TEMPLATE_PROPS)[T]>;
  identity: MailIdentity;
};

function requireTenant(tenantId: string | null, template: string): string {
  if (!tenantId) throw new Error(`${template}: tenantId is required`);
  return tenantId;
}

const SETTLED = ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"];

export const AUCTION_MAIL_BUILDERS = {
  "auction-outbid": async ({ tenantId, props, identity }: Input<"auction-outbid">): Promise<BuiltMail | null> => {
    const loaded = await loadAuctionLotMailData(requireTenant(tenantId, "auction-outbid"), props.lotId, props.customerId, identity.brand.baseUrl);
    if (!loaded) return null;
    const { lot, data } = loaded;
    if (lot.status !== "OPEN" || lot.closesAt.getTime() <= Date.now() || lot.leadingBidderId === props.customerId) return null;
    return { to: data.email, subject: auctionOutbidSubject(identity.brand, data), react: <AuctionOutbid brand={identity.brand} lot={data} closesAt={lot.closesAt} /> };
  },

  "auction-won": async ({ tenantId, props, identity }: Input<"auction-won">): Promise<BuiltMail | null> => {
    const loaded = await loadAuctionLotMailData(requireTenant(tenantId, "auction-won"), props.lotId, null, identity.brand.baseUrl);
    if (!loaded || !loaded.payUrl) return null;
    const { lot, data, payUrl } = loaded;
    if (lot.status !== "SOLD" || !lot.order || lot.order.canceledAt) return null;
    return { to: data.email, subject: auctionWonSubject(identity.brand, data), react: <AuctionWon brand={identity.brand} lot={data} payUrl={payUrl} /> };
  },

  "auction-payment-reminder": async ({ tenantId, props, identity }: Input<"auction-payment-reminder">): Promise<BuiltMail | null> => {
    const loaded = await loadAuctionLotMailData(requireTenant(tenantId, "auction-payment-reminder"), props.lotId, null, identity.brand.baseUrl);
    if (!loaded || !loaded.payUrl) return null;
    const { lot, data, payUrl } = loaded;
    if (lot.status !== "SOLD" || !lot.order || lot.order.canceledAt || lot.order.finalizedAt || SETTLED.includes(lot.order.paymentStatus)) return null;
    return { to: data.email, subject: auctionPaymentReminderSubject(identity.brand, data), react: <AuctionWon brand={identity.brand} lot={data} payUrl={payUrl} reminder /> };
  },
};
