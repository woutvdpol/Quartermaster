"use client";

import { cx } from "@/components/admin/ui";

/**
 * Isolated preview of the server-sanitized campaign HTML. `sandbox=""` disables scripts, forms,
 * navigation and same-origin access, so neither markup nor styles can reach the admin page. It is
 * a mail canvas, deliberately rendered with the browser's light system colors, not the admin theme.
 */
export function PreviewFrame({
  html,
  title,
  className,
}: {
  html: string;
  title: string;
  className?: string;
}) {
  const doc =
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    "<style>:root{color-scheme:light}body{margin:20px;background:Canvas;color:CanvasText;" +
    "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5}" +
    "img{max-width:100%;height:auto}</style></head><body>" +
    html +
    "</body></html>";
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={doc}
      referrerPolicy="no-referrer"
      className={cx(
        "block h-[560px] w-full rounded-control border border-line bg-panel",
        className,
      )}
    />
  );
}
