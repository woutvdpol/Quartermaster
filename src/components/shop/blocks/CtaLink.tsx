import { ButtonLink, type ButtonVariant } from "@/components/shop/ui/Button";
import { isExternalUrl } from "@/server/content/url";
import type { BlockLink } from "@/server/content/blocks";

/** A block's `{ label, href }` (already sanitised by the block schema) as a button. */
export function CtaLink({ link, variant = "primary", size = "md", className }: { link: BlockLink | null; variant?: ButtonVariant; size?: "sm" | "md" | "lg"; className?: string }) {
  if (!link) return null;
  return (
    <ButtonLink href={link.href} external={isExternalUrl(link.href) || /^mailto:/i.test(link.href)} variant={variant} size={size} className={className}>
      {link.label}
    </ButtonLink>
  );
}
