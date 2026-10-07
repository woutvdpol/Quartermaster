"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { Turnstile } from "@/components/shop/turnstile";
import { subscribeNewsletter, type NewsletterState } from "./newsletter-action";
import { layoutCopy } from "./_copy";

const t = layoutCopy.newsletter;

/**
 * Email sign-up form (footer + NEWSLETTER_SIGNUP block). Progressive enhancement: works without JS.
 * `tone="dark"` for placement on a primary-coloured band (the gallery footer is light).
 */
export function NewsletterForm({ source = "footer", tone = "light", className }: { source?: "footer" | "block" | "popup"; tone?: "light" | "dark"; className?: string }) {
  const [state, action, pending] = useActionState<NewsletterState, FormData>(subscribeNewsletter, { status: "idle" });
  const id = useId();
  const message =
    state.status === "success" ? t.success : state.status === "invalid" ? t.invalid : state.status === "too_many" ? t.tooMany : state.status === "unavailable" ? t.unavailable : state.status === "captcha" ? t.captcha : null;
  const isError = state.status !== "success" && state.status !== "idle";

  if (state.status === "success") {
    return (
      <p role="status" className={cn("text-sm font-medium", tone === "dark" ? "text-shop-on-primary" : "text-shop-ok", className)}>
        {t.success}
      </p>
    );
  }
  return (
    <form action={action} className={cn("flex flex-col gap-2", className)} noValidate>
      <input type="hidden" name="source" value={source} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>{t.honeypot}</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label htmlFor={`${id}-email`} className="sr-only">
        {t.emailLabel}
      </label>
      {/* Pill input + button side by side from sm up; stacked in narrow (dark) placements. */}
      <div className={cn("flex flex-col gap-2", tone !== "dark" && "sm:flex-row")}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          defaultValue={state.email}
          placeholder={t.placeholder}
          aria-invalid={isError || undefined}
          aria-describedby={message ? `${id}-msg` : undefined}
          className={cn(
            "h-12 min-w-0 flex-none rounded-shop-control sm:flex-1 border px-[18px] text-[0.95rem] focus:outline-none",
            tone === "dark"
              ? "border-shop-on-primary/30 bg-shop-on-primary/10 text-shop-on-primary placeholder:text-shop-on-primary/60 focus:border-shop-on-primary"
              : "border-shop-line-strong bg-shop-surface text-shop-ink placeholder:text-shop-muted focus:border-shop-primary",
          )}
        />
        <Button type="submit" variant={tone === "dark" ? "secondary" : "primary"} pending={pending} className="h-12! px-6!">
          {pending ? t.submitting : t.submit}
        </Button>
      </div>
      <Turnstile action="newsletter" resetKey={state} />
      {message ? (
        <p id={`${id}-msg`} role="alert" className={cn("text-sm", tone === "dark" ? "text-shop-on-primary" : "text-shop-crit")}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
