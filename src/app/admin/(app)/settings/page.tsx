import { redirect } from "next/navigation";

/** /admin/settings opens the first group. */
export default function SettingsIndexPage() {
  redirect("/admin/settings/general");
}
