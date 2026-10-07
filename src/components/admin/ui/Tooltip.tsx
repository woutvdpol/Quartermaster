import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cx } from "./cx";

type TooltipProps = {
  /** Short supplementary text. Never put essential information or interactive content in a tooltip. */
  content: ReactNode;
  /** One focusable element (button, link). It gets aria-describedby pointing at the tooltip. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
  className?: string;
};

/** CSS-only tooltip: shows on hover and keyboard focus. Server-component friendly. */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const id = `tip${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
      })
    : children;
  return (
    <span className={cx("group/tip relative inline-flex", className)}>
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cx(
          "pointer-events-none invisible absolute left-1/2 z-40 w-max max-w-[240px] -translate-x-1/2 rounded-control bg-rail px-2 py-1 text-xs text-rail-ink opacity-0 shadow-pop transition-opacity",
          "group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}
