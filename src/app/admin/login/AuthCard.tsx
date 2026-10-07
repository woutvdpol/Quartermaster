import type { ReactNode } from "react";
import { LogoMark } from "@/components/admin/AdminShell";
import { getDictionary } from "@/lib/i18n";

/** Centered design-A card used by the sign-in steps. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3.5">
          <LogoMark size="lg" />
          <span className="type-display text-[28px]">{getDictionary().app.name}</span>
        </div>
        <section className="rounded-card border border-line bg-panel shadow-card" aria-labelledby="auth-title">
          <header className="border-b border-line px-5 py-3.5">
            <h1 id="auth-title" className="type-display text-[22px]">
              {title}
            </h1>
            <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>
          </header>
          <div className="p-5">{children}</div>
        </section>
      </div>
    </main>
  );
}

export const inputClass =
  "w-full rounded-control border border-line bg-panel px-2.5 py-2 text-[14px] text-ink placeholder:text-muted " +
  "aria-invalid:border-crit";

export const labelClass = "type-label mb-1 block text-[11.5px] text-muted";

export function FormError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="rounded-control border border-crit bg-crit-soft px-3 py-2 text-[13px] text-crit">
      {children}
    </p>
  );
}
