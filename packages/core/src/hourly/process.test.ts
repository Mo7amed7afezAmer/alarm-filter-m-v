import { describe, expect, it } from "vitest";
import { extractXlsx, unrarJsBackend } from "./extract.js";
import { processReport } from "./index.js";
import { readFixture, REPORT_RAR } from "./test-fixtures.js";
import { HourlyReportError, validateXlsx, ZIP_MAGIC, zipUncompressedSize } from "./validate.js";

const limits = { maxRarBytes: 25 * 1048576, maxExtractBytes: 100 * 1048576, maxEntries: 20 };
const base = { sites: [], normalizations: [], limits, backend: unrarJsBackend };
const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e as HourlyReportError).code,
  );

describe.skipIf(!REPORT_RAR)("processReport: .rar or plain .xlsx attachment", () => {
  it("gives the same rows for the RAR and for the .xlsx inside it", async () => {
    const rar = readFixture(REPORT_RAR);
    const { data: xlsx } = await extractXlsx(rar, { limits, backend: unrarJsBackend });
    const a = await processReport({ ...base, fileName: "NSN Update_Output.rar", data: rar });
    const b = await processReport({ ...base, fileName: "NSN Update_Output.xlsx", data: xlsx });
    expect(b.meta.rowCount).toBe(a.meta.rowCount);
    expect(b.meta.sheets).toEqual(a.meta.sheets);
    expect(b.rows).toEqual(a.rows);
    expect(zipUncompressedSize(xlsx)).toBeGreaterThan(xlsx.length);
  });

  it("checks the declared uncompressed size of the .xlsx", async () => {
    const rar = readFixture(REPORT_RAR);
    const { data: xlsx } = await extractXlsx(rar, { limits, backend: unrarJsBackend });
    const tiny = { ...limits, maxExtractBytes: 1024 };
    expect(() => validateXlsx("r.xlsx", xlsx, tiny)).toThrow(/expands to/);
  });
});

describe("plain .xlsx validation", () => {
  it("rejects other extensions, a non-ZIP body and a corrupt ZIP", async () => {
    const zipJunk = Buffer.concat([ZIP_MAGIC, Buffer.alloc(64)]);
    expect(await code(processReport({ ...base, fileName: "r.pdf", data: zipJunk }))).toBe("BAD_EXTENSION");
    expect(await code(processReport({ ...base, fileName: "r.xlsx", data: Buffer.from("Rar!\u001a\u0007") }))).toBe(
      "BAD_SIGNATURE",
    );
    expect(await code(processReport({ ...base, fileName: "r.xlsx", data: zipJunk }))).toBe("BAD_WORKBOOK");
  });

  it("rejects an oversized .xlsx", () => {
    const big = Buffer.concat([ZIP_MAGIC, Buffer.alloc(2000)]);
    expect(() => validateXlsx("r.xlsx", big, { ...limits, maxRarBytes: 1024 })).toThrow(HourlyReportError);
  });
});
