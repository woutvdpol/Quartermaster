"use client";

import { useEffect, useRef } from "react";

/**
 * Submits the surrounding GET form when a filter changes (progressive enhancement: without JavaScript
 * the form's own "Apply filters" button does it). Hides that button once hydrated.
 */
export function AutoSubmit({ buttonId }: { buttonId: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) return;
    const button = document.getElementById(buttonId);
    if (button) button.hidden = true;
    const onChange = () => form.requestSubmit();
    form.addEventListener("change", onChange);
    return () => {
      form.removeEventListener("change", onChange);
      if (button) button.hidden = false;
    };
  }, [buttonId]);
  return <span ref={marker} hidden />;
}
