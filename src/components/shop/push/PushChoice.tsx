"use client";

import { useId, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { pushUiCopies } from "./_copy";
import { keepEmailAction, subscribePushAction } from "./actions";
import { PushPermissionError, pushSupport, subscribeThisDevice } from "./client";
import { IosInstallSteps } from "./IosInstallSteps";

const noop = () => () => {};
type Frequency = "INSTANT" | "DAILY" | "WEEKLY";

/**
 * "How should we tell you about new pieces?" — shown in the alert dialog right after a logged-in
 * customer saved a search (design: docs/design/fair-archive-push-network/Push.dc.html). Push = this
 * device subscribes and the search switches to push (INSTANT); e-mail keeps the search as saved.
 * On iPhone Safari outside the home-screen app the push option explains "Add to Home Screen" instead
 * of asking for permission (it would fail there).
 */
export function PushChoice({
  searchId,
  searchName,
  frequency,
  publicKey,
  onClose,
}: {
  searchId: string;
  searchName: string;
  frequency: Frequency;
  publicKey: string;
  onClose: () => void;
}) {
  const t = useShopCopy(pushUiCopies);
  const id = useId();
  const support = useSyncExternalStore(noop, pushSupport, () => null);
  const [choice, setChoice] = useState<"push" | "email">("push");
  const [outcome, setOutcome] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [pending, startTransition] = useTransition();

  if (support === null) return null;
  const pushPossible = support !== "unsupported";

  function confirm() {
    if (choice === "email" || !pushPossible) {
      startTransition(async () => {
        const res = await keepEmailAction(searchId);
        setOutcome(res.ok ? { tone: "ok", text: t.choice.emailKept } : { tone: "crit", text: res.message ?? t.error });
      });
      return;
    }
    if (support === "ios-install") {
      setShowIos(true);
      return;
    }
    // The permission prompt must come straight from this click (user gesture).
    const subscribing = subscribeThisDevice(publicKey);
    startTransition(async () => {
      try {
        const sub = await subscribing;
        const res = await subscribePushAction(sub, { searchId });
        setOutcome(res.ok ? { tone: "ok", text: t.choice.pushOn } : { tone: "crit", text: res.message ?? t.error });
      } catch (err) {
        setOutcome({ tone: "crit", text: err instanceof PushPermissionError ? t.denied : t.error });
      }
    });
  }

  if (outcome?.tone === "ok") {
    return (
      <div className="grid gap-4">
        <p role="status" className="rounded-shop bg-shop-ok-soft px-4 py-3 text-sm text-shop-ok">
          {outcome.text}
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {t.close}
          </Button>
        </div>
      </div>
    );
  }

  const options = [
    ...(pushPossible ? [{ value: "push" as const, label: t.choice.pushLabel, hint: t.choice.pushHint }] : []),
    { value: "email" as const, label: t.choice.emailLabel, hint: t.choice.emailHint[frequency] },
  ];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-shop-ink-2">{t.choice.question(searchName)}</p>
      <fieldset className="grid gap-2">
        <legend className="sr-only">{t.choice.title}</legend>
        {options.map((o) => {
          const selected = (pushPossible ? choice : "email") === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-shop border p-4",
                selected ? "border-shop-primary bg-shop-sunken" : "border-shop-line bg-shop-surface",
              )}
            >
              <input
                type="radio"
                name={`${id}-delivery`}
                value={o.value}
                checked={selected}
                onChange={() => {
                  setChoice(o.value);
                  setShowIos(false);
                  setOutcome(null);
                }}
                className="mt-1 size-[1.125rem] shrink-0 accent-shop-primary"
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-semibold">{o.label}</span>
                <span className="text-sm text-shop-muted">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {showIos ? <IosInstallSteps /> : null}
      {outcome ? (
        <p role="alert" className="rounded-shop bg-shop-crit-soft px-4 py-3 text-sm text-shop-crit">
          {outcome.text}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
        {!showIos ? (
          <Button variant="primary" onClick={confirm} pending={pending}>
            {pending ? t.choice.working : choice === "push" && pushPossible ? t.choice.turnOn : t.choice.keepEmail}
          </Button>
        ) : null}
      </div>
      {choice === "push" && support === "ios-install" && !showIos ? <p className="text-xs text-shop-muted">{t.ios.hint}</p> : null}
    </div>
  );
}
