/**
 * Validation report. Holds COUNTS AND IDS ONLY — never names, e-mail addresses, addresses or other
 * personal data (the report may be shared; the legacy dump may not).
 */

export type EntityStats = {
  legacy: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: Map<string, number>;
};

export type RevenueTotals = {
  legacyPaidOrders: number;
  legacyPaidTotal: number;
  legacyManualOrders: number;
  legacyManualTotal: number;
  newPaidOrders: number;
  newPaidTotal: number;
  newPaidSubtotal: number;
  currency: string;
};

export class EtlReport {
  readonly startedAt = new Date();
  finishedAt: Date | null = null;
  readonly entities = new Map<string, EntityStats>();
  readonly sections = new Map<string, string[]>();
  readonly warnings: string[] = [];
  readonly steps: { name: string; ms: number; status: "ok" | "failed" | "skipped"; note?: string }[] = [];
  revenue: RevenueTotals | null = null;
  meta: Record<string, string> = {};

  entity(name: string): EntityStats {
    let e = this.entities.get(name);
    if (!e) {
      e = { legacy: 0, created: 0, updated: 0, unchanged: 0, skipped: new Map() };
      this.entities.set(name, e);
    }
    return e;
  }

  legacy(name: string, count: number) {
    this.entity(name).legacy += count;
  }

  created(name: string, n = 1) {
    this.entity(name).created += n;
  }

  updated(name: string, n = 1) {
    this.entity(name).updated += n;
  }

  unchanged(name: string, n = 1) {
    this.entity(name).unchanged += n;
  }

  skip(name: string, reason: string, n = 1) {
    const e = this.entity(name);
    e.skipped.set(reason, (e.skipped.get(reason) ?? 0) + n);
  }

  /** Adds a line to a named section (e.g. "Orders with reconstructed prices"). */
  note(section: string, line: string) {
    let list = this.sections.get(section);
    if (!list) {
      list = [];
      this.sections.set(section, list);
    }
    list.push(line);
  }

  warn(message: string) {
    this.warnings.push(message);
  }

  toJSON() {
    return {
      meta: this.meta,
      entities: Object.fromEntries(
        [...this.entities].map(([k, v]) => [k, { ...v, skipped: Object.fromEntries(v.skipped) }]),
      ),
      revenue: this.revenue,
      warnings: this.warnings,
      sections: Object.fromEntries(this.sections),
      steps: this.steps,
    };
  }

  toMarkdown(): string {
    const out: string[] = [];
    const money = (minor: number) => (minor / 100).toFixed(2);
    out.push(`# ETL-rapport Concept500 → Quartermaster`, "");
    for (const [k, v] of Object.entries(this.meta)) out.push(`- **${k}:** ${v}`);
    out.push(`- **Gestart:** ${this.startedAt.toISOString()}`);
    if (this.finishedAt) out.push(`- **Klaar:** ${this.finishedAt.toISOString()} (${((this.finishedAt.getTime() - this.startedAt.getTime()) / 1000).toFixed(1)} s)`);
    out.push("", "> Alleen aantallen en id's — geen namen, e-mailadressen of adressen.", "");

    out.push("## Stappen", "", "| Stap | Status | Duur | Opmerking |", "|---|---|---|---|");
    for (const s of this.steps) out.push(`| ${s.name} | ${s.status} | ${(s.ms / 1000).toFixed(2)} s | ${s.note ?? ""} |`);

    out.push("", "## Aantallen per entiteit", "", "| Entiteit | Legacy | Nieuw | Bijgewerkt | Ongewijzigd | Overgeslagen | Redenen |", "|---|---:|---:|---:|---:|---:|---|");
    for (const [name, e] of this.entities) {
      const skipped = [...e.skipped.values()].reduce((a, b) => a + b, 0);
      const reasons = [...e.skipped].map(([r, n]) => `${r} (${n})`).join("; ");
      out.push(`| ${name} | ${e.legacy} | ${e.created} | ${e.updated} | ${e.unchanged} | ${skipped} | ${reasons} |`);
    }

    if (this.revenue) {
      const r = this.revenue;
      out.push(
        "",
        "## Omzet (betaalde orders, excl. refunds)",
        "",
        `| | Orders | Totaal (${r.currency}) |`,
        "|---|---:|---:|",
        `| Legacy \`payment_status = paid\` | ${r.legacyPaidOrders} | ${money(r.legacyPaidTotal)} |`,
        `| Legacy \`manual\` (onbetaalde overschrijving; ${r.legacyManualOrders} orders) | ${r.legacyManualOrders} | ${money(r.legacyManualTotal)} |`,
        `| Quartermaster \`PAID\` (total) | ${r.newPaidOrders} | ${money(r.newPaidTotal)} |`,
        `| Quartermaster \`PAID\` (subtotal = omzet in dashboard) | ${r.newPaidOrders} | ${money(r.newPaidSubtotal)} |`,
        "",
        r.legacyPaidTotal === r.newPaidTotal
          ? "✅ Betaalde omzet legacy = nieuw."
          : `⚠️ Verschil ${money(r.newPaidTotal - r.legacyPaidTotal)} — zie "Betaalstatus afgeleid" hieronder.`,
      );
    }

    for (const [title, lines] of this.sections) {
      out.push("", `## ${title}`, "");
      const max = 200;
      for (const l of lines.slice(0, max)) out.push(`- ${l}`);
      if (lines.length > max) out.push(`- … en nog ${lines.length - max}`);
    }

    out.push("", "## Waarschuwingen", "");
    if (!this.warnings.length) out.push("Geen.");
    for (const w of this.warnings) out.push(`- ${w}`);
    out.push("");
    return out.join("\n");
  }
}
