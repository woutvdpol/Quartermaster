import { WishlistButton } from "@/components/shop/account/WishlistButton";
import { AddToCartButton } from "@/components/shop/cart/AddToCartButton";

/**
 * Buy area of the product page: the cart agent's AddToCartButton (it re-checks availability on add and
 * recognises the visitor's own reservation), full width, next to a round wishlist icon toggle.
 * `available` is false while ANY live reservation holds the item.
 */
export function ProductBuyBox({ product, available }: { product: { id: string }; available: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <AddToCartButton productId={product.id} available={available} />
      </div>
      {/* Round icon button at the height of the large add-to-cart pill. */}
      <WishlistButton productId={product.id} variant="outline" />
    </div>
  );
}
