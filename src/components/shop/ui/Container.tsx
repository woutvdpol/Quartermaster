import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "./cn";

type Props<T extends ElementType> = {
  as?: T;
  /** "default" 1360px, "narrow" 760px (text pages), "wide" 1520px. */
  size?: "default" | "narrow" | "wide";
} & Omit<ComponentPropsWithoutRef<T>, "as">;

const SIZES = { default: "max-w-[1360px]", narrow: "max-w-[760px]", wide: "max-w-[1520px]" } as const;

/** Centered page column with responsive side padding. */
export function Container<T extends ElementType = "div">({ as, size = "default", className, ...rest }: Props<T>) {
  const Tag = (as ?? "div") as ElementType;
  return <Tag className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", SIZES[size], className)} {...rest} />;
}
