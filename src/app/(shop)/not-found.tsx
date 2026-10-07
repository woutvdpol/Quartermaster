import { ButtonLink } from "@/components/shop/ui/Button";
import { Container } from "@/components/shop/ui/Container";
import { shopPageCopy } from "./_copy";

const t = shopPageCopy.notFound;

/** 404 inside the shop chrome (thrown by shop pages via notFound()). */
export default function ShopNotFound() {
  return (
    <Container size="narrow" className="py-20 text-center sm:py-28">
      <p className="font-shop-mono text-sm text-shop-accent">{t.eyebrow}</p>
      <h1 className="mt-3 text-[2rem] tracking-[-0.03em] text-shop-ink sm:text-[3rem]">{t.title}</h1>
      <p className="mx-auto mt-4 max-w-md text-shop-muted">{t.body}</p>
      <div className="mt-8 flex flex-col justify-center gap-2.5 sm:flex-row">
        <ButtonLink href="/shop">{t.shop}</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          {t.home}
        </ButtonLink>
      </div>
    </Container>
  );
}
