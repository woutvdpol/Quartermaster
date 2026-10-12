"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "@/components/shop/ui/Link";
import { Button, ButtonLink } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { useShopCopy, useShopLocale } from "@/components/shop/i18n/ShopLocale";
import { formatShopDate } from "@/lib/i18n/shop-copy";
import type { IncrementTable } from "@/server/auctions/increments";
import { VERIFY_EMAIL_PATH } from "@/server/email-verification/config";
import { useApplyLot, useExtendedFlash, useLiveLot, useLiveStatus, useServerNow } from "./AuctionLive";
import { Countdown } from "./Countdown";
import { Modal } from "./Modal";
import { acceptTermsAction, placeBidAction, refreshLotAction } from "./actions";
import { displayPrice, needsConfirm, quickBids, stepFor } from "./lib/bid-rules";
import { formatBidMoney, formatMoneyInput, parseMoneyInput } from "./lib/money";
import type { BidFailure, MyPosition } from "./lib/results";
import { isBiddable, lotChip } from "./lib/status";
import type { LiveBid, LiveLot } from "./lib/types";
import { auctionCopies } from "./_copy";

/** Who is looking: decides what the bid box offers. */
export type BidViewer =
  | { kind: "guest"; loginHref: string; registerHref: string }
  | { kind: "staff" }
  | { kind: "unverified"; verifyHref: string }
  | ({ kind: "customer" } & MyPosition);

type Dialog = { kind: "confirm" | "terms"; amount: number } | null;

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
const CLOSE_OPTS: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

/**
 * Lot page bid box + bid history + phone bid bar (design "Main" / "Phone"). Reads the lot live from the
 * AuctionLiveProvider; no optimistic UI — every bid waits for the server, which is the only authority on
 * price, leader and closing time. Flow: (terms dialog on the first bid in an auction) → (confirm for
 * large maxima) → place. Stream changes to this lot refresh the history and the viewer's position.
 */
export function LotBidding({
  initialLot,
  auction,
  currency,
  timeZone,
  renderedAt,
  table,
  viewer: initialViewer,
  initialHistory,
  termsHref,
  productHref,
  ageConfirm = null,
}: {
  initialLot: LiveLot;
  auction: { id: string; opensAt: string; extendSeconds: number };
  currency: string;
  timeZone: string;
  renderedAt: number;
  table: IncrementTable;
  viewer: BidViewer;
  initialHistory: LiveBid[];
  termsHref: string;
  /** Product page (unsold lots go back to the shop). */
  productHref: string;
  /** Age-restricted lot in a shop that verifies age at checkout: the minimum age to confirm with the bid. */
  ageConfirm?: number | null;
}) {
  const t = useShopCopy(auctionCopies);
  const tl = t.lotPage;
  const locale = useShopLocale();
  const lot = useLiveLot(initialLot);
  const now = useServerNow(renderedAt);
  const extended = useExtendedFlash(lot.id);
  const liveStatus = useLiveStatus();
  const applyLot = useApplyLot();
  const [viewer, setViewer] = useState<BidViewer>(initialViewer);
  const [history, setHistory] = useState<LiveBid[]>(initialHistory);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [ageOk, setAgeOk] = useState(false);
  const [busy, startBusy] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const money = (minor: number) => formatBidMoney(minor, currency, locale);
  const extendMin = Math.max(1, Math.round(auction.extendSeconds / 60));
  const me = viewer.kind === "customer" ? viewer : null;
  const myNumber = me?.bidderNumber ?? null;
  const leading = myNumber !== null && lot.leaderNumber === myNumber;
  const chip = lotChip(lot, me ? { bidderNumber: myNumber, hasBid: me.hasBid } : null, now, auction.opensAt);
  const biddable = isBiddable(lot, now, auction.opensAt);
  // A leader raising their maximum must go above it (engine: minimumFor).
  const minimum = leading && me?.myMax ? Math.max(lot.nextMinimum, me.myMax + stepFor(me.myMax, table)) : lot.nextMinimum;
  const quick = quickBids({ nextMinimum: minimum }, table);
  const price = displayPrice(lot);

  // Stream changes to this lot (new bid, close, extension) → refresh history + own position. Debounced:
  // one auto-bid sequence arrives as a burst of events.
  const seen = useRef(`${lot.bidCount}:${lot.status}:${lot.currentBid}`);
  useEffect(() => {
    const key = `${lot.bidCount}:${lot.status}:${lot.currentBid}`;
    if (key === seen.current) return;
    seen.current = key;
    const timer = setTimeout(async () => {
      try {
        const r = await refreshLotAction(lot.id);
        setHistory(r.history);
        if (r.mine) setViewer((v) => (v.kind === "customer" ? { kind: "customer", ...r.mine! } : v));
      } catch {
        // keep what we have; the next change retries
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [lot.id, lot.bidCount, lot.status, lot.currentBid]);

  const errorText = (f: BidFailure): string => {
    switch (f.code) {
      case "BELOW_MINIMUM":
        return f.minimum ? t.errors.BELOW_MINIMUM(money(f.minimum)) : t.errors.BELOW_MINIMUM_PLAIN;
      case "INVALID_AMOUNT":
        return t.errors.invalidAmount;
      case "RATE_LIMITED":
        return t.errors.rateLimited;
      case "GENERIC":
        return t.errors.generic;
      default:
        return t.errors[f.code];
    }
  };

  const place = (amount: number) => {
    setError(null);
    setNotice(null);
    startBusy(async () => {
      const requestId = crypto.randomUUID();
      let r: Awaited<ReturnType<typeof placeBidAction>>;
      try {
        r = await placeBidAction({ lotId: lot.id, maxAmount: amount, requestId, ageConfirmed: ageOk });
      } catch {
        setError(t.errors.generic);
        return;
      }
      if (!r.ok) {
        if (r.code === "TERMS_REQUIRED") {
          setViewer((v) => (v.kind === "customer" ? { ...v, termsAccepted: false } : v));
          setDialog({ kind: "terms", amount });
          return;
        }
        if (r.code === "NOT_VERIFIED") setViewer({ kind: "unverified", verifyHref: VERIFY_EMAIL_PATH });
        setError(errorText(r));
        return;
      }
      if (r.lot) {
        // Show the new state at once (the stream confirms it); no second refresh for this change.
        seen.current = `${r.lot.bidCount}:${r.lot.status}:${r.lot.currentBid}`;
        applyLot(r.lot);
      }
      if (r.history.length) setHistory(r.history);
      if (r.mine) {
        setViewer({ kind: "customer", ...r.mine });
        setNotice(r.mine.isLeading ? tl.placedLeading : tl.placedOutbid);
      }
      setInput("");
    });
  };

  /** Entry point for the bid button, quick bids and the phone bar. */
  const start = (amount: number | null) => {
    setNotice(null);
    if (amount === null) {
      setError(t.errors.invalidAmount);
      inputRef.current?.focus();
      return;
    }
    if (amount < minimum) {
      setError(t.errors.BELOW_MINIMUM(money(minimum)));
      inputRef.current?.focus();
      return;
    }
    if (ageConfirm && !ageOk) {
      setError(tl.ageRequired);
      return;
    }
    setError(null);
    if (me && !me.termsAccepted) {
      setTermsChecked(false);
      setTermsError(false);
      setDialog({ kind: "terms", amount });
      return;
    }
    if (needsConfirm(amount, lot)) {
      setDialog({ kind: "confirm", amount });
      return;
    }
    place(amount);
  };

  const acceptTerms = () => {
    if (!dialog) return;
    if (!termsChecked) {
      setTermsError(true);
      return;
    }
    const amount = dialog.amount;
    startBusy(async () => {
      let r: Awaited<ReturnType<typeof acceptTermsAction>>;
      try {
        r = await acceptTermsAction(auction.id);
      } catch {
        setDialog(null);
        setError(t.errors.generic);
        return;
      }
      if (!r.ok) {
        setDialog(null);
        setError(errorText(r));
        return;
      }
      setViewer((v) => (v.kind === "customer" ? { ...v, termsAccepted: true, bidderNumber: r.bidderNumber } : v));
      if (needsConfirm(amount, lot)) setDialog({ kind: "confirm", amount });
      else {
        setDialog(null);
        place(amount);
      }
    });
  };

  const status = statusLine();
  function statusLine(): { text: string; tone: "ok" | "warn" | "neutral"; link?: { href: string; label: string } } {
    const s = tl.status;
    switch (chip) {
      case "won":
        return { text: s.won(money(price)), tone: "ok" };
      case "sold":
        return { text: s.sold(money(price)), tone: "neutral" };
      case "unsold":
        return { text: s.unsold, tone: "neutral", link: { href: productHref, label: s.backInShop } };
      case "cancelled":
        return { text: s.cancelled, tone: "neutral" };
      case "closing":
        return { text: s.closing, tone: "neutral" };
      case "upcoming":
        return { text: s.upcoming(formatShopDate(auction.opensAt, locale, CLOSE_OPTS, timeZone)), tone: "neutral" };
      case "lead":
        return { text: me?.myMax ? s.leading(money(me.myMax)) : s.leadingNoMax, tone: "ok" };
      case "outbid":
        return { text: s.outbid(lot.leaderNumber), tone: "warn" };
      default:
        return { text: lot.leaderNumber ? s.notBidding(lot.leaderNumber) : s.noBids, tone: "neutral" };
    }
  }
  const toneClass = { ok: "bg-shop-ok-soft text-shop-ok", warn: "bg-shop-warn-soft text-shop-warn", neutral: "bg-shop-sunken text-shop-ink-2" }[status.tone];
  const closed = lot.status !== "OPEN" || Date.parse(lot.closesAt) <= now;
  const closesLabel = formatShopDate(lot.closesAt, locale, CLOSE_OPTS, timeZone);
  const inputId = `${ids}-max`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;

  return (
    <>
      <section aria-label={tl.placeBid} className="flex flex-col gap-4 rounded-shop border border-shop-line-strong p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-shop-muted">
              {lot.currentBid === null ? tl.startingBid : tl.currentBid} · {lot.bidCount ? t.bids(lot.bidCount) : t.noBids}
            </span>
            <span className="text-[2rem] leading-tight font-bold tracking-[-0.02em] text-shop-ink tabular-nums">{money(price)}</span>
            {lot.reserveMet !== null ? (
              <span className={cn("text-sm", lot.reserveMet ? "text-shop-ok" : "text-shop-warn")}>{lot.reserveMet ? tl.reserveMet : tl.reserveNotMet}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-0.5 text-right">
            <span className="text-sm text-shop-muted">{closed ? tl.closedLabel : tl.closesIn}</span>
            {closed ? (
              <span className="font-shop-mono text-[1.75rem] leading-tight font-semibold text-shop-muted">00:00</span>
            ) : (
              <Countdown until={lot.closesAt} renderedAt={renderedAt} className="text-[1.75rem] leading-tight font-semibold" />
            )}
            <span className="text-xs text-shop-muted">{tl.closesAtNote(closesLabel, extendMin)}</span>
          </div>
        </div>

        {liveStatus === "polling" && !closed ? <p className="text-xs text-shop-warn">{t.live.polling}</p> : null}

        {extended && !closed ? (
          <p role="status" className="rounded-shop-sm bg-shop-accent-soft px-3 py-2 text-sm font-semibold text-shop-accent motion-safe:animate-pulse">
            {tl.extended(extendMin)}
          </p>
        ) : null}

        <div role="status" aria-live="polite" className={cn("rounded-shop-sm px-3 py-2.5 text-sm font-semibold", toneClass)}>
          {status.text}
          {status.link ? (
            <>
              {" "}
              <Link href={status.link.href} className="underline underline-offset-4">
                {status.link.label}
              </Link>
            </>
          ) : null}
        </div>

        {biddable ? renderControls() : null}

        <p className="text-xs leading-relaxed text-shop-muted">
          {biddable ? <>{tl.nextMinimum(money(minimum))} · </> : null}
          {tl.noPremium}{" "}
          <Link href={termsHref} className="underline underline-offset-4 hover:text-shop-ink">
            {tl.terms}
          </Link>
        </p>
      </section>

      <section aria-labelledby={`${ids}-history`} className="flex flex-col gap-1">
        <h2 id={`${ids}-history`} className="font-shop-body text-[0.95rem] font-semibold tracking-normal text-shop-ink">
          {tl.history}
        </h2>
        {history.length ? (
          <ol className="divide-y divide-shop-line border-b border-shop-line text-sm">
            {history.map((h, i) => {
              const mine = myNumber !== null && h.bidderNumber === myNumber;
              return (
                <li key={`${h.at}-${h.bidderNumber}-${h.amount}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 py-2">
                  <span className={cn("truncate", mine ? "font-semibold text-shop-primary" : "text-shop-ink")}>
                    {mine ? tl.you(h.bidderNumber) : t.bidder(h.bidderNumber)}
                    {h.isAuto ? <span className="text-shop-muted"> ({tl.auto})</span> : null}
                  </span>
                  <time dateTime={h.at} className="font-shop-mono text-xs text-shop-muted tabular-nums">
                    {formatShopDate(h.at, locale, TIME_OPTS, timeZone)}
                  </time>
                  <span className="text-right font-semibold tabular-nums">{money(h.amount)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-2 text-sm text-shop-muted">{tl.historyEmpty}</p>
        )}
        <p className="text-xs text-shop-muted">{tl.historyNote}</p>
      </section>

      {biddable ? renderPhoneBar() : null}

      <Modal open={dialog?.kind === "terms"} onClose={() => !busy && setDialog(null)} labelledBy={`${ids}-terms`}>
        <h2 id={`${ids}-terms`} className="text-xl text-shop-ink">
          {tl.termsTitle}
        </h2>
        <p className="text-sm text-shop-ink-2">{tl.termsBody}</p>
        <Link href={termsHref} target="_blank" className="text-sm font-semibold text-shop-primary underline underline-offset-4">
          {tl.termsRead}
        </Link>
        <label className="flex items-start gap-3 text-sm text-shop-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-[var(--shop-primary)]"
            checked={termsChecked}
            onChange={(e) => {
              setTermsChecked(e.target.checked);
              setTermsError(false);
            }}
            aria-invalid={termsError || undefined}
          />
          <span>{tl.termsCheck}</span>
        </label>
        {termsError ? (
          <p role="alert" className="text-sm text-shop-crit">
            {tl.termsRequired}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
            {tl.cancel}
          </Button>
          <Button onClick={acceptTerms} pending={busy}>
            {busy ? tl.placing : tl.termsAccept}
          </Button>
        </div>
      </Modal>

      <Modal open={dialog?.kind === "confirm"} onClose={() => !busy && setDialog(null)} labelledBy={`${ids}-confirm`}>
        <h2 id={`${ids}-confirm`} className="text-xl text-shop-ink">
          {tl.confirmTitle}
        </h2>
        <p className="text-base font-semibold text-shop-ink">{dialog ? tl.confirmBody(money(dialog.amount)) : null}</p>
        <p className="text-sm text-shop-muted">{tl.confirmNote}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
            {tl.cancel}
          </Button>
          <Button
            pending={busy}
            onClick={() => {
              const amount = dialog?.amount;
              setDialog(null);
              if (amount) place(amount);
            }}
          >
            {tl.confirm}
          </Button>
        </div>
      </Modal>
    </>
  );

  // Plain render helpers (not components): the input must keep its identity across renders.
  function renderControls() {
    if (viewer.kind === "guest") {
      return (
        <div className="flex flex-col gap-3 rounded-shop-sm bg-shop-sunken p-4">
          <div>
            <p className="font-semibold text-shop-ink">{tl.loginTitle}</p>
            <p className="mt-1 text-sm text-shop-muted">{tl.loginBody}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={viewer.loginHref} rel="nofollow">
              {tl.login}
            </ButtonLink>
            <ButtonLink href={viewer.registerHref} rel="nofollow" variant="outline">
              {tl.register}
            </ButtonLink>
          </div>
        </div>
      );
    }
    if (viewer.kind === "staff") return <p className="rounded-shop-sm bg-shop-sunken px-3 py-2.5 text-sm text-shop-ink-2">{tl.staff}</p>;
    if (viewer.kind === "unverified") {
      return (
        <p className="rounded-shop-sm bg-shop-warn-soft px-3 py-2.5 text-sm text-shop-warn">
          {tl.notVerified}{" "}
          <Link href={viewer.verifyHref} className="font-semibold underline underline-offset-4">
            {tl.verifyLink}
          </Link>
        </p>
      );
    }
    return (
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) start(parseMoneyInput(input, currency));
        }}
      >
        <label htmlFor={inputId} className="text-sm text-shop-ink-2">
          {tl.maxBidLabel}
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id={inputId}
            name="maxAmount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="send"
            value={input}
            placeholder={formatMoneyInput(quick[0], locale, currency)}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
            aria-invalid={error ? true : undefined}
            className="h-12 min-w-0 flex-1 rounded-shop-control border border-shop-ink bg-shop-surface px-4 text-lg font-semibold text-shop-ink tabular-nums placeholder:font-normal placeholder:text-shop-muted focus:outline-2 focus:outline-offset-2 focus:outline-shop-primary"
          />
          {/* Fixed label (no width jump on phones); the busy state is aria-busy + disabled, announced below. */}
          <Button type="submit" size="lg" className="h-12 shrink-0 px-5" pending={busy}>
            {tl.placeBid}
          </Button>
        </div>
        <span id={hintId} className="sr-only">
          {tl.maxBidHint(money(minimum))}
        </span>
        <span role="status" className="sr-only">
          {busy ? tl.placing : ""}
        </span>
        {ageConfirm ? (
          <label className="flex items-start gap-3 text-sm text-shop-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-[var(--shop-primary)]"
              checked={ageOk}
              onChange={(e) => {
                setAgeOk(e.target.checked);
                setError(null);
              }}
            />
            <span>{tl.ageConfirm(ageConfirm)}</span>
          </label>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-sm font-medium text-shop-crit">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm font-medium text-shop-ok">
            {notice}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {quick.map((amount) => (
            <Button key={amount} variant="outline" size="sm" disabled={busy} onClick={() => start(amount)}>
              {tl.quickBid(money(amount))}
            </Button>
          ))}
        </div>
      </form>
    );
  }

  /** Phones: the bid action stays reachable while scrolling photos and history (design "Phone"). */
  function renderPhoneBar() {
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-shop-line bg-shop-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-shop-pop lg:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-lg leading-tight font-bold tabular-nums">{money(price)}</span>
            <Countdown until={lot.closesAt} renderedAt={renderedAt} className="text-sm text-shop-muted" />
          </div>
          {viewer.kind === "customer" ? (
            <Button className="ml-auto h-12 min-w-0" pending={busy} onClick={() => start(quick[0])}>
              {tl.quickBid(money(quick[0]))}
            </Button>
          ) : viewer.kind === "guest" ? (
            <ButtonLink href={viewer.loginHref} rel="nofollow" className="ml-auto h-12">
              {tl.loginTitle}
            </ButtonLink>
          ) : null}
        </div>
        {viewer.kind === "customer" ? (
          <div className="mx-auto mt-1 flex max-w-xl justify-end">
            <button
              type="button"
              className="py-1 text-sm text-shop-ink-2 underline underline-offset-4"
              onClick={() => {
                inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                inputRef.current?.focus({ preventScroll: true });
              }}
            >
              {tl.setMaximum}
            </button>
          </div>
        ) : null}
      </div>
    );
  }
}
