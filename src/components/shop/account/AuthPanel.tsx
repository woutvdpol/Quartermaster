import type { ReactNode } from "react";
import { Container } from "@/components/shop/ui/Container";

/** Centered card for login / register / password pages. */
export function AuthPanel({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Container size="narrow" className="py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-3xl text-shop-ink sm:text-4xl">{title}</h1>
        {intro ? <p className="mt-2 text-shop-muted">{intro}</p> : null}
        <div className="mt-6 rounded-shop border border-shop-line bg-shop-surface p-5 shadow-shop sm:p-7">{children}</div>
        {footer ? <div className="mt-5 text-center text-sm text-shop-muted">{footer}</div> : null}
      </div>
    </Container>
  );
}
