import Link from "next/link";
import { getDictionary } from "@/lib/i18n";

// Storefront placeholder; the shop is built in phase 3.
export default function HomePage() {
  const t = getDictionary();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6 py-16 font-sans text-stone-800">
      <p className="font-mono text-xs tracking-widest text-stone-500 uppercase">{t.app.name}</p>
      <h1 className="text-3xl font-semibold tracking-tight">{t.storefront.title}</h1>
      <p className="text-stone-600">{t.storefront.body}</p>
      <p>
        <Link href="/admin" className="text-stone-900 underline underline-offset-4 hover:text-stone-600">
          {t.storefront.adminLink}
        </Link>
      </p>
    </main>
  );
}
