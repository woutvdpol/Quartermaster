import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n";
import "./globals.css";

const t = getDictionary();

export const metadata: Metadata = {
  title: { template: "%s · Quartermaster", default: t.app.name },
  description: t.app.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
