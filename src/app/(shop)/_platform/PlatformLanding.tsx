import Link from "next/link";
import { platformCopy as t } from "./_copy";

/** `/` on the platform host (PLATFORM_HOST): a plain Quartermaster landing page, no shop chrome. */
export function PlatformLanding() {
  return (
    <main className="flex min-h-dvh flex-col bg-[#f4f1e8] text-[#23241e]">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-20">
        <p className="font-mono text-xs tracking-[0.3em] text-[#6f6c5e] uppercase">{t.name}</p>
        <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">{t.title}</h1>
        <p className="max-w-xl text-lg text-[#44453b]">{t.body}</p>
        <p className="flex flex-wrap gap-3">
          <Link
            href="/apply"
            className="inline-flex h-11 items-center rounded-md bg-[#7E5416] px-5 text-sm font-medium text-white hover:bg-[#23241e]"
          >
            {t.applyLink}
          </Link>
          <Link
            href="/admin"
            className="inline-flex h-11 items-center rounded-md border border-[#23241e] px-5 text-sm font-medium text-[#23241e] hover:bg-[#23241e] hover:text-[#f4f1e8]"
          >
            {t.adminLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
