// Checks on the downloaded attachment BEFORE anything touches it (§14).

/** RAR signature (RAR4 and RAR5 share the first 6 bytes). */
export const RAR_MAGIC = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);

/** ZIP local-file signature — an .xlsx is a ZIP package. */
export const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface HourlyLimits {
  /** Max attachment size, bytes. */
  maxRarBytes: number;
  /** Max total extracted size, bytes. */
  maxExtractBytes: number;
  /** Max entries in the archive. */
  maxEntries: number;
}

const mb = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return (Number.isFinite(v) && v > 0 ? v : fallback) * 1024 * 1024;
};

/** Limits from env: HOURLY_MAX_RAR_MB (25), HOURLY_MAX_EXTRACT_MB (100); 20 entries. */
export function limitsFromEnv(): HourlyLimits {
  return {
    maxRarBytes: mb("HOURLY_MAX_RAR_MB", 25),
    maxExtractBytes: mb("HOURLY_MAX_EXTRACT_MB", 100),
    maxEntries: 20,
  };
}

export type HourlyErrorCode =
  | "BAD_EXTENSION"
  | "BAD_SIGNATURE"
  | "TOO_LARGE"
  | "TOO_MANY_ENTRIES"
  | "UNSAFE_PATH"
  | "EXTRACT_TOO_LARGE"
  | "NO_XLSX"
  | "MULTIPLE_XLSX"
  | "EXTRACT_FAILED"
  | "BAD_WORKBOOK";

export type AttachmentKind = "rar" | "xlsx";

/** A report that cannot be processed — safe to show to the user. */
export class HourlyReportError extends Error {
  constructor(
    public code: HourlyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HourlyReportError";
  }
}

/** Extension .rar, RAR magic bytes, size limit. Throws HourlyReportError. */
export function validateRar(fileName: string, data: Buffer, limits: HourlyLimits): void {
  if (!/\.rar$/i.test(fileName))
    throw new HourlyReportError("BAD_EXTENSION", `Not a .rar attachment: ${fileName}`);
  if (data.length > limits.maxRarBytes)
    throw new HourlyReportError(
      "TOO_LARGE",
      `Attachment is ${(data.length / 1048576).toFixed(1)} MB (max ${limits.maxRarBytes / 1048576} MB)`,
    );
  if (data.length < RAR_MAGIC.length || !data.subarray(0, RAR_MAGIC.length).equals(RAR_MAGIC))
    throw new HourlyReportError("BAD_SIGNATURE", "File does not have a RAR signature");
}

/**
 * Plain .xlsx attachment (some senders skip the RAR): extension, ZIP signature, size limit,
 * and the declared uncompressed size from the ZIP central directory ≤ maxExtractBytes
 * (zip-bomb guard before exceljs inflates it).
 */
export function validateXlsx(fileName: string, data: Buffer, limits: HourlyLimits): void {
  if (!/\.xlsx$/i.test(fileName))
    throw new HourlyReportError("BAD_EXTENSION", `Not an .xlsx attachment: ${fileName}`);
  if (data.length > limits.maxRarBytes)
    throw new HourlyReportError(
      "TOO_LARGE",
      `Attachment is ${(data.length / 1048576).toFixed(1)} MB (max ${limits.maxRarBytes / 1048576} MB)`,
    );
  if (data.length < ZIP_MAGIC.length || !data.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC))
    throw new HourlyReportError("BAD_SIGNATURE", "File does not have an .xlsx (ZIP) signature");
  const total = zipUncompressedSize(data);
  if (total === null) throw new HourlyReportError("BAD_WORKBOOK", "Cannot read the .xlsx (corrupt ZIP)");
  if (total > limits.maxExtractBytes)
    throw new HourlyReportError(
      "EXTRACT_TOO_LARGE",
      `Workbook expands to ${(total / 1048576).toFixed(1)} MB (max ${limits.maxExtractBytes / 1048576} MB)`,
    );
}

/**
 * Sum of the uncompressed sizes declared in the ZIP central directory; null when the
 * directory cannot be read. ZIP64 markers (0xFFFFFFFF) count as "too large".
 */
export function zipUncompressedSize(data: Buffer): number | null {
  // End Of Central Directory: 22 bytes + up to 64 KB comment, scanned from the end.
  const min = Math.max(0, data.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = data.length - 22; i >= min; i--)
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > data.length || data.readUInt32LE(p) !== 0x02014b50) return null;
    const size = data.readUInt32LE(p + 24);
    if (size === 0xffffffff) return Number.POSITIVE_INFINITY;
    total += size;
    p += 46 + data.readUInt16LE(p + 28) + data.readUInt16LE(p + 30) + data.readUInt16LE(p + 32);
  }
  return total;
}

/** Which pipeline an attachment takes, by extension. Throws BAD_EXTENSION otherwise. */
export function attachmentKind(fileName: string): AttachmentKind {
  if (/\.rar$/i.test(fileName)) return "rar";
  if (/\.xlsx$/i.test(fileName)) return "xlsx";
  throw new HourlyReportError("BAD_EXTENSION", `Attachment must be .rar or .xlsx: ${fileName}`);
}

/**
 * Archive entry names must be plain relative paths: no "..", no absolute / drive paths,
 * no NUL. Throws on the first bad one.
 */
export function assertSafeEntryName(name: string): void {
  const n = name.replace(/\\/g, "/");
  if (
    !n ||
    n.includes("\0") ||
    n.startsWith("/") ||
    /^[A-Za-z]:/.test(n) ||
    n.split("/").some((seg) => seg === "..")
  )
    throw new HourlyReportError("UNSAFE_PATH", `Unsafe path in archive: ${JSON.stringify(name)}`);
}
