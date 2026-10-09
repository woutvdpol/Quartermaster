"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/shop/ui/Button";
import { Container } from "@/components/shop/ui/Container";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { shopPageCopies } from "./_copy";

/** Error boundary for shop pages (the header/footer stay). */
export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useShopCopy(shopPageCopies).error;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Container size="narrow" className="py-20 text-center sm:py-28">
      <h1 className="text-[2rem] tracking-[-0.03em] text-shop-ink sm:text-[3rem]">{t.title}</h1>
      <p className="mx-auto mt-4 max-w-md text-shop-muted">{t.body}</p>
      {error.digest ? <p className="mt-2 font-shop-mono text-xs text-shop-muted">{error.digest}</p> : null}
      <div className="mt-8 flex flex-col justify-center gap-2.5 sm:flex-row">
        <Button onClick={() => reset()}>{t.retry}</Button>
        <ButtonLink href="/" variant="secondary">
          {t.home}
        </ButtonLink>
      </div>
    </Container>
  );
}
