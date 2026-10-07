import { ButtonLink } from "@/components/shop/ui/Button";
import { Container } from "@/components/shop/ui/Container";
import { shopPageCopy } from "./_copy";

const t = shopPageCopy.notFound;

/** 404 inside the shop chrome (thrown by shop pages via notFound()). */
export default function ShopNotFound() {
  return (
    <Container size="narrow" className="py-24 text-center sm:py-32">
      <p className="font-shop-heading text-7xl text-shop-secondary sm:text-8xl">{t.eyebrow}</p>
      <h1 className="mt-4 text-3xl text-shop-ink sm:text-4xl">{t.title}</h1>
      <p className="mx-auto mt-4 max-w-md text-shop-muted">{t.body}</p>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <ButtonLink href="/shop">{t.shop}</ButtonLink>
        <ButtonLink href="/" variant="outline">
          {t.home}
        </ButtonLink>
      </div>
    </Container>
  );
}
