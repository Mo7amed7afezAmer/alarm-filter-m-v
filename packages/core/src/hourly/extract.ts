// RAR → the single .xlsx inside, in a per-request temp dir that is ALWAYS removed (§14).
// Never executes anything from the archive; files are only read back as bytes.
//
// 1. pre-check: entry headers listed with node-unrar-js (no data extracted) → count,
//    declared sizes, unsafe paths, exactly one .xlsx
// 2. extract: official `unrar x -o+` when installed (Docker image), else node-unrar-js (WASM,
//    same RarLab code — used on dev hosts without unrar)
// 3. post-check on disk: entries, total size, no symlinks, nothing outside the temp dir,
//    exactly one .xlsx

import { spawn } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeEntryName, HourlyReportError, type HourlyLimits } from "./validate.js";

export interface ArchiveEntry {
  name: string;
  size: number;
  directory: boolean;
}

/** How the archive is listed and unpacked — swappable for tests. */
export interface RarBackend {
  readonly name: string;
  list(archive: Uint8Array): Promise<ArchiveEntry[]>;
  /** Extracts everything from `archivePath` into `destDir`. */
  extractAll(archive: Uint8Array, archivePath: string, destDir: string): Promise<void>;
}

async function unrarJs() {
  return import("node-unrar-js");
}

const toArrayBuffer = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function listWithUnrarJs(archive: Uint8Array): Promise<ArchiveEntry[]> {
  const { createExtractorFromData } = await unrarJs();
  try {
    const ex = await createExtractorFromData({ data: toArrayBuffer(archive), password: "" });
    return [...ex.getFileList().fileHeaders].map((h) => ({
      name: h.name,
      size: h.unpSize,
      directory: h.flags.directory,
    }));
  } catch (err) {
    throw new HourlyReportError("EXTRACT_FAILED", `Cannot read RAR: ${(err as Error).message}`);
  }
}

/** node-unrar-js: decompress in memory, write only checked, flat file names. */
export const unrarJsBackend: RarBackend = {
  name: "node-unrar-js",
  list: listWithUnrarJs,
  async extractAll(archive, _archivePath, destDir) {
    const { createExtractorFromData } = await unrarJs();
    try {
      const ex = await createExtractorFromData({ data: toArrayBuffer(archive), password: "" });
      for (const f of ex.extract().files) {
        if (f.fileHeader.flags.directory || !f.extraction) continue;
        assertSafeEntryName(f.fileHeader.name);
        const target = path.join(destDir, f.fileHeader.name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, f.extraction);
      }
    } catch (err) {
      if (err instanceof HourlyReportError) throw err;
      throw new HourlyReportError("EXTRACT_FAILED", `RAR extraction failed: ${(err as Error).message}`);
    }
  },
};

const UNRAR_BIN = process.env.HOURLY_UNRAR_BIN || "unrar";

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let out = "";
    p.stdout.on("data", (d) => (out = (out + d).slice(-4000)));
    p.stderr.on("data", (d) => (out = (out + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, out }));
  });
}

/** Official unrar binary. Listing still goes through node-unrar-js (headers only). */
export const unrarCliBackend: RarBackend = {
  name: "unrar",
  list: listWithUnrarJs,
  async extractAll(_archive, archivePath, destDir) {
    // x = keep paths (unrar itself strips ".." and absolute paths), -o+ overwrite,
    // -p- never prompt for a password, -y assume yes, -- end of switches.
    const { code, out } = await run(
      UNRAR_BIN,
      ["x", "-o+", "-p-", "-y", "--", archivePath, destDir + path.sep],
      120_000,
    );
    if (code !== 0)
      throw new HourlyReportError("EXTRACT_FAILED", `unrar exit ${code}: ${out.trim().slice(-300)}`);
  },
};

let cliAvailable: Promise<boolean> | null = null;
/** True when the `unrar` binary runs (checked once per process). */
export function hasUnrarCli(): Promise<boolean> {
  return (cliAvailable ??= run(UNRAR_BIN, [], 10_000)
    .then((r) => /UNRAR/i.test(r.out))
    .catch(() => false));
}

export async function defaultBackend(): Promise<RarBackend> {
  return (await hasUnrarCli()) ? unrarCliBackend : unrarJsBackend;
}

const isXlsx = (n: string) => /\.xlsx$/i.test(n);

/** Pre-check on the header list (nothing extracted yet). */
export function checkEntries(entries: ArchiveEntry[], limits: HourlyLimits): void {
  if (entries.length > limits.maxEntries)
    throw new HourlyReportError(
      "TOO_MANY_ENTRIES",
      `Archive has ${entries.length} entries (max ${limits.maxEntries})`,
    );
  for (const e of entries) assertSafeEntryName(e.name);
  const total = entries.reduce((s, e) => s + (e.directory ? 0 : e.size), 0);
  if (total > limits.maxExtractBytes)
    throw new HourlyReportError(
      "EXTRACT_TOO_LARGE",
      `Archive expands to ${(total / 1048576).toFixed(1)} MB (max ${limits.maxExtractBytes / 1048576} MB)`,
    );
  const xlsx = entries.filter((e) => !e.directory && isXlsx(e.name));
  if (xlsx.length === 0) throw new HourlyReportError("NO_XLSX", "Archive contains no .xlsx file");
  if (xlsx.length > 1)
    throw new HourlyReportError("MULTIPLE_XLSX", `Archive contains ${xlsx.length} .xlsx files`);
}

interface DiskFile {
  path: string;
  size: number;
}

/** Post-check: walk the temp dir; no symlinks, nothing escapes it, limits hold. */
async function walkChecked(root: string, limits: HourlyLimits): Promise<DiskFile[]> {
  const realRoot = await realpath(root);
  const files: DiskFile[] = [];
  let entries = 0;
  let total = 0;
  const walk = async (dir: string) => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (++entries > limits.maxEntries)
        throw new HourlyReportError("TOO_MANY_ENTRIES", `More than ${limits.maxEntries} entries extracted`);
      const st = await lstat(p);
      if (st.isSymbolicLink())
        throw new HourlyReportError("UNSAFE_PATH", `Archive contains a link: ${d.name}`);
      const real = await realpath(p);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep))
        throw new HourlyReportError("UNSAFE_PATH", `Entry escapes the extraction dir: ${d.name}`);
      if (st.isDirectory()) await walk(p);
      else if (st.isFile()) {
        total += st.size;
        if (total > limits.maxExtractBytes)
          throw new HourlyReportError("EXTRACT_TOO_LARGE", "Extracted data exceeds the size limit");
        files.push({ path: p, size: st.size });
      } else throw new HourlyReportError("UNSAFE_PATH", `Unsupported entry type: ${d.name}`);
    }
  };
  await walk(root);
  return files;
}

export interface ExtractOptions {
  limits: HourlyLimits;
  backend?: RarBackend;
  /** Parent for the temp dir (default os.tmpdir()). */
  tmpRoot?: string;
  /** Called with the temp dir path (tests check it is gone afterwards). */
  onTempDir?: (dir: string) => void;
}

/** Returns the bytes and name of the single .xlsx in the RAR. Temp dir removed in all cases. */
export async function extractXlsx(
  archive: Buffer,
  opts: ExtractOptions,
): Promise<{ fileName: string; data: Buffer; backend: string }> {
  const backend = opts.backend ?? (await defaultBackend());
  checkEntries(await backend.list(archive), opts.limits);

  const dir = await mkdtemp(path.join(opts.tmpRoot ?? tmpdir(), "hourly-"));
  opts.onTempDir?.(dir);
  try {
    const archivePath = path.join(dir, "report.rar");
    const outDir = path.join(dir, "out");
    await mkdir(outDir);
    await writeFile(archivePath, archive);
    await backend.extractAll(archive, archivePath, outDir);
    const files = await walkChecked(outDir, opts.limits);
    const xlsx = files.filter((f) => isXlsx(f.path));
    if (xlsx.length === 0) throw new HourlyReportError("NO_XLSX", "No .xlsx was extracted");
    if (xlsx.length > 1)
      throw new HourlyReportError("MULTIPLE_XLSX", `${xlsx.length} .xlsx files were extracted`);
    return {
      fileName: path.basename(xlsx[0]!.path),
      data: await readFile(xlsx[0]!.path),
      backend: backend.name,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
