import Link from "next/link";
import type { ReactNode } from "react";

/*
 * Chrome for the public pages on the platform host (PLATFORM_HOST): landing, dealer sign-up and its
 * confirmation pages. Plain Quartermaster styling (docs/design/onboarding/Signup.dc.html), no shop tokens —
 * the (shop) layout renders platform-host children unwrapped.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#ECECE5] text-[#1E2119]">
      <header className="border-b border-[#D7D8CC] bg-[#FAFAF6]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Link href="/" className="font-mono text-sm font-semibold tracking-[0.3em] text-[#1E2119] uppercase">
            Quartermaster
          </Link>
          <nav aria-label="Platform" className="flex items-center gap-5 text-sm">
            <Link href="/apply" className="text-[#7E5416] hover:text-[#1E2119]">
              Open a shop
            </Link>
            <Link href="/admin" className="text-[#7E5416] hover:text-[#1E2119]">
              Dealer login
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

export function PlatformCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="platform-card-title" className="rounded-lg border border-[#D7D8CC] bg-[#FAFAF6] p-6 shadow-sm sm:p-7">
      <h1 id="platform-card-title" className="mb-4 text-2xl font-semibold tracking-tight">
        {title}
      </h1>
      {children}
    </section>
  );
}

export const platformButtonClass =
  "inline-flex h-11 items-center justify-center rounded-md bg-[#7E5416] px-5 text-sm font-semibold text-white hover:bg-[#1E2119] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7E5416] disabled:cursor-not-allowed disabled:opacity-60";
