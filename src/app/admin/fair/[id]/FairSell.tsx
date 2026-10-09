"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Thumb, controlClass, currencyDigits, cx, formatMoney, formatMoneyInput, parseMoney } from "@/components/admin/ui";
import type { FairSellData } from "@/server/fairs/index";
import { FAIR_METHOD_LABELS, FAIR_PAYMENT_METHODS, stockCodeFromScan, type FairPaymentMethod } from "@/server/fairs/pure";
import { enqueueSale, retryDelay, syncOutcome, type QueuedSale } from "@/server/fairs/queue";
import { kvGet, kvSet } from "./storage";
import { sellCopy as t } from "./_copy";

/*
 * Fair-mode client (docs/fair-mode.md, design board "Main"): scan → item → sold.
 * Offline first: the fair's item list is cached on load, every sale is queued (IndexedDB) with a
 * clientRef and synced to /admin/fair/<id>/sales with retries. The server is idempotent on clientRef,
 * so a sale that was delivered but whose answer got lost is never recorded twice.
 * No service worker here (the push feature owns it): the page must be opened while online once.
 */

type Item = FairSellData["items"][number];
type LogEntry = { clientRef: string; stockCode: number; price: number; at: string; orderNumber: number | null };
type Screen = { kind: "scan"; message?: string } | { kind: "item"; productId: string } | { kind: "sold"; clientRef: string; stockCode: number };

const key = (fairId: string, part: "data" | "queue" | "log") => `fair:${fairId}:${part}`;

function newClientRef(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function FairSell({ initial }: { initial: FairSellData }) {
  const fairId = initial.fair.id;
  const currency = initial.currency;
  const money = useCallback((n: number) => formatMoney(n, currency), [currency]);

  const [data, setData] = useState(initial);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [screen, setScreen] = useState<Screen>({ kind: "scan" });

  const queueRef = useRef(queue);
  const logRef = useRef(log);
  const syncing = useRef(false);
  const nextTry = useRef(0);

  const saveQueue = useCallback(
    (update: (q: QueuedSale[]) => QueuedSale[]) => {
      queueRef.current = update(queueRef.current);
      setQueue(queueRef.current);
      void kvSet(key(fairId, "queue"), queueRef.current);
    },
    [fairId],
  );
  const saveLog = useCallback(
    (update: (l: LogEntry[]) => LogEntry[]) => {
      logRef.current = update(logRef.current);
      setLog(logRef.current);
      void kvSet(key(fairId, "log"), logRef.current);
    },
    [fairId],
  );

  const refreshData = useCallback(async () => {
    try {
      const res = await fetch(`/admin/fair/${fairId}/sales`, { cache: "no-store", credentials: "same-origin" });
      if (res.redirected && res.url.includes("/admin/login")) return setAuthNeeded(true);
      const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: FairSellData } | null;
      if (res.status === 401 || res.status === 403) return setAuthNeeded(true);
      if (body?.ok && body.data) {
        setData(body.data);
        void kvSet(key(fairId, "data"), body.data);
      }
    } catch {
      // offline: keep the cached list
    }
  }, [fairId]);

  const syncNow = useCallback(async () => {
    if (syncing.current || authNeeded) return;
    const pending = queueRef.current.filter((s) => s.state === "pending");
    if (!pending.length) return;
    syncing.current = true;
    let delivered = 0;
    try {
      for (const sale of pending) {
        let status = 0;
        let body: { ok?: boolean; code?: string; message?: string; orderNumber?: number } | null = null;
        try {
          const res = await fetch(`/admin/fair/${fairId}/sales`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            cache: "no-store",
            body: JSON.stringify({
              productId: sale.productId,
              price: sale.price,
              method: sale.method,
              buyerEmail: sale.buyerEmail,
              allowBelowFloor: sale.allowBelowFloor,
              clientRef: sale.clientRef,
              soldAt: sale.soldAt,
            }),
          });
          status = res.redirected && res.url.includes("/admin/login") ? 401 : res.status;
          body = await res.json().catch(() => null);
        } catch {
          status = 0;
        }
        const outcome = syncOutcome(status, body);
        if (outcome === "done") {
          delivered += 1;
          saveQueue((q) => q.filter((s) => s.clientRef !== sale.clientRef));
          saveLog((l) => l.map((e) => (e.clientRef === sale.clientRef ? { ...e, orderNumber: body?.orderNumber ?? null } : e)));
          continue;
        }
        if (outcome === "rejected") {
          saveQueue((q) => q.map((s) => (s.clientRef === sale.clientRef ? { ...s, state: "rejected", error: body?.message ?? "Refused" } : s)));
          saveLog((l) => l.filter((e) => e.clientRef !== sale.clientRef));
          continue;
        }
        if (outcome === "auth") setAuthNeeded(true);
        else {
          const attempts = sale.attempts + 1;
          saveQueue((q) => q.map((s) => (s.clientRef === sale.clientRef ? { ...s, attempts } : s)));
          nextTry.current = Date.now() + retryDelay(attempts);
        }
        break;
      }
    } finally {
      syncing.current = false;
    }
    if (delivered) void refreshData();
  }, [authNeeded, fairId, refreshData, saveLog, saveQueue]);

  // Restore the queue/log (and cached list when the server copy is older) once on mount.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [q, l] = await Promise.all([kvGet<QueuedSale[]>(key(fairId, "queue")), kvGet<LogEntry[]>(key(fairId, "log"))]);
      if (!alive) return;
      queueRef.current = q ?? [];
      logRef.current = l ?? [];
      setQueue(queueRef.current);
      setLog(logRef.current);
      void kvSet(key(fairId, "data"), initial);
      void syncNow();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [fairId]);

  // Connectivity + retry loop.
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        nextTry.current = 0;
        void syncNow();
        void refreshData();
      }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const timer = window.setInterval(() => {
      if (navigator.onLine && Date.now() >= nextTry.current) void syncNow();
    }, 2_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.clearInterval(timer);
    };
  }, [refreshData, syncNow]);

  const locallySold = useMemo(() => new Set(queue.filter((s) => s.state === "pending").map((s) => s.productId)), [queue]);
  const items = data.items;
  const forSale = items.filter((i) => i.available && !locallySold.has(i.productId));
  const pendingCount = queue.filter((s) => s.state === "pending").length;
  const rejected = queue.filter((s) => s.state === "rejected");
  const today = new Date().toDateString();
  const todayLog = log.filter((e) => new Date(e.at).toDateString() === today);
  const canSell = data.fair.status === "LIVE";

  function lookup(text: string) {
    const code = stockCodeFromScan(text);
    if (code === null) return setScreen({ kind: "scan", message: t.scan.invalid });
    const item = items.find((i) => i.stockCode === code);
    if (!item) return setScreen({ kind: "scan", message: t.scan.notOnFair(code) });
    if (item.sold || locallySold.has(item.productId)) return setScreen({ kind: "scan", message: t.scan.alreadySold(code) });
    if (!item.available) return setScreen({ kind: "scan", message: t.scan.unavailable(code) });
    setScreen({ kind: "item", productId: item.productId });
  }

  function confirm(item: Item, sale: { price: number; method: FairPaymentMethod; buyerEmail: string | null; allowBelowFloor: boolean }) {
    const clientRef = newClientRef();
    const at = new Date().toISOString();
    saveQueue((q) =>
      enqueueSale(q, { clientRef, fairId, productId: item.productId, stockCode: item.stockCode, title: item.title, ...sale, soldAt: at, attempts: 0, state: "pending", error: null }),
    );
    saveLog((l) => [...l, { clientRef, stockCode: item.stockCode, price: sale.price, at, orderNumber: null }]);
    setScreen({ kind: "sold", clientRef, stockCode: item.stockCode });
    nextTry.current = 0;
    void syncNow();
  }

  const net = authNeeded ? t.net.auth : !online ? t.net.offline(pendingCount) : pendingCount ? t.net.syncing(pendingCount) : t.net.synced;
  const dot = authNeeded ? "bg-crit" : !online || pendingCount ? "bg-warn" : "bg-ok";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-10 grid gap-1.5 bg-rail px-4 py-3 text-rail-ink">
        <div className="flex items-center justify-between gap-3">
          <Link href={`/admin/fairs/${fairId}`} className="type-display text-lg tracking-[0.06em] uppercase" aria-label={t.back}>
            {t.brand}
          </Link>
          <span className="truncate text-[13px]">{data.fair.name}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5" role="status" aria-live="polite">
            <span aria-hidden="true" className={cx("size-2 rounded-full", dot)} />
            {net}
            {authNeeded ? (
              <Link className="underline" href={`/admin/login?next=${encodeURIComponent(`/admin/fair/${fairId}`)}`}>
                {t.net.signIn}
              </Link>
            ) : null}
          </span>
          <span className="font-mono">{t.today(todayLog.length, money(todayLog.reduce((s, e) => s + e.price, 0)))}</span>
        </div>
      </header>

      {rejected.length ? (
        <section className="grid gap-2 border-b border-line bg-crit-soft px-4 py-3 text-sm" aria-label={t.rejected.title}>
          <strong className="text-crit">{t.rejected.title}</strong>
          {rejected.map((s) => (
            <div key={s.clientRef} className="flex items-start justify-between gap-3">
              <span>
                <span className="font-mono">No. {s.stockCode}</span> · {money(s.price)} · {s.error}
              </span>
              <Button size="sm" onClick={() => { saveQueue((q) => q.filter((x) => x.clientRef !== s.clientRef)); void refreshData(); }}>
                {t.rejected.dismiss}
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      {!canSell ? <p className="border-b border-line bg-info-soft px-4 py-2 text-sm">{t.notLive[data.fair.status === "PREPARING" ? "PREPARING" : "ENDED"]}</p> : null}

      {screen.kind === "scan" ? (
        <ScanScreen
          disabled={!canSell}
          message={screen.message}
          onTable={forSale.length}
          hidden={data.fair.hideFromShop}
          status={data.fair.status}
          onLookup={lookup}
        />
      ) : null}
      {screen.kind === "item"
        ? (() => {
            const item = items.find((i) => i.productId === screen.productId);
            return item ? <ItemScreen key={item.productId} item={item} currency={currency} onConfirm={(s) => confirm(item, s)} onCancel={() => setScreen({ kind: "scan" })} /> : null;
          })()
        : null}
      {screen.kind === "sold" ? (
        <SoldScreen stockCode={screen.stockCode} orderNumber={log.find((e) => e.clientRef === screen.clientRef)?.orderNumber ?? null} onNext={() => setScreen({ kind: "scan" })} />
      ) : null}
    </div>
  );
}

// ─── Scan ───────────────────────────────────────────────────────────────────

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

function ScanScreen({
  disabled,
  message,
  onTable,
  hidden,
  status,
  onLookup,
}: {
  disabled: boolean;
  message?: string;
  onTable: number;
  hidden: boolean;
  status: "PREPARING" | "LIVE" | "ENDED";
  onLookup: (text: string) => void;
}) {
  const shopNote = status === "ENDED" ? t.scan.ended : !hidden ? t.scan.visible : status === "PREPARING" ? t.scan.hiddenSoon : t.scan.hidden;
  const [code, setCode] = useState("");
  return (
    <main className="grid flex-1 content-start gap-4 p-4">
      {disabled ? null : <Camera onCode={onLookup} />}
      <form
        className="grid gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onLookup(code);
        }}
      >
        <label htmlFor="fair-code" className="text-[13px] text-muted">
          {t.scan.typeLabel}
        </label>
        <div className="flex gap-2">
          <input
            id="fair-code"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            disabled={disabled}
            onChange={(e) => setCode(e.target.value)}
            className={cx(controlClass, "h-12 flex-1 font-mono text-lg")}
          />
          <Button type="submit" variant="primary" size="lg" disabled={disabled} className="h-12">
            {t.scan.find}
          </Button>
        </div>
      </form>
      {message ? (
        <p role="alert" className="rounded-control border border-crit bg-crit-soft px-3 py-2 text-sm text-crit">
          {message}
        </p>
      ) : null}
      <div className="grid gap-1 rounded-card border border-line bg-panel px-3.5 py-3 text-[13px]">
        <strong>{t.scan.onTable(onTable)}</strong>
        <span className="text-muted">{shopNote}</span>
      </div>
    </main>
  );
}

function Camera({ onCode }: { onCode: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const [state, setState] = useState<"starting" | "on" | "unsupported" | "error">("starting");
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    void (async () => {
      if (!Ctor || !navigator.mediaDevices?.getUserMedia) return setState("unsupported");
      try {
        const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
        if (!formats.includes("qr_code")) return setState("unsupported");
        const detector = new Ctor({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setState("on");
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) {
              onCodeRef.current(codes[0].rawValue);
              // Still here (unknown / sold code): pause before scanning again, so one label isn't read 4×/s.
              timer = window.setTimeout(tick, 1_500);
              return;
            }
          } catch {
            // frame not ready yet
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch {
        if (!stopped) setState("error");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (state === "unsupported" || state === "error") {
    return <p className="rounded-control border border-line bg-panel-2 px-3 py-2 text-sm text-muted">{state === "error" ? t.scan.cameraError : t.scan.noCamera}</p>;
  }
  return (
    <div className="relative grid aspect-square place-items-center overflow-hidden rounded-card bg-rail">
      <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
      <span aria-hidden="true" className="relative aspect-square w-[62%] rounded-xl border-[3px] border-accent" />
      <span className="absolute bottom-3.5 text-[13px] text-rail-ink">{t.scan.point}</span>
    </div>
  );
}

// ─── Item ───────────────────────────────────────────────────────────────────

function ItemScreen({
  item,
  currency,
  onConfirm,
  onCancel,
}: {
  item: Item;
  currency: string;
  onConfirm: (sale: { price: number; method: FairPaymentMethod; buyerEmail: string | null; allowBelowFloor: boolean }) => void;
  onCancel: () => void;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const [priceText, setPriceText] = useState(formatMoneyInput(item.listPrice, currency));
  const [method, setMethod] = useState<FairPaymentMethod>("card");
  const [email, setEmail] = useState("");
  const [override, setOverride] = useState(false);
  const price = parseMoney(priceText, currencyDigits(currency));
  const valid = price !== null && price > 0;
  const below = valid && price < item.floor;
  const margin = valid && item.purchasePrice !== null ? price - item.purchasePrice : null;
  const emailOk = email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = valid && (!below || override) && emailOk;

  return (
    <main className="flex flex-1 flex-col gap-3 p-4">
      <div className="flex gap-3 rounded-card border border-line bg-panel p-3">
        <Thumb src={item.thumb ?? undefined} alt="" size="lg" />
        <span className="grid content-start gap-1">
          <span className="font-mono text-xs text-muted">No. {item.stockCode}</span>
          <strong className="text-base leading-tight">{item.title}</strong>
          <span className="text-[13px] text-muted">{t.item.listed(money(item.listPrice), item.purchasePrice === null ? null : money(item.purchasePrice))}</span>
        </span>
      </div>

      <label className="grid gap-1 text-[13px] text-muted">
        {t.item.price}
        <input
          type="text"
          inputMode="decimal"
          value={priceText}
          onChange={(e) => setPriceText(e.target.value)}
          // Select the suggested price on tap, so typing replaces it instead of appending (iOS needs the tick).
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(() => el.select(), 0);
          }}
          aria-invalid={!valid || (below && !override) || undefined}
          className={cx(controlClass, "h-[52px] text-[22px] font-semibold text-ink", (!valid || (below && !override)) && "border-crit")}
        />
      </label>
      <span className="text-xs text-muted">
        {t.item.floor(money(item.floor), margin === null ? null : money(margin))}
        {!valid ? <span className="ml-1 text-crit">{t.item.invalidPrice}</span> : null}
      </span>
      {below ? (
        <label className="flex items-center gap-2 rounded-control border border-warn bg-warn-soft px-3 py-2 text-sm">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="size-4 accent-accent" />
          <span>
            <strong>{t.item.belowFloor}</strong> {t.item.override}
          </span>
        </label>
      ) : null}

      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="mb-1.5 text-[13px] text-muted">{t.item.paidWith}</legend>
        {FAIR_PAYMENT_METHODS.map((m) => (
          <label
            key={m}
            className={cx(
              "flex h-12 cursor-pointer items-center justify-center gap-1.5 rounded-control border bg-panel text-sm",
              method === m ? "border-2 border-ink font-semibold" : "border-line-strong",
            )}
          >
            <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="accent-accent" />
            {FAIR_METHOD_LABELS[m]}
          </label>
        ))}
      </fieldset>
      <span className="text-xs text-muted">{method === "invoice" ? t.item.invoiceHint : t.item.methodHint}</span>

      <label className="grid gap-1 text-[13px] text-muted">
        {t.item.email}
        <input
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          placeholder="name@example.com"
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!emailOk || undefined}
          className={cx(controlClass, "h-11", !emailOk && "border-crit")}
        />
      </label>

      <div className="mt-auto grid gap-2 pt-2">
        <Button
          variant="primary"
          size="lg"
          className="h-[54px] text-base"
          disabled={!ready}
          onClick={() => valid && onConfirm({ price, method, buyerEmail: email.trim() || null, allowBelowFloor: below && override })}
        >
          {valid ? (method === "invoice" ? t.item.confirmInvoice(money(price)) : t.item.confirm(money(price))) : t.item.invalidPrice}
        </Button>
        <Button size="lg" onClick={onCancel}>
          {t.item.cancel}
        </Button>
      </div>
    </main>
  );
}

// ─── Sold ───────────────────────────────────────────────────────────────────

function SoldScreen({ stockCode, orderNumber, onNext }: { stockCode: number; orderNumber: number | null; onNext: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3.5 px-4 py-6 text-center">
      <span aria-hidden="true" className="grid size-[72px] place-items-center rounded-full bg-ok-soft text-[34px] font-semibold text-ok">
        ✓
      </span>
      <strong className="text-[22px]" role="status">
        {t.sold.title(stockCode)}
      </strong>
      <span className="text-muted" aria-live="polite">
        {orderNumber ? t.sold.synced(orderNumber) : t.sold.queued}
      </span>
      <Button variant="primary" size="lg" className="mt-2.5 h-[52px] w-full" onClick={onNext} autoFocus>
        {t.sold.next}
      </Button>
    </main>
  );
}
