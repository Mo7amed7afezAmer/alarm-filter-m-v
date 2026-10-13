import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractXlsx, unrarJsBackend, type ArchiveEntry, type RarBackend } from "./extract.js";
import { readFixture, REPORT_RAR } from "./test-fixtures.js";
import type { HourlyReportError } from "./validate.js";

const limits = { maxRarBytes: 25 << 20, maxExtractBytes: 100 << 20, maxEntries: 20 };

/** Backend whose listing / extraction are scripted. */
function fake(entries: ArchiveEntry[], write?: (dest: string) => Promise<void>): RarBackend {
  return {
    name: "fake",
    list: async () => entries,
    extractAll: async (_a, _p, dest) => (write ? write(dest) : undefined),
  };
}
const entry = (name: string, size = 10): ArchiveEntry => ({ name, size, directory: false });

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as HourlyReportError;
  }
  throw new Error("expected a rejection");
}

describe.skipIf(!REPORT_RAR)("extractXlsx on the real fixture", () => {
  it("returns exactly one xlsx and removes the temp dir", async () => {
    let dir = "";
    const out = await extractXlsx(readFixture(REPORT_RAR), {
      limits,
      backend: unrarJsBackend,
      onTempDir: (d) => (dir = d),
    });
    expect(out.fileName).toBe("NSN Update_Output.xlsx");
    expect(out.data.subarray(0, 2).toString()).toBe("PK"); // xlsx = zip
    expect(out.data.length).toBe(560_680);
    expect(dir).not.toBe("");
    expect(existsSync(dir)).toBe(false);
  });

  it("enforces the extracted-size limit from the headers before extracting", async () => {
    const e = await errorOf(
      extractXlsx(readFixture(REPORT_RAR), {
        limits: { ...limits, maxExtractBytes: 100_000 },
        backend: unrarJsBackend,
      }),
    );
    expect(e.code).toBe("EXTRACT_TOO_LARGE");
  });
});

describe("extractXlsx safety checks", () => {
  const archive = Buffer.from("Rar!\u001a\u0007\u0001\u0000");

  it("rejects a path-traversal entry before anything is extracted", async () => {
    let extracted = false;
    const e = await errorOf(
      extractXlsx(archive, {
        limits,
        backend: fake([entry("../evil.xlsx")], async () => void (extracted = true)),
      }),
    );
    expect(e.code).toBe("UNSAFE_PATH");
    expect(extracted).toBe(false);
  });

  it("rejects archives with too many entries / no xlsx / several xlsx", async () => {
    const many = Array.from({ length: 21 }, (_, i) => entry(`f${i}.txt`));
    expect((await errorOf(extractXlsx(archive, { limits, backend: fake(many) }))).code).toBe(
      "TOO_MANY_ENTRIES",
    );
    expect((await errorOf(extractXlsx(archive, { limits, backend: fake([entry("a.txt")]) }))).code).toBe(
      "NO_XLSX",
    );
    expect(
      (await errorOf(extractXlsx(archive, { limits, backend: fake([entry("a.xlsx"), entry("b.xlsx")]) })))
        .code,
    ).toBe("MULTIPLE_XLSX");
  });

  it("removes the temp dir when extraction fails", async () => {
    let dir = "";
    const e = await errorOf(
      extractXlsx(archive, {
        limits,
        backend: fake([entry("r.xlsx")], async (dest) => {
          await writeFile(path.join(dest, "partial.bin"), "x");
          throw new Error("boom");
        }),
        onTempDir: (d) => (dir = d),
      }),
    );
    expect(e.message).toBe("boom");
    expect(dir).not.toBe("");
    expect(existsSync(dir)).toBe(false);
  });

  it("post-checks what actually landed on disk (lying headers)", async () => {
    let dir = "";
    const e = await errorOf(
      extractXlsx(archive, {
        limits,
        // headers claim one small xlsx, extraction produces two
        backend: fake([entry("r.xlsx")], async (dest) => {
          await writeFile(path.join(dest, "a.xlsx"), "x");
          await writeFile(path.join(dest, "b.xlsx"), "y");
        }),
        onTempDir: (d) => (dir = d),
      }),
    );
    expect(e.code).toBe("MULTIPLE_XLSX");
    expect(existsSync(dir)).toBe(false);
  });
});
