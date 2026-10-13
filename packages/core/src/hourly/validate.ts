// Checks on the downloaded attachment BEFORE anything touches it (§14).

/** RAR signature (RAR4 and RAR5 share the first 6 bytes). */
export const RAR_MAGIC = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);

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
