import { ButtonLink } from "@/components/shop/ui";
import { loginHref } from "@/server/customer-auth/redirect";
import { catalogCopy as copy } from "../_copy";

/** Shown instead of the product details to guests for sensitive (blurred) items. */
export function LockedPanel({ returnTo }: { returnTo: string }) {
  return (
    <div className="rounded-shop border border-shop-line bg-shop-surface p-6 shadow-shop">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-shop-sunken text-shop-ink" aria-hidden="true">
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="4" y="9" width="12" height="8" rx="1.5" />
          <path d="M7 9V6.5a3 3 0 016 0V9" />
        </svg>
      </div>
      <h2 className="text-xl text-shop-ink">{copy.product.lockedTitle}</h2>
      <p className="mt-1 text-shop-muted">{copy.product.lockedBody}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href={loginHref(returnTo)} rel="nofollow">
          {copy.product.lockedCta}
        </ButtonLink>
        <ButtonLink href={`/register?next=${encodeURIComponent(returnTo)}`} variant="outline" rel="nofollow">
          {copy.product.lockedRegister}
        </ButtonLink>
      </div>
    </div>
  );
}
