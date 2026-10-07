import { EmptyState } from "@/components/admin/ui";
import { copy } from "../_copy";

/** Shown instead of the newsletter screens while `platform.newsletterEnabled` is off. */
export function NewsletterDisabled() {
  return (
    <div className="rounded-card border border-line bg-panel shadow-card">
      <EmptyState title={copy.disabled.title} body={copy.disabled.body} />
    </div>
  );
}
