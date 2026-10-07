import { redirect } from "next/navigation";

/** Alias: the wishlist lives at /wishlist (the header links here). */
export default function AccountWishlistAlias(): never {
  redirect("/wishlist");
}
