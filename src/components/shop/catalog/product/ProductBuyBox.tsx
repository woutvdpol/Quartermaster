import { WishlistButton } from "@/components/shop/account/WishlistButton";
import { AddToCartButton } from "@/components/shop/cart/AddToCartButton";

/**
 * Buy area of the product page: the cart agent's AddToCartButton (it re-checks availability on add and
 * recognises the visitor's own reservation) next to the wishlist toggle.
 * `available` is false while ANY live reservation holds the item.
 */
export function ProductBuyBox({ product, available }: { product: { id: string }; available: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <AddToCartButton productId={product.id} available={available} />
      </div>
      <WishlistButton productId={product.id} variant="full" />
    </div>
  );
}
