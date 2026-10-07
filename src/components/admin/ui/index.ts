/*
 * Quartermaster admin UI kit. Import from "@/components/admin/ui".
 * See ./README.md for usage and the kitchen sink at /admin/dev/ui (development only).
 */

// Helpers (plain modules: usable in server actions, server and client components)
export { cx } from "./cx";
export { controlClass, labelClass, hintClass, errorClass, groupClass, thClass, tdClass } from "./styles";
export {
  actionOk,
  actionFail,
  fieldError,
  zodFieldErrors,
  formString,
  type ActionResult,
  type ActionState,
  type FieldErrors,
} from "./form";
export {
  formatMoney,
  formatMoneyInput,
  parseMoney,
  currencyDigits,
  currencySymbol,
  DEFAULT_CURRENCY,
  DEFAULT_FORMAT_LOCALE,
} from "./money-utils";
export { formatDate, formatRelative, toDate, DEFAULT_TIME_ZONE, type DateFormat } from "./date-utils";
export {
  hrefWith,
  getParam,
  parsePage,
  parseSort,
  type SearchParamsRecord,
  type SearchParamsInput,
  type SortState,
} from "./url";

// Form controls
export { Field, type FieldProps, type FieldControlProps, type FieldBaseProps } from "./Field";
export {
  TextInput,
  NumberInput,
  DateInput,
  Textarea,
  Select,
  Checkbox,
  Switch,
  RadioGroup,
  SegmentedControl,
  type TextInputProps,
  type NumberInputProps,
  type DateInputProps,
  type TextareaProps,
  type SelectProps,
  type SelectOption,
  type SelectOptionGroup,
  type SwitchProps,
  type ChoiceOption,
} from "./inputs";
export { MoneyInput, type MoneyInputProps } from "./MoneyInput";
export { TagInput, type TagInputProps } from "./TagInput";
export { FormActions } from "./FormActions";
export { SubmitButton, type SubmitButtonProps } from "./SubmitButton";
export { useActionForm } from "./use-action-form";

// Lists
export { DataTable, DataTableSkeleton, type Column, type DataTableProps } from "./DataTable";
export { SelectionProvider, useSelection, RowCheckbox, SelectAllCheckbox, BulkActionBar } from "./selection";
export { SortLink, ariaSort, type SortConfig } from "./SortLink";
export { Pagination } from "./Pagination";
export { ViewTabs, type ViewTab } from "./ViewTabs";
export { FilterBar, FilterChip, ClearFiltersLink } from "./Filters";
export { FilterSelect } from "./FilterSelect";
export { SearchInput } from "./SearchInput";

// Feedback
export { toast, type ToastOptions, type ToastTone } from "./toast-store";
export { Toaster, ActionToast } from "./Toaster";
export { InlineAlert, ActionMessage, type AlertTone } from "./InlineAlert";
export { EmptyState } from "./EmptyState";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { Drawer, type DrawerProps } from "./Drawer";
export { Tabs, type TabItem } from "./Tabs";
export { Tooltip } from "./Tooltip";
export { Skeleton, SkeletonText } from "./Skeleton";
export { Spinner } from "./Spinner";

// Display
export { Money } from "./Money";
export { DateTime } from "./DateTime";
export {
  ProductStatusPill,
  PaymentStatusPill,
  FulfillmentStatusPill,
  PRODUCT_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  FULFILLMENT_STATUS_TONE,
  productStatusLabel,
  paymentStatusLabel,
  fulfillmentStatusLabel,
} from "./StatusPills";
export { Thumb, type ThumbSize } from "./Thumb";
export { KeyValue, type KeyValueItem } from "./KeyValue";
export { Timeline, type TimelineItem } from "./Timeline";

// Media
export { Dropzone, type DropzoneItem, type DropzoneProps } from "./Dropzone";

// Existing admin primitives, re-exported for one-stop imports
export { Button, buttonClasses, type ButtonProps, type ButtonVariant, type ButtonSize } from "../Button";
export { Card } from "../Card";
export { KpiCard } from "../KpiCard";
export { PageHeader } from "../PageHeader";
export { StatusPill, WipBadge, type StatusTone } from "../StatusPill";
