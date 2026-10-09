"use client";

import { useEffect, useId, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/shop/ui/Button";
import { Select, checkClasses } from "@/components/shop/ui/Field";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { pushUiCopies } from "./_copy";
import { getPushStateAction, subscribePushAction, unsubscribePushAction, updatePushPrefsAction } from "./actions";
import { PushPermissionError, currentSubscription, pushSupport, subscribeThisDevice, unsubscribeThisDevice } from "./client";
import { IosInstallSteps } from "./IosInstallSteps";

const noop = () => () => {};

export type PushSettingsData = {
  publicKey: string;
  devices: number;
  quietStart: number | null;
  quietEnd: number | null;
  maxPerDay: number;
  wishlist: boolean;
  reservation: boolean;
  quietPresets: readonly { start: number; end: number }[];
  maxOptions: readonly number[];
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const quietValue = (start: number | null, end: number | null) => (start === null || end === null ? "" : `${start}-${end}`);

/** Account › Alerts: push on this device, wishlist / reservation pushes, quiet hours, daily maximum (docs/push.md). */
export function PushSettings({ initial }: { initial: PushSettingsData }) {
  const copy = useShopCopy(pushUiCopies);
  const t = copy.settings;
  const id = useId();
  const support = useSyncExternalStore(noop, pushSupport, () => null);
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined); // undefined = still checking
  const [devices, setDevices] = useState(initial.devices);
  const [thisDevice, setThisDevice] = useState(false);
  const [prefs, setPrefs] = useState({
    quiet: quietValue(initial.quietStart, initial.quietEnd),
    maxPerDay: initial.maxPerDay,
    wishlist: initial.wishlist,
    reservation: initial.reservation,
  });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [pending, startTransition] = useTransition();

  // Is this browser one of the customer's devices?
  useEffect(() => {
    let live = true;
    currentSubscription()
      .catch(() => null)
      .then(async (sub) => {
        const ep = sub?.endpoint ?? null;
        const state = await getPushStateAction(ep);
        if (!live) return;
        setEndpoint(ep);
        if (state.loggedIn) {
          setThisDevice(state.thisDevice);
          setDevices(state.devices);
        }
      })
      .catch(() => live && setEndpoint(null));
    return () => {
      live = false;
    };
  }, []);

  function save(patch: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updatePushPrefsAction(patch);
      setStatus({ ok: res.ok, text: res.message ?? (res.ok ? t.saved : copy.error) });
    });
  }

  function turnOn() {
    if (support === "ios-install") {
      setShowIos(true);
      return;
    }
    const subscribing = subscribeThisDevice(initial.publicKey); // permission prompt needs this click
    startTransition(async () => {
      try {
        const sub = await subscribing;
        const res = await subscribePushAction(sub);
        if (res.ok) {
          setEndpoint(sub.endpoint ?? null);
          if (!thisDevice) setDevices((n) => n + 1);
          setThisDevice(true);
        }
        setStatus(res.ok ? { ok: true, text: t.thisDeviceOn } : { ok: false, text: res.message ?? copy.error });
      } catch (err) {
        setStatus({ ok: false, text: err instanceof PushPermissionError ? copy.denied : copy.error });
      }
    });
  }

  function turnOff() {
    startTransition(async () => {
      const ep = (await unsubscribeThisDevice().catch(() => null)) ?? endpoint ?? null;
      const res = await unsubscribePushAction(ep);
      if (res.ok) {
        if (thisDevice) setDevices((n) => Math.max(0, n - 1));
        setThisDevice(false);
        setEndpoint(null);
      }
      setStatus(res.ok ? { ok: true, text: t.thisDeviceOff } : { ok: false, text: res.message ?? copy.error });
    });
  }

  const presetValues = initial.quietPresets.map((p) => quietValue(p.start, p.end));
  const quietOptions = [
    ...(prefs.quiet && !presetValues.includes(prefs.quiet) ? [prefs.quiet] : []),
    ...presetValues,
  ];

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-shop border border-shop-line bg-shop-surface p-5 sm:p-6">
      <h2 id={`${id}-title`} className="text-xl">
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-shop-muted">{t.intro}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-shop bg-shop-sunken px-4 py-3">
        <div className="text-sm">
          <p className="font-semibold">{thisDevice ? t.thisDeviceOn : t.thisDeviceOff}</p>
          {devices > 0 ? <p className="text-shop-muted">{t.otherDevices(devices)}</p> : null}
        </div>
        {support === null || endpoint === undefined ? null : thisDevice ? (
          <Button variant="outline" size="sm" onClick={turnOff} pending={pending}>
            {t.turnOff}
          </Button>
        ) : support === "unsupported" ? (
          <p className="text-sm text-shop-muted">{copy.unsupported}</p>
        ) : (
          <Button variant="primary" size="sm" onClick={turnOn} pending={pending}>
            {t.turnOn}
          </Button>
        )}
      </div>
      {showIos ? (
        <div className="mt-3">
          <IosInstallSteps />
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className={checkClasses}
            checked={prefs.wishlist}
            onChange={(e) => {
              setPrefs((p) => ({ ...p, wishlist: e.target.checked }));
              save({ wishlist: e.target.checked });
            }}
          />
          {t.wishlist}
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className={checkClasses}
            checked={prefs.reservation}
            onChange={(e) => {
              setPrefs((p) => ({ ...p, reservation: e.target.checked }));
              save({ reservation: e.target.checked });
            }}
          />
          {t.reservation}
        </label>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          {t.quiet}
          <Select
            value={prefs.quiet}
            onChange={(e) => {
              const v = e.target.value;
              setPrefs((p) => ({ ...p, quiet: v }));
              const [start, end] = v ? v.split("-").map(Number) : [null, null];
              save({ quietStart: start, quietEnd: end });
            }}
          >
            <option value="">{t.quietOff}</option>
            {quietOptions.map((v) => {
              const [s, e] = v.split("-").map(Number);
              return (
                <option key={v} value={v}>
                  {hhmm(s)} – {hhmm(e)}
                </option>
              );
            })}
          </Select>
          <span className="text-xs font-normal text-shop-muted">{t.quietHint}</span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {t.max}
          <Select
            value={String(prefs.maxPerDay)}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPrefs((p) => ({ ...p, maxPerDay: n }));
              save({ maxPerDay: n });
            }}
          >
            {[...new Set([...initial.maxOptions, prefs.maxPerDay])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n} disabled={!initial.maxOptions.includes(n)}>
                  {t.maxOption(n)}
                </option>
              ))}
          </Select>
        </label>
      </div>

      {status ? (
        <p role={status.ok ? "status" : "alert"} className={`mt-3 text-sm ${status.ok ? "text-shop-ok" : "text-shop-crit"}`}>
          {status.text}
        </p>
      ) : null}
    </section>
  );
}
