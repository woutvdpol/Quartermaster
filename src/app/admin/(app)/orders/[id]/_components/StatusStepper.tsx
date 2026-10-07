import { cx } from "@/components/admin/ui";
import type { OrderStep } from "../../_lib/labels";

/** Design A order stepper: Placed → Paid → Packing → Shipped → Delivered. */
export function StatusStepper({ steps, label, stoppedLabel }: { steps: OrderStep[]; label: string; stoppedLabel?: string }) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-y-2">
      {steps.map((step, i) => (
        <li
          key={step.label}
          aria-current={step.state === "now" ? "step" : undefined}
          className={cx(
            "flex items-center gap-2 text-[13px]",
            step.state === "todo" ? "text-muted" : "text-ink",
            step.state === "now" && "font-semibold",
          )}
        >
          {i > 0 && <span aria-hidden="true" className="mx-2.5 h-[1.5px] w-6 bg-line md:w-10" />}
          <span
            aria-hidden="true"
            className={cx(
              "grid size-[22px] place-items-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold",
              step.state === "done" && "border-ok bg-ok-soft text-ok",
              step.state === "now" && "border-accent text-accent",
              step.state === "todo" && "border-line",
            )}
          >
            {step.state === "done" ? "✓" : i + 1}
          </span>
          {step.label}
          <span className="sr-only">{step.state === "done" ? " (done)" : step.state === "now" ? " (current)" : ""}</span>
        </li>
      ))}
      {stoppedLabel && <li className="ml-3 text-[13px] font-semibold text-crit">{stoppedLabel}</li>}
    </ol>
  );
}
