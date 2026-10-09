import Link from "next/link";
import { cx } from "@/components/admin/ui";

/** Sub-navigation: review list / glossary. */
export function TranslationsTabs({ active }: { active: "review" | "glossary" }) {
  const item = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx("border-b-2 px-3 py-2 text-[13px]", on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Translations" className="flex gap-1 border-b border-line bg-panel px-4 md:px-[22px]">
      {item("/admin/translations", "Review list", active === "review")}
      {item("/admin/translations/glossary", "Glossary", active === "glossary")}
    </nav>
  );
}
