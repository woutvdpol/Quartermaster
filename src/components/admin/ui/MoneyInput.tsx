"use client";

import { useState, type InputHTMLAttributes } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { Field, type FieldBaseProps } from "./Field";
import {
  currencyDigits,
  currencySymbol,
  DEFAULT_CURRENCY,
  DEFAULT_FORMAT_LOCALE,
  formatMoneyInput,
  parseMoney,
} from "./money-utils";
import { adornmentClass, groupClass, groupControlClass } from "./styles";

const t = getDictionary().ui.money;

export type MoneyInputProps = FieldBaseProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required" | "value" | "defaultValue" | "type" | "name" | "onChange"> & {
    /** Name of the hidden input that submits the amount as integer minor units ("" when empty). */
    name: string;
    /** Initial amount in minor units (cents). */
    defaultValue?: number | null;
    /** Controlled amount in minor units; pair with onValueChange. */
    value?: number | null;
    onValueChange?: (minor: number | null) => void;
    /** ISO currency (Tenant.currency). */
    currency?: string;
    /** Formatting locale for the display text. Parsing accepts both "12,50" and "12.50". */
    locale?: string;
    allowNegative?: boolean;
  };

/**
 * Amount input: shows the currency symbol and a formatted number, submits integer minor units in a
 * hidden input named `name`. Typing accepts Dutch and English notation (1.234,56 / 1,234.56).
 */
export function MoneyInput({
  name,
  defaultValue = null,
  value,
  onValueChange,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_FORMAT_LOCALE,
  allowNegative = false,
  label,
  hint,
  error,
  required,
  showOptional,
  labelHidden,
  id,
  className,
  onBlur,
  placeholder,
  disabled,
  ...input
}: MoneyInputProps) {
  const digits = currencyDigits(currency);
  const format = (minor: number | null) => (minor === null ? "" : formatMoneyInput(minor, currency, locale));
  const controlled = value !== undefined;

  const [text, setText] = useState(() => format(controlled ? value : defaultValue));
  const [touchedInvalid, setTouchedInvalid] = useState(false);
  // Keep the text in sync when a controlled value changes from outside (adjust state during render).
  const [lastValue, setLastValue] = useState(value);
  if (controlled && value !== lastValue) {
    setLastValue(value);
    if (parseMoney(text, digits) !== value) setText(format(value));
  }

  const parsed = text.trim() === "" ? null : parseMoney(text, digits);
  const invalidText = text.trim() !== "" && parsed === null;
  const negative = !allowNegative && parsed !== null && parsed < 0;
  const localError = touchedInvalid && (invalidText || negative) ? (negative ? t.negative : t.invalid) : undefined;
  const minor = invalidText || negative ? null : parsed;

  return (
    <Field
      label={label}
      hint={hint}
      error={error ?? localError}
      required={required}
      showOptional={showOptional}
      labelHidden={labelHidden}
      id={id}
      className={className}
    >
      {(control) => (
        <span className={groupClass}>
          <span aria-hidden="true" className={cx(adornmentClass, "border-r border-line font-mono")}>
            {currencySymbol(currency, locale)}
          </span>
          <input
            {...input}
            {...control}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? format(0)}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setTouchedInvalid(false);
              const next = e.target.value.trim() === "" ? null : parseMoney(e.target.value, digits);
              if (e.target.value.trim() === "" || next !== null) onValueChange?.(next);
            }}
            onBlur={(e) => {
              if (minor !== null) setText(format(minor));
              else if (invalidText || negative) setTouchedInvalid(true);
              onBlur?.(e);
            }}
            className={cx(groupControlClass, "text-right font-mono tabular-nums")}
          />
          <input type="hidden" name={name} value={minor === null ? "" : String(minor)} disabled={disabled} />
        </span>
      )}
    </Field>
  );
}
