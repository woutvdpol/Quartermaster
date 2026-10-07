import { jsonLdString } from "./Breadcrumbs";

/** `<script type="application/ld+json">` with safe escaping. Server component. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
