import { describe, expect, it } from "vitest";
import { CsvError, decodeCsvBytes, detectDelimiter, parseCsv, parseCsvRows } from "@/server/import/csv";

describe("parseCsvRows (RFC 4180)", () => {
  it("handles quotes, escaped quotes, delimiters and newlines inside fields", () => {
    const text = 'a,b,c\n1,"x, y","say ""hi"""\n2,"line1\nline2",z\n';
    expect(parseCsvRows(text, ",").map((r) => r.cells)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "line1\nline2", "z"],
    ]);
  });

  it("supports CRLF, CR and a missing final newline", () => {
    expect(parseCsvRows("a,b\r\n1,2\r3,4", ",").map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps CRLF inside quoted fields and numbers records, not lines", () => {
    const rows = parseCsvRows('h1,h2\r\n"multi\r\nline",x\r\nnext,y\r\n', ",");
    expect(rows[1]).toEqual({ line: 2, cells: ["multi\r\nline", "x"] });
    expect(rows[2]).toEqual({ line: 3, cells: ["next", "y"] });
  });

  it("skips blank lines and keeps empty fields", () => {
    expect(parseCsvRows("a,b\n\n,\n\"\",x\n", ",").map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["", ""],
      ["", "x"],
    ]);
  });

  it("is lenient with stray quotes in unquoted fields", () => {
    expect(parseCsvRows('a,b\n12" barrel,ok\n', ",")[1].cells).toEqual(['12" barrel', "ok"]);
  });

  it("throws on an unclosed quoted field", () => {
    expect(() => parseCsvRows('a,b\n"open,1\n', ",")).toThrow(CsvError);
  });

  it("enforces row / column / field limits", () => {
    expect(() => parseCsvRows("a\n1\n2\n3\n", ",", { maxRows: 2, maxColumns: 10, maxFieldLength: 100 })).toThrow(/rows/);
    expect(() => parseCsvRows("a,b,c\n", ",", { maxRows: 10, maxColumns: 2, maxFieldLength: 100 })).toThrow(/columns/);
    expect(() => parseCsvRows(`"${"x".repeat(50)}"\n`, ",", { maxRows: 10, maxColumns: 2, maxFieldLength: 10 })).toThrow(/longer/);
  });
});

describe("parseCsv", () => {
  it("strips a BOM, detects ';' and pads short rows", () => {
    const t = parseCsv("﻿Name;Price;Tags\nHelmet;12,50\n");
    expect(t.delimiter).toBe(";");
    expect(t.headers).toEqual(["Name", "Price", "Tags"]);
    expect(t.records).toEqual([{ row: 2, cells: ["Helmet", "12,50", ""] }]);
  });

  it("detects tabs and ignores delimiters inside quoted headers", () => {
    expect(detectDelimiter("a\tb\tc\n")).toBe("\t");
    expect(detectDelimiter('"x;y;z",b,c\n')).toBe(",");
  });

  it("rejects an empty file", () => {
    expect(() => parseCsv("")).toThrow(/empty/);
  });
});

describe("decodeCsvBytes", () => {
  it("decodes UTF-8 (BOM stripped) and falls back to Windows-1252", () => {
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xc3, 0xa9]))).toBe("Aé");
    expect(decodeCsvBytes(new Uint8Array([0x4d, 0xfc, 0x74, 0x7a, 0x65, 0x80]))).toBe("Mütze€");
  });
});
