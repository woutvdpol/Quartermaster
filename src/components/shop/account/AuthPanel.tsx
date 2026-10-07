import type { ReactNode } from "react";
import { Container } from "@/components/shop/ui/Container";

/** Centered card for login / register / password pages. */
export function AuthPanel({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Container size="narrow" className="py-10 sm:py-20">
      <div className="mx-auto w-full max-w-[440px]">
        <div className="rounded-shop border border-shop-line bg-shop-surface px-5 py-7 sm:px-9 sm:py-10">
          <h1 className="text-[2.25rem] tracking-tight text-shop-ink sm:text-[2.75rem]">{title}</h1>
          {intro ? <p className="mt-3 text-shop-ink-2">{intro}</p> : null}
          <div className="mt-7">{children}</div>
        </div>
        {footer ? <div className="mt-6 text-center text-sm text-shop-muted">{footer}</div> : null}
      </div>
    </Container>
  );
}
