import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Section title with optional eyebrow, intro text and a right-aligned "view all" style link.
 * `as` picks the heading level (h2 by default; the page title owns h1).
 */
export function SectionHeading({
  title,
  eyebrow,
  intro,
  action,
  as: Tag = "h2",
  align = "left",
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  intro?: ReactNode;
  action?: { label: string; href: string } | null;
  as?: "h1" | "h2" | "h3";
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 sm:mb-8", align === "center" && "flex-col items-center text-center", className)}>
      <div className={cn("min-w-0", align === "center" && "mx-auto max-w-2xl")}>
        {eyebrow ? <p className="mb-2 text-sm font-semibold text-shop-primary">{eyebrow}</p> : null}
        <Tag className={cn("text-shop-ink", Tag === "h1" ? "text-3xl sm:text-[2.6rem]" : "text-2xl sm:text-[2rem]")}>{title}</Tag>
        {intro ? <div className="mt-2 text-shop-muted">{intro}</div> : null}
      </div>
      {action ? (
        <Link href={action.href} className="shrink-0 text-[0.95rem] font-semibold text-shop-ink underline-offset-4 hover:underline">
          {action.label} <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}
