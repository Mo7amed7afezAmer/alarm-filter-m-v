import { describe, expect, it } from "vitest";
import { assertSafeEntryName, HourlyReportError, RAR_MAGIC, validateRar } from "./validate.js";

const limits = { maxRarBytes: 1024, maxExtractBytes: 4096, maxEntries: 20 };
const rar = (size = 64) => Buffer.concat([RAR_MAGIC, Buffer.from([0x01, 0x00]), Buffer.alloc(size)]);
const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as HourlyReportError).code;
  }
  return null;
};

describe("validateRar", () => {
  it("accepts a .rar with the RAR signature within the size limit", () => {
    expect(code(() => validateRar("NSN Update_Output.rar", rar(), limits))).toBeNull();
    expect(code(() => validateRar("REPORT.RAR", rar(), limits))).toBeNull();
  });

  it("rejects a wrong extension", () => {
    expect(code(() => validateRar("report.zip", rar(), limits))).toBe("BAD_EXTENSION");
    expect(code(() => validateRar("report.rar.exe", rar(), limits))).toBe("BAD_EXTENSION");
  });

  it("rejects a wrong magic number", () => {
    expect(code(() => validateRar("report.rar", Buffer.from("PK\u0003\u0004 zip data"), limits))).toBe(
      "BAD_SIGNATURE",
    );
    expect(code(() => validateRar("report.rar", Buffer.from([0x52, 0x61]), limits))).toBe("BAD_SIGNATURE");
  });

  it("rejects an oversized attachment", () => {
    expect(code(() => validateRar("report.rar", rar(2000), limits))).toBe("TOO_LARGE");
  });
});

describe("assertSafeEntryName", () => {
  it.each(["../evil.xlsx", "a/../../evil.xlsx", "..\\evil.xlsx", "/etc/passwd", "C:\\x.xlsx", "a\0b"])(
    "rejects %j",
    (name) => expect(code(() => assertSafeEntryName(name))).toBe("UNSAFE_PATH"),
  );
  it.each(["NSN Update_Output.xlsx", "dir/report.xlsx", "a..b.xlsx"])("accepts %j", (name) =>
    expect(code(() => assertSafeEntryName(name))).toBeNull(),
  );
});
