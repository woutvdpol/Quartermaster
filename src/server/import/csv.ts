/**
 * RFC 4180 CSV reader. Pure, no dependencies.
 *
 * Handles: quoted fields with embedded delimiters, quotes ("") and newlines; CRLF / LF / CR line
 * endings; a UTF-8 byte order mark; delimiter detection (`,` `;` or tab — Excel in NL/DE saves with `;`);
 * lenient on a stray quote inside an unquoted field (kept literally, like Excel). Blank lines are skipped.
 *
 * Why our own instead of a package: the importer needs ~120 lines of well-tested code, and a CSV parser
 * runs on untrusted uploads, so fewer dependencies means less supply-chain surface. Hard limits keep a
 * malicious file from exhausting memory (rows, columns, field size).
 */

export type CsvDelimiter = "," | ";" | "\t";

export type CsvRecord = {
  /** 1-based record number as a spreadsheet shows it (header = 1, first data row = 2). */
  row: number;
  cells: string[];
};

export type CsvTable = {
  delimiter: CsvDelimiter;
  headers: string[];
  records: CsvRecord[];
};

export type CsvLimits = { maxRows: number; maxColumns: number; maxFieldLength: number };

export const DEFAULT_CSV_LIMITS: CsvLimits = { maxRows: 100_000, maxColumns: 500, maxFieldLength: 1_000_000 };

export class CsvError extends Error {
  constructor(
    message: string,
    public readonly row?: number,
  ) {
    super(row ? `Row ${row}: ${message}` : message);
  }
}

/**
 * Decodes uploaded bytes: UTF-8 (BOM stripped); when the bytes are not valid UTF-8, falls back to
 * Windows-1252 (old Excel "CSV" exports on Windows).
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Guesses the delimiter from the header line: the candidate that occurs most often outside quotes. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length && i < 64_000; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
}

/** Splits CSV text into raw rows (arrays of cells). Exported for tests; use parseCsv. */
export function parseCsvRows(text: string, delimiter: CsvDelimiter, limits: CsvLimits = DEFAULT_CSV_LIMITS): { line: number; cells: string[] }[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false; // inside a quoted field
  let wasQuoted = false; // current field started with a quote
  let fieldStarted = false;
  let recordNo = 1;

  const pushField = () => {
    if (field.length > limits.maxFieldLength) throw new CsvError(`a field is longer than ${limits.maxFieldLength} characters`, recordNo);
    cells.push(field);
    if (cells.length > limits.maxColumns) throw new CsvError(`more than ${limits.maxColumns} columns`, recordNo);
    field = "";
    wasQuoted = false;
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    // Skip blank lines (a single empty unquoted cell).
    if (!(cells.length === 1 && cells[0] === "")) {
      rows.push({ line: recordNo, cells });
      if (rows.length > limits.maxRows + 1) throw new CsvError(`more than ${limits.maxRows} rows`);
      recordNo++;
    }
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
        if (field.length > limits.maxFieldLength) throw new CsvError(`a field is longer than ${limits.maxFieldLength} characters`, recordNo);
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      wasQuoted = true;
      fieldStarted = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      pushRow();
      continue;
    }
    // Text after a closing quote ("abc"def) or a stray quote: keep literally.
    if (wasQuoted && !quoted && ch !== " ") field += ch;
    else if (!wasQuoted) field += ch;
    fieldStarted = true;
  }
  if (quoted) throw new CsvError("a quoted field is not closed", recordNo);
  if (field !== "" || cells.length > 0 || fieldStarted) pushRow();
  return rows;
}

/**
 * Parses a CSV document with a header row. Header names are trimmed. Data rows are padded / cut to
 * the header length (extra trailing empty cells are common in spreadsheet exports).
 */
export function parseCsv(text: string, opts: { delimiter?: CsvDelimiter; limits?: Partial<CsvLimits> } = {}): CsvTable {
  const limits = { ...DEFAULT_CSV_LIMITS, ...opts.limits };
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const rows = parseCsvRows(text, delimiter, limits);
  if (rows.length === 0) throw new CsvError("the file is empty");
  const headers = rows[0].cells.map((h) => h.trim());
  if (headers.every((h) => !h)) throw new CsvError("the header row is empty");
  const records = rows.slice(1).map(({ line, cells }) => {
    const out = cells.slice(0, headers.length);
    while (out.length < headers.length) out.push("");
    return { row: line, cells: out };
  });
  return { delimiter, headers, records };
}

/** Normalised header key: lower case, single spaces, trimmed ("Regular price " → "regular price"). */
export function headerKey(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Column accessor by (normalised) header name; first match wins, aliases allowed. */
export function columnIndex(headers: string[]): (...names: string[]) => number {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = headerKey(h);
    if (!map.has(k)) map.set(k, i);
  });
  return (...names) => {
    for (const n of names) {
      const i = map.get(headerKey(n));
      if (i !== undefined) return i;
    }
    return -1;
  };
}
