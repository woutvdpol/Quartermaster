import type { ReactNode } from "react";

type CardProps = {
  title?: ReactNode;
  /** Small text or link on the right of the header. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Padding for the body; set false for flush content such as tables. */
  padded?: boolean;
  as?: "section" | "div" | "article";
};

export function Card({ title, aside, children, className = "", padded = true, as: Tag = "section" }: CardProps) {
  return (
    <Tag className={`rounded-card border border-line bg-panel shadow-card ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
          {title && <h2 className="type-label text-sm text-ink">{title}</h2>}
          {aside && <div className="text-xs text-muted">{aside}</div>}
        </header>
      )}
      <div className={padded ? "p-3.5" : undefined}>{children}</div>
    </Tag>
  );
}
