import { pushUiCopy } from "./_copy";

/** iPhone/iPad Safari: push needs the home-screen app first (iOS 16.4+). */
export function IosInstallSteps() {
  const t = pushUiCopy.ios;
  return (
    <div className="rounded-shop bg-shop-sunken px-4 py-3 text-sm" role="note">
      <p className="font-semibold">{t.title}</p>
      <p className="mt-1 text-shop-ink-2">{t.intro}</p>
      <ol className="mt-2 grid list-decimal gap-1 pl-5 text-shop-ink-2">
        {t.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
