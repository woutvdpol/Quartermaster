// Shop translations CLI (docs/i18n.md § Vertalen).
//
//   npm run translations -- queue <tenant-slug>|--all [--include-sold] [--now]
//        Queues every translatable text (existing stock, categories, facets, pages, menus) for the
//        shop languages of the tenant (settings.i18n.locales) — the same as Settings → Languages →
//        "Translate existing stock". --all: every tenant with shop languages. The worker then translates
//        them (job translations.translate); --now translates right here instead (needs EMBEDDER_URL).
//   npm run translations -- translate <tenant-slug>   work through the QUEUED rows now (in-process)
//   npm run translations -- status <tenant-slug>      counts per language and status
//
// Nothing goes online: translations wait in the review list (Admin → Translations) until approved.
import "../src/server/jobs/node-runtime";

async function main() {
  await import("dotenv/config");
  const args = process.argv.slice(2);
  const [cmd, target] = args.filter((x) => !x.startsWith("--") || x === "--all");
  const { db } = await import("../src/server/db");
  const { syncTenant, enabledLocales, kickTranslate } = await import("../src/server/translations/sync");
  const { processQueue } = await import("../src/server/translations/machine");

  const tenants = async () => {
    if (target === "--all") {
      const all = await db.tenant.findMany({ select: { id: true, slug: true } });
      const out = [];
      for (const t of all) if ((await enabledLocales(t.id)).length) out.push(t);
      return out;
    }
    const t = target ? await db.tenant.findUnique({ where: { slug: target }, select: { id: true, slug: true } }) : null;
    if (!t) throw new Error(`Unknown tenant slug: ${target ?? "(none)"}`);
    return [t];
  };

  const translateNow = async (t: { id: string; slug: string }) => {
    for (;;) {
      const started = performance.now();
      const res = await processQueue(t.id, { sliceMs: 60_000 });
      console.log(`${t.slug}: ${res.translated} translated in ${Math.round(performance.now() - started)} ms, ${res.remaining} remaining${res.skipped ? ` (${res.skipped})` : ""}${res.missingTokens ? `, ${res.missingTokens} placeholders lost` : ""}`);
      if (!res.remaining || res.skipped || !res.translated) break;
    }
  };

  try {
    if (cmd === "queue") {
      for (const t of await tenants()) {
        const locales = await enabledLocales(t.id);
        if (!locales.length) {
          console.warn(`${t.slug}: no shop languages enabled (Settings → Languages); skipped.`);
          continue;
        }
        const counts = await syncTenant(t.id, args.includes("--include-sold") ? "all" : "stock");
        console.log(`${t.slug} [${locales.join(", ")}]:`, counts);
        if (args.includes("--now")) await translateNow(t);
        else await kickTranslate(t.id, 0);
      }
    } else if (cmd === "translate") {
      for (const t of await tenants()) await translateNow(t);
    } else if (cmd === "status") {
      for (const t of await tenants()) {
        const rows = await db.translation.groupBy({ by: ["locale", "status", "stale"], where: { tenantId: t.id }, _count: { _all: true } });
        console.log(`${t.slug} [${(await enabledLocales(t.id)).join(", ") || "no shop languages"}]`);
        for (const r of rows.sort((a, b) => `${a.locale}${a.status}`.localeCompare(`${b.locale}${b.status}`))) {
          console.log(`  ${r.locale}  ${r.status.padEnd(8)}${r.stale ? " (stale)" : "        "}  ${r._count._all}`);
        }
      }
    } else {
      console.log("Usage: npm run translations -- queue <tenant-slug>|--all [--include-sold] [--now] | translate <tenant-slug> | status <tenant-slug>");
      process.exitCode = 1;
    }
  } finally {
    await db.$disconnect();
    const { stopBoss } = await import("../src/server/jobs/boss").catch(() => ({ stopBoss: undefined }));
    await stopBoss?.().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
