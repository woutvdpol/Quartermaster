import type { Metadata } from "next";
import { ThemeBuilderSection } from "./_components/ThemeBuilderSection";

export const metadata: Metadata = { title: "Theme" };

/** Website → Theme: preset + tuning, draft with live preview, publish. Design: docs/design/onboarding/Main.dc.html. */
export default function ThemePage() {
  return <ThemeBuilderSection variant="page" />;
}
