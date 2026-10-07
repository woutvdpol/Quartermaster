import "server-only";
import type { z } from "zod";
import { decrypt } from "@/server/auth/encryption";
import { hashToken } from "@/server/auth/tokens";
import { loadOfferMailData } from "@/server/offers/mail-data";
import { OFFER_PATHS } from "@/server/offers/paths";
import { OFFER_CHECKOUT_TTL_HOURS, OFFER_COUNTER_TTL_HOURS, OFFER_PENDING_TTL_HOURS, percentOfPrice } from "@/server/offers/rules";
import { loadAbandonedCartMail } from "@/server/cart/abandoned";
import OfferReceived, { offerReceivedSubject } from "@/emails/commerce/OfferReceived";
import OfferSubmitted, { offerSubmittedSubject } from "@/emails/commerce/OfferSubmitted";
import OfferAccepted, { offerAcceptedSubject } from "@/emails/commerce/OfferAccepted";
import OfferCountered, { offerCounteredSubject } from "@/emails/commerce/OfferCountered";
import OfferRejected, { offerRejectedSubject } from "@/emails/commerce/OfferRejected";
import AbandonedCart, { abandonedCartSubject } from "@/emails/commerce/AbandonedCart";
import type { MAIL_TEMPLATE_PROPS } from "./contracts";
import type { BuiltMail } from "./builders";
import type { MailIdentity } from "./identity";

/*
 * Builders for the commerce mails (offers, abandoned cart). Spread into MAIL_BUILDERS in ./builders.tsx.
 * Each builder re-checks the current state and returns null (skip) when the mail is no longer
 * relevant — e.g. a newer link superseded the token, the offer changed status, the cart was ordered.
 */

type CommerceTemplate = "offer-received" | "offer-submitted" | "offer-accepted" | "offer-countered" | "offer-rejected" | "abandoned-cart";
type Input<T extends CommerceTemplate> = {
  tenantId: string | null;
  to?: string;
  props: z.output<(typeof MAIL_TEMPLATE_PROPS)[T]>;
  identity: MailIdentity;
};

function requireTenant(tenantId: string | null, template: string): string {
  if (!tenantId) throw new Error(`${template}: tenantId is required`);
  return tenantId;
}

export const COMMERCE_MAIL_BUILDERS = {
  "offer-received": async ({ tenantId, props, identity }: Input<"offer-received">): Promise<BuiltMail | null> => {
    if (!identity.ownerEmail) {
      console.warn(`[mail] tenant ${tenantId} has no order notification / contact email; offer mail skipped`);
      return null;
    }
    const loaded = await loadOfferMailData(requireTenant(tenantId, "offer-received"), props.offerId, identity.brand.baseUrl);
    if (!loaded) return null;
    const { data } = loaded;
    return {
      to: identity.ownerEmail,
      subject: offerReceivedSubject(data),
      replyTo: data.email,
      react: (
        <OfferReceived
          brand={identity.brand}
          offer={data}
          adminUrl={`${identity.brand.baseUrl}${OFFER_PATHS.admin(props.offerId)}`}
          percent={percentOfPrice(data.amount, data.listPrice)}
        />
      ),
    };
  },

  "offer-submitted": async ({ tenantId, props, identity }: Input<"offer-submitted">): Promise<BuiltMail | null> => {
    const loaded = await loadOfferMailData(requireTenant(tenantId, "offer-submitted"), props.offerId, identity.brand.baseUrl);
    if (!loaded) return null;
    return {
      to: loaded.data.email,
      subject: offerSubmittedSubject(identity.brand, loaded.data),
      react: <OfferSubmitted brand={identity.brand} offer={loaded.data} respondWithinHours={OFFER_PENDING_TTL_HOURS} />,
    };
  },

  "offer-accepted": async ({ tenantId, props, identity }: Input<"offer-accepted">): Promise<BuiltMail | null> => {
    const loaded = await loadOfferMailData(requireTenant(tenantId, "offer-accepted"), props.offerId, identity.brand.baseUrl);
    if (!loaded) return null;
    const token = decrypt(props.tokenEnc);
    const { offer, data } = loaded;
    if (offer.status !== "ACCEPTED" || offer.checkoutTokenHash !== hashToken(token)) return null;
    return {
      to: data.email,
      subject: offerAcceptedSubject(identity.brand, data),
      react: (
        <OfferAccepted
          brand={identity.brand}
          offer={data}
          checkoutUrl={`${identity.brand.baseUrl}${OFFER_PATHS.checkout(token)}`}
          expiresInHours={OFFER_CHECKOUT_TTL_HOURS}
        />
      ),
    };
  },

  "offer-countered": async ({ tenantId, props, identity }: Input<"offer-countered">): Promise<BuiltMail | null> => {
    const loaded = await loadOfferMailData(requireTenant(tenantId, "offer-countered"), props.offerId, identity.brand.baseUrl);
    if (!loaded) return null;
    const token = decrypt(props.tokenEnc);
    const { offer, data } = loaded;
    if (offer.status !== "COUNTERED" || offer.checkoutTokenHash !== hashToken(token)) return null;
    return {
      to: data.email,
      subject: offerCounteredSubject(identity.brand, data),
      react: (
        <OfferCountered
          brand={identity.brand}
          offer={data}
          respondUrl={`${identity.brand.baseUrl}${OFFER_PATHS.counter(token)}`}
          expiresInHours={OFFER_COUNTER_TTL_HOURS}
        />
      ),
    };
  },

  "offer-rejected": async ({ tenantId, props, identity }: Input<"offer-rejected">): Promise<BuiltMail | null> => {
    const loaded = await loadOfferMailData(requireTenant(tenantId, "offer-rejected"), props.offerId, identity.brand.baseUrl);
    if (!loaded || loaded.offer.status !== "REJECTED") return null;
    return {
      to: loaded.data.email,
      subject: offerRejectedSubject(identity.brand, loaded.data),
      react: <OfferRejected brand={identity.brand} offer={loaded.data} />,
    };
  },

  "abandoned-cart": async ({ tenantId, props, identity }: Input<"abandoned-cart">): Promise<BuiltMail | null> => {
    const mail = await loadAbandonedCartMail(requireTenant(tenantId, "abandoned-cart"), props.cartId, identity.brand.baseUrl);
    if (!mail) return null;
    return {
      to: mail.to,
      subject: abandonedCartSubject(identity.brand),
      react: <AbandonedCart brand={identity.brand} lines={mail.lines} currency={mail.currency} restoreUrl={mail.restoreUrl} />,
    };
  },
};
